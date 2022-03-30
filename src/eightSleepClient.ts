import axios from 'axios';
import agentkeepalive from 'agentkeepalive';
import { Logger } from 'homebridge';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

const EIGHT_SLEEP_DIR = '8slp';
const SESSION_CACHE_FILE = 'client-session.txt';
const USER_CACHE_FILE = 'me.txt';
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
  private userCreds: UserCredentialsType;
  public session?: ClientSessionType;
  public deviceInfo?: CurrentDeviceType;
  private cacheDir: string;
  private sessionCachePath: string;
  private userCachePath: string;

  constructor(email: string, password: string, userStoragePath: string, public readonly log: Logger) {
    // User credentials read from `config.json` on homebridge startup
    this.userCreds = {
      email: email,
      password: password,
    };

    this.cacheDir = path.resolve(userStoragePath, EIGHT_SLEEP_DIR);
    this.sessionCachePath = path.resolve(this.cacheDir, SESSION_CACHE_FILE);
    this.userCachePath = path.resolve(this.cacheDir, USER_CACHE_FILE);

    this.loadCachedUser();
    this.prepareConnection();
  }

  public async loadCachedUser() {
    try {
      const cache = await this.readCache(this.userCachePath);
      const cachedUser = JSON.parse(cache);
      this.deviceInfo = cachedUser['currentDevice'];

      if (!this.deviceInfo) {
        throw new Error('Unable to parse device info from user cache');
      }

      this.log.debug('Loaded device info from cache:', this.deviceInfo);
    } catch (error) {
      this.log.error('Failed to load device info from cache', error);
      // Erase cache to ensure re-write in future:
      this.eraseCache(this.userCachePath);
    }
  }

  private prepareConnection() {
    this.loadSessionOrLogin()
      .then( (res) => {
        this.session = res;
        clientAPI.defaults.headers.common['user-id'] = res.userId;
        clientAPI.defaults.headers.common['session-token'] = res.token;
        this.log.info('Successful connection to Eight Sleep');

        if (!this.deviceInfo) {
          // First time load/user cache was emptied/cached devices need updating
          this.getMe();
        }
      })
      .catch( () => {
        this.log.error('Eight Sleep connection failed: unable to load cache or login');
      });
  }

  private async loadSessionOrLogin() {
    const cachedSession = await this.loadCachedSession();
    const isValid = this.validate(cachedSession);

    if (isValid) {
      // this.log.debug('Successfully loaded client session from cache');
      return cachedSession;
    } else {
      // Invalid token --> attempt login with user credentials
      const newSession = await this.login();
      await this.writeToCache(this.sessionCachePath, newSession);
      this.log.debug('Successfully logged in');
      return newSession;
    }
  }

  private async loadCachedSession() {
    try {
      const cache = await this.readCache(this.sessionCachePath);
      return JSON.parse(cache) as ClientSessionType;
    } catch (error) {
      this.log.debug('Error loading session from cache', error);
      throw error;
    }
  }

  private validate(session: ClientSessionType) {
    const tokenExpDate = new Date(session.expirationDate);

    if (session.token && !this.isExpired(tokenExpDate)) {
      return true;
    } else {
      this.log.warn('Session expired, will attempt refresh...');
      return false;
    }
  }

  private isExpired(date: Date) {
    const tokenTimestamp = date.valueOf();
    return tokenTimestamp < (Date.now() - 100);
  }

  private async login() {
    return clientAPI.post('/v1/login', this.userCreds)
      .then( (response) => {
        return response.data['session'] as ClientSessionType;
      });
  }

  // GET: Full user profile data from client
  // - use on first time load (no device/user previously cached)
  // - TODO: use on demand to update accessories if side changes (left/right/solo)
  private async getMe() {
    const response = await clientAPI.get('/users/me');
    const user = response.data['user'];
    this.deviceInfo = user['currentDevice'] as CurrentDeviceType;
    this.writeToCache(this.userCachePath, user);
  }

  private async readCache(filepath: string) {
    const cache = await readFile(filepath, 'utf-8');
    return cache;
  }

  private async writeToCache(filepath: string, data: cacheable) {
    await this.makeCacheDirectory();
    const jsonData = JSON.stringify(data);
    await writeFile(filepath, jsonData);
  }

  private eraseCache(filepath: string) {
    return this.writeToCache(filepath, '{}');
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