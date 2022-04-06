import axios from 'axios';
import agentkeepalive from 'agentkeepalive';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { EightSleepThermostatPlatform } from './platform';
import * as Client from './clientRequest';
import { startIntercepting as axiosMock_startIntercepting } from './axiosMock';
import { putBedState } from './clientRequest';

const EIGHT_SLEEP_DIR = '8slp';
const SESSION_CACHE_FILE = 'client-session.txt';
const GET_ME_CACHE_FILE = 'me.txt';
type cacheable = string | ClientSessionData | UserDeviceData | UserData;

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

// Private credentials from Homebridge `config.json`
interface UserCredentials {
  email: string;
  password: string;
}

interface ClientSessionData {
  expirationDate: string;
  userId: string;
  token: string;
}

// For now we only care about user's device
interface UserData {
  currentDevice: UserDeviceData;
}

interface UserDeviceData {
  id: string;
  side: string; // 'left', 'right', 'solo'
}


export class EightSleepConnection {
  private readonly userCreds: UserCredentials;
  private readonly cacheDir = path.resolve(this.platform.api.user.storagePath(), EIGHT_SLEEP_DIR);
  private readonly sessionCachePath = path.resolve(this.cacheDir, SESSION_CACHE_FILE);
  private readonly getMeCachePath = path.resolve(this.cacheDir, GET_ME_CACHE_FILE);
  private readonly log = this.platform.log;

  public currentSession = this.prepareClientConnection();
  public currentDevice = this.prepareUserAndDevice();

  constructor(
    public readonly platform: EightSleepThermostatPlatform,
    email: string,
    password: string) {
    // User credentials read from `config.json` on homebridge startup
    this.userCreds = {
      email: email,
      password: password,
    };

    axiosMock_startIntercepting(clientAPI, this.log);
  }

  /**
   * This method will initiate a chain of events to either load the session
   * containing a userId & token info from cache, or send a new login request
   * to the 8slp Client API to fetch this information.
   *
   * The result of this method is stored by {@linkcode currentSession} in the
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
  // proceeding when this method returns to `establishSession()`
  private async loadCachedSession() {
    try {
      const cache = await this.readCache(this.sessionCachePath);
      return JSON.parse(cache) as ClientSessionData;
    } catch (error) {
      this.log.debug('Error loading session from cache', error);
      return null;
    }
  }

  // Forward error up the chain as a failure here means we have already
  // exhausted any chance at a successful session load
  private async login() {
    const response = await clientAPI.post('/login', this.userCreds);
    const session = JSON.parse(response.data['session']) as ClientSessionData;
    if (!this.isValid(session)) {
      throw new Error('Corrupted session info from ClientAPI');
    }
    this.writeToCache(this.sessionCachePath, session);
    return session;
  }

  private isValid(session: ClientSessionData) {
    const tokenExpDate = new Date(session.expirationDate).valueOf();
    return this.verifyFields(session) && tokenExpDate > (Date.now() + 100);
  }

  private verifyFields(session: ClientSessionData) {
    return (session.token && session.expirationDate && session.userId) ? true : false;
  }

  private updateClientSessionHeaders(session: ClientSessionData) {
    clientAPI.defaults.headers.common['user-id'] = session.userId;
    clientAPI.defaults.headers.common['session-token'] = session.token;
    // this.log.debug('Updated session headers', JSON.stringify(clientAPI.defaults));
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
   * {@linkcode fetchUserAndDevice()}
   *
   * @returns a Promise containing the loaded/fetched device
   *
   * @category CurrentDeviceType
   */
  async prepareUserAndDevice() {
    try {
      const cachedUser = await this.loadCachedUser();
      let device = this.verifyDeviceFor(cachedUser);
      if (!device) {
        this.eraseCache(this.getMeCachePath);
        device = await this.fetchUserAndDevice();
      }
      return device;
    } catch (error) {
      this.log.debug('Failed to get Eight Sleep device info');
      return null;
    }
  }

  private async loadCachedUser() {
    try {
      const cachedUser = await this.readCache(this.getMeCachePath);
      return JSON.parse(cachedUser) as UserData;
    } catch (error) {
      this.log.debug('Error loading user from cache', error);
      return null;
    }
  }

  // GET: Full user profile data from client
  // - use on first time load when no user (i.e. device) previously cached
  private async fetchUserAndDevice() {
    // Must wait for session -> if null, we're unable to fetch user profile
    // as we need the userId & token headers included in the request
    const session = await this.currentSession;
    if (!session) {
      throw new Error('No session');
    }
    const response = await clientAPI.get('/users/me');
    const user = JSON.parse(response.data['user']) as UserData;
    const device = this.verifyDeviceFor(user);
    if (!device) {
      throw new Error('Unable to fetch user profile & current device from client');
    }
    this.writeToCache(this.getMeCachePath, user);
    return device;
  }

  private verifyDeviceFor(user: UserData | null) {
    if (!user || !user.currentDevice.id || !user.currentDevice.side) {
      return null;
    }
    return user.currentDevice;
  }

  /**
   * Caching functionality for both session data (token, userId, tokenExp) and the
   * user's full profile (we only care about 'currentDevice' from user type)
   *
   * Associated methods:
   * {@linkcode readCache()}
   * {@linkcode writeToCache()}
   * {@linkcode eraseCache()}
   * {@linkcode makeCacheDirectory()}
   *
   * @category Caching (ClientSessionType & User)
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
      await this.writeToCache(filepath, 'Empty Cache');
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
        * Only throw if it's NOT an 'EEXIST' error, since we can still
        proceed to write to cache directory if it is
      */
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  // Current Device On/Off Status & Updates
  public async deviceIsOn(userId: string) {
    try {
      const request = Client.getBedState(userId);
      const data = await this.get(request);
      const settings = data as Client.UserBedSetting;
      this.log.debug('Current device state:', JSON.stringify(settings.currentState));
      return ( settings.currentState?.type !== 'off' );
    } catch (error) {
      this.log.error('Error fetching bed on/off status from client');
      return false;
    }
  }

  public async turnOnDevice(userId: string) {
    this.updateBedState(userId, Client.BedState.on);
  }

  public async turnOffDevice(userId: string) {
    this.updateBedState(userId, Client.BedState.off);
  }

  private async updateBedState(userId: string, state: Client.BedState) {
    const request = putBedState(userId, state);
    await this.put(request);
  }

  private async put(req: Client.Request<unknown>) {
    try {
      await this.currentSession;
      const res = await clientAPI.put(req.endpoint, req.body);
      this.log.debug('Successful PUT:', res.data);
    } catch (error) {
      this.log.error('Unable to PUT device state update');
    }
  }

  private async get(req: Client.Request<unknown>) {
    try {
      await this.currentSession;
      const res = await clientAPI.get(req.endpoint);
      this.log.debug('Successful GET:', res.data);
      return res.data;
    } catch (error) {
      this.log.error('Unable to GET device state');
    }
  }

}