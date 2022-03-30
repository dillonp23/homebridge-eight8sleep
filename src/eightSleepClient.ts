import axios from 'axios';
import agentkeepalive from 'agentkeepalive';
import { Logger } from 'homebridge';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

const EIGHT_SLEEP_DIR = '8slp';
const SESSION_CACHE_FILE = 'client-session.txt';
const PROFILE_CACHE_FILE = 'me.txt';
type cacheable = string | Partial<ClientSessionType> | UserProfileType;

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

// User & Device Info from client API
type UserProfileType = {
  userId: string;
  currentDevice: {
    id: string;
    side: string; // 'left', 'right', 'solo'
  };
};


export class EightSleepClient {
  private userCreds: UserCredentialsType;
  public session?: ClientSessionType;
  public userInfo?: UserProfileType;
  private cacheDir: string;
  private sessionCachePath: string;
  private profileCachePath: string;

  constructor(email: string, password: string, userStoragePath: string, public readonly log: Logger) {
    // User credentials read from `config.json` on homebridge startup
    this.userCreds = {
      email: email,
      password: password,
    };

    this.cacheDir = path.resolve(userStoragePath, EIGHT_SLEEP_DIR);
    this.sessionCachePath = path.resolve(this.cacheDir, SESSION_CACHE_FILE);
    this.profileCachePath = path.resolve(this.cacheDir, PROFILE_CACHE_FILE);

    this.loadCachedProfile();
    this.prepareConnection();
  }

  public async loadCachedProfile() {
    try {
      const cachedProfile = await this.readCache(this.profileCachePath);
      const cachedInfo: UserProfileType = JSON.parse(cachedProfile);
      this.userInfo = {
        userId: cachedInfo.userId,
        currentDevice: cachedInfo.currentDevice,
      };
      this.log.debug('Loaded profile from cache:', this.userInfo);
    } catch (error) {
      this.log.error('Loading user profile cache failed', error);
      // Erase cache to ensure re-write in future:
      this.writeToCache(this.profileCachePath, {});
    }
  }

  // On init, attempt to load UserProfileType cache concurrently w/est. session to get devices faster
  // If no cache wait for the session to establish and for 'getMe()' to finish
  // If sides are updated in 8sleep app -> need to update sides (i.e. accessories) locally

  private prepareConnection() {
    this.loadSessionOrLogin()
      .then( (res) => {
        this.session = res;
        clientAPI.defaults.headers.common['user-id'] = res.userId;
        clientAPI.defaults.headers.common['session-token'] = res.token;
        this.log.info('Eight Sleep connection was successful!');

        if (!this.userInfo) {
          // First time load/device cache was emptied/cached devices need updating
          this.getMe();
        }
      })
      .catch( () => {
        this.log.error('Connection to Eight Sleep failed: unable to load cache or login');
      });
  }

  private async loadSessionOrLogin() {
    const cachedSession = await this.loadCachedSession();
    const isValid = this.validate(cachedSession);

    if (isValid) {
      this.log.debug('Successfully loaded client session from cache');
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
    this.userInfo = response.data['user'] as UserProfileType;
    this.writeToCache(this.profileCachePath, this.userInfo);
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