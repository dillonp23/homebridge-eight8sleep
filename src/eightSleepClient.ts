import axios from 'axios';
import agentkeepalive from 'agentkeepalive';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { EightSleepThermostatPlatform } from './platform';

const EIGHT_SLEEP_DIR = '8slp';
const SESSION_CACHE_FILE = 'client-session.txt';
const GET_ME_CACHE_FILE = 'me.txt';
type cacheable = string | ClientSessionType | CurrentDeviceType;

axios.defaults.headers.common = {
  'Content-Type': 'application/json',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Eight%20Sleep/15296 CFNetwork/1331.0.7 Darwin/21.4.0',
};

const HttpsAgent = agentkeepalive.HttpsAgent;
const clientAPI = axios.create({
  baseURL: 'https://client-api.8slp.net/v1',
  httpsAgent: new HttpsAgent({ keepAlive: true }),
});

// Private credentials from config
type UserCredentialsType = {
  email: string;
  password: string;
};

type ClientSessionType = {
  expirationDate: string;
  userId: string;
  token: string;
};

// Device Info returned on user object from client API
type CurrentDeviceType = {
  id: string;
  side: string; // 'left', 'right', 'solo'
};


export class EightSleepClient {
  private readonly userCreds: UserCredentialsType;
  private readonly cacheDir = path.resolve(this.platform.api.user.storagePath(), EIGHT_SLEEP_DIR);
  private readonly sessionCachePath = path.resolve(this.cacheDir, SESSION_CACHE_FILE);
  private readonly getMeCachePath = path.resolve(this.cacheDir, GET_ME_CACHE_FILE);
  private readonly log = this.platform.log;

  public clientSession = this.prepareClientConnection();
  public currentDevice = this.fetchDeviceInfo();

  constructor(
    public readonly platform: EightSleepThermostatPlatform,
    email: string,
    password: string) {
    // User credentials read from `config.json` on homebridge startup
    this.userCreds = {
      email: email,
      password: password,
    };

    this.blockAllAxiosRequests();
  }

  /**
   * This method will initiate a chain of events to either load the session
   * containing a userId & token info from cache, or send a new login request
   * to the 8slp Client API to fetch this information.
   *
   * The result of this method is stored by {@linkcode clientSession} in the
   * form of `Promise<ClientSessionType | null>`
   *
   * Associated methods:
   * {@linkcode establishSession()} // Manages control flow of loading session/logging in
   * {@linkcode loadCachedSession()} // loads cache & verifies token
   * {@linkcode login()}
   *
   * @returns a Promise containing the loaded/fetched session
   *
   * @category ClientSessionType
   */
  async prepareClientConnection() {
    const session = await this.establishSession();
    return session;
  }

  private async establishSession() {
    try {
      let session = await this.loadCachedSession();
      if (!session) {
        session = await this.login();
      }
      this.updateClientSessionHeaders(session);
      return Promise.resolve(session);
    } catch (error) {
      this.log.error('Failed to prepare connection to Eight Sleep:', error);
      return null;
    }
  }

  private updateClientSessionHeaders(session: ClientSessionType) {
    clientAPI.defaults.headers.common['user-id'] = session.userId;
    clientAPI.defaults.headers.common['session-token'] = session.token;
    this.log.debug('Successful connection to Eight Sleep');
  }

  private async loadCachedSession() {
    try {
      const cache = await this.readCache(this.sessionCachePath);
      const session = JSON.parse(cache) as ClientSessionType;
      return this.isValid(session) ? session: null;
    } catch (error) {
      this.log.debug('Error loading session from cache', error);
      return null;
    }
  }

  private isValid(session: ClientSessionType) {
    const tokenExpDate = new Date(session.expirationDate).valueOf();
    return tokenExpDate > (Date.now() + 100);
  }

  private async login() {
    try {
      const response = await clientAPI.post('/login', this.userCreds);
      const session = response.data['session'] as ClientSessionType;
      if (!session) {
        throw new Error('Corrupted session info from ClientAPI');
      }
      this.writeToCache(this.sessionCachePath, session);
      return session;
    } catch (error) {
      this.log.debug('Couldn\'t login to client API', error);
      return Promise.reject(error);
    }
  }

  /**
   * This method will initiate a chain of events to either load the device
   * containing `id` & `side` properties from cache, or will send a `GET`
   * request to `/users/me/` of 8slp Client API to fetch the user object
   *
   * The result of this method is stored by {@linkcode currentDevice} in the
   * form of `Promise<CurrentDeviceType | null>`
   *
   * Associated methods:
   * {@linkcode loadCachedUser()}
   * {@linkcode getMe()}
   *
   * @returns a Promise containing the loaded/fetched device
   *
   * @category CurrentDeviceType
   */
  async fetchDeviceInfo() {
    const device = this.loadCachedUser();
    return device;
  }

  private async loadCachedUser() {
    try {
      const cache = await this.readCache(this.getMeCachePath);
      const cachedUser = JSON.parse(cache);
      const deviceInfo = cachedUser['currentDevice'] as CurrentDeviceType;

      if (!deviceInfo) {
        throw new Error();
      }

      this.log.debug('Loaded device info from cache', JSON.stringify(deviceInfo));
      return deviceInfo;

    } catch (error) {
      // this.log.error('Failed to load device info from cache', error);
      // Erase cache to ensure re-write in future:
      this.eraseCache(this.getMeCachePath);
      try {
        const device = await this.getMe();
        return device;
      } catch (error) {
        this.log.error('Unable to load user from client API - Request failed: GET \'/users/me\'');
      }
      return null;
    }
  }

  // GET: Full user profile data from client
  // - use on first time load (no device/user previously cached)
  // - TODO: use on demand to update accessories if side changes (left/right/solo)
  private async getMe() {
    try {
      await this.clientSession;
      const response = await clientAPI.get('/users/me');
      const userInfo = response.data['user'];
      const device = userInfo['currentDevice'] as CurrentDeviceType;
      if (!device) {
        throw new Error('Corrupted user info from ClientAPI');
      }
      this.writeToCache(this.getMeCachePath, userInfo);
      return device;
    } catch (error) {
      this.log.debug('GET request to \'/users/me\' failed', error);
      return Promise.reject(error);
    }
  }

  private async readCache(filepath: string) {
    try {
      const cache = await readFile(filepath, 'utf-8');
      return cache;
    } catch {
      this.log.debug('Unable to read cache');
      return Promise.reject();
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
      await this.writeToCache(filepath, '{}');
    } catch {
      this.log.debug('Unable to erase user info cache');
    }
  }

  private async makeCacheDirectory() {
    try {
      await mkdir(this.cacheDir);
    } catch (error) {
      /*
        - If dir already exists, caught error code will be 'EEXIST'
        * Only throw if it's NOT an 'EEXIST' error as we can proceed
          to write to cache directory
            - i.e. only throw if a different error occurs
      */
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

}