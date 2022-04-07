import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { EightSleepThermostatPlatform } from './platform';
import { clientAPI } from './clientRequest';
import * as AxiosMock from './axiosMock';

const EIGHT_SLEEP_DIR = '8slp';
const SESSION_CACHE_FILE = '_login.txt';
const PRIMARY_USER_CACHE_FILE = '_users_me.txt';
type cacheable = string | object | Session | PrimaryUser;

// Private credentials loaded from Homebridge `config.json`
interface UserCredentials {
  email: string;
  password: string;
}

interface Session {
  expirationDate: string;
  userId: string;
  token: string;
}

// Eight Sleep API defines primaryUser as `me`
// - `currentDevice.id` is a shared property loaded with user `me`
// - `side` property is specific to primary user `me`, but will be
//  used to determine how platform accessories are setup:
//    - `solo` ==> single accessory
//    - `left` or `right` ==> two accessories
interface PrimaryUser {
  currentDevice: {
    id: string; // shared deviceId - same for both left/right user
    side: string; // 'left', 'right', 'solo'
  };
}


export class EightSleepConnection {
  private readonly userCreds: UserCredentials;
  private readonly cacheDir = path.resolve(this.platform.api.user.storagePath(), EIGHT_SLEEP_DIR);
  private readonly sessionCachePath = path.resolve(this.cacheDir, SESSION_CACHE_FILE);
  private readonly primaryUserCachePath = path.resolve(this.cacheDir, PRIMARY_USER_CACHE_FILE);
  public readonly log = this.platform.log;

  public session = this.prepareSession();
  public primaryUser = this.preparePrimaryUser();

  constructor(
    public readonly platform: EightSleepThermostatPlatform,
    email: string,
    password: string) {
    // User credentials read from `config.json` on homebridge startup
    this.userCreds = {
      email: email,
      password: password,
    };

    AxiosMock.startIntercepting(clientAPI, this.log);
  }

  /**
   * This method will initiate a chain of events to either load the session
   * containing a userId & token info from cache, or send a new login request
   * to the 8slp API to fetch this information.
   *
   * The result of this method is stored by {@linkcode session} in the
   * form of `Promise<Session | null>`
   *
   * Associated methods:
   * {@linkcode loadCachedSession()} // loads cache & verifies token
   * {@linkcode login()} // if no cached session, will re-login
   *
   * @returns a Promise containing the loaded/fetched session
   *
   * @category Session
   */
  async prepareSession() {
    try {
      let session = await this.loadCachedSession();
      if (!session || !this.isValid(session)) {
        this.eraseCache(this.sessionCachePath);
        session = await this.login();
      }
      this.updateClientSessionHeaders(session);
      return session;
    } catch (error) {
      this.log.error('Failed to prepare connection to Eight Sleep:', error);
      return null;
    }
  }

  // Catch error here so that a failure doesn't stop login execution from
  // proceeding when this method returns to `prepareSession()`
  private async loadCachedSession() {
    try {
      const cache = await this.readCache(this.sessionCachePath);
      return JSON.parse(cache) as Session;
    } catch (error) {
      this.log.debug('Error loading session from cache', error);
      return null;
    }
  }

  // Forward error up the chain as a failure here means we have already
  // exhausted any chance at a successful session load
  private async login() {
    const response = await clientAPI.post('/login', this.userCreds);
    const session = JSON.parse(response.data['session']) as Session;
    if (!this.isValid(session)) {
      throw new Error('Corrupted session info from ClientAPI');
    }
    this.writeToCache(this.sessionCachePath, session);
    return session;
  }

  private isValid(session: Session) {
    const tokenExpDate = new Date(session.expirationDate).valueOf();
    return this.verifyFields(session) && tokenExpDate > (Date.now() + 100);
  }

  private verifyFields(session: Session) {
    return (session.token && session.expirationDate && session.userId) ? true : false;
  }

  private updateClientSessionHeaders(session: Session) {
    clientAPI.defaults.headers.common['user-id'] = session.userId;
    clientAPI.defaults.headers.common['session-token'] = session.token;
    // this.log.debug('Updated session headers', JSON.stringify(clientAPI.defaults));
  }

  /**
   * This method will initiate a chain of events to either load the primary user data
   * containing the device `id` & `side` properties from cache, or will send a `GET`
   * request to `/users/me/` of 8slp API to fetch the user object
   *
   * The result of this method is stored by {@linkcode primaryUser} in the
   * form of `Promise<PrimaryUser | null>`
   *
   * Associated methods:
   * {@linkcode loadCachedUser()}
   * {@linkcode fetchPrimaryUser()}
   *
   * @returns a Promise containing the loaded/fetched device
   *
   * @category CurrentDeviceType
   */
  async preparePrimaryUser() {
    try {
      const cachedUser = await this.loadCachedUser();
      let device = this.verifyDeviceFor(cachedUser);
      if (!device) {
        this.eraseCache(this.primaryUserCachePath);
        device = await this.fetchPrimaryUser();
      }
      return device;
    } catch (error) {
      this.log.debug('Failed to get Eight Sleep device info');
      return null;
    }
  }

  private async loadCachedUser() {
    try {
      const cachedUser = await this.readCache(this.primaryUserCachePath);
      return JSON.parse(cachedUser) as PrimaryUser;
    } catch (error) {
      this.log.debug('Error loading user from cache', error);
      return null;
    }
  }

  // GET: Full user profile data from client
  // - use on first time load when no user (i.e. device) previously cached
  private async fetchPrimaryUser() {
    // Must wait for session -> if null, we're unable to fetch user profile
    // as we need the userId & token headers included in the request
    const session = await this.session;
    if (!session) {
      throw new Error('No session');
    }
    const response = await clientAPI.get('/users/me');
    const user = JSON.parse(response.data['user']) as PrimaryUser;
    const device = this.verifyDeviceFor(user);
    if (!device) {
      throw new Error('Unable to fetch user profile & current device from client');
    }
    this.writeToCache(this.primaryUserCachePath, user);
    return device;
  }

  private verifyDeviceFor(user: PrimaryUser | null) {
    if (!user || !user.currentDevice.id || !user.currentDevice.side) {
      return null;
    }
    return user.currentDevice;
  }

  /**
   * Caching functionality for both session data (token, userId, tokenExp) and the
   * primary user's full profile (we only care about 'currentDevice')
   *
   * Associated methods:
   * {@linkcode readCache()}
   * {@linkcode writeToCache()}
   * {@linkcode eraseCache()}
   * {@linkcode makeCacheDirectory()}
   *
   * @category Caching {@linkcode Session} & {@linkcode PrimaryUser}
   */
  private async readCache(filepath: string) {
    try {
      const cache = await readFile(filepath, 'utf-8');
      return cache;
    } catch {
      this.log.debug('Unable to read cache');
      return Promise.reject(null);
    }
  }

  private async writeToCache(filepath: string, data: cacheable) {
    try {
      await this.makeCacheDirectory();
      const jsonData = JSON.stringify(data);
      await writeFile(filepath, jsonData);
    } catch {
      this.log.debug('Unable to write to cache');
    }
  }

  private async eraseCache(filepath: string) {
    try {
      await this.writeToCache(filepath, {});
    } catch {
      this.log.debug('Unable to erase cache at:', filepath);
    }
  }

  private async makeCacheDirectory() {
    try {
      await mkdir(this.cacheDir);
    } catch (error) {
      /*
        - If dir already exists, caught error code will be 'EEXIST'
        * Only throw if it's NOT an 'EEXIST' error, since we can still
        proceed to write to cache directory if it is
      */
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

}