import axios from 'axios';
import agentkeepalive from 'agentkeepalive';
import { Logger } from 'homebridge';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

const EIGHT_SLEEP_DIR = '8slp';
const CACHE_FILE = 'client-session.txt';
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
    side: string;
  };
};


export class EightSleepClient {
  private userCreds: UserCredentialsType;
  public session?: ClientSessionType;
  public userInfo?: UserProfileType;
  private cachePath: string;

  constructor(email: string, password: string, userStoragePath: string, public readonly log: Logger) {
    // User credentials read from `config.json` on homebridge startup
    this.userCreds = {
      email: email,
      password: password,
    };

    this.cachePath = path.resolve(userStoragePath, EIGHT_SLEEP_DIR, CACHE_FILE);
    this.prepareConnection();
  }

  private prepareConnection() {
    this.establishSession()
      .then( (res) => {
        this.session = res;
        clientAPI.defaults.headers.common['user-id'] = res.userId;
        clientAPI.defaults.headers.common['session-token'] = res.token;
        this.log.info('Eight Sleep connection was successful!');
      })
      .catch( () => {
        this.log.error('Connection to Eight Sleep failed: unable to load cache or login');
      });
  }

  private async establishSession() {
    const cachedSession = await this.loadCachedSession();
    const isValidSession = this.validate(cachedSession);

    if (isValidSession) {
      this.log.debug('Successfully loaded client session from cache');
      return cachedSession;
    } else {
      // Invalid token --> attempt login with user credentials
      const newSession = await this.login();
      await this.writeToCache(newSession);
      this.log.debug('Successfully logged in');
      return newSession;
    }
  }

  private async loadCachedSession() {
    try {
      const cache = await this.readCache();
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
      delete this.session;
      return false;
    }
  }

  private isExpired(date: Date) {
    const tokenTimestamp = date.valueOf();
    const expirationCutoff = Date.now() - 100;
    return tokenTimestamp < expirationCutoff;
  }

  private async login() {
    return clientAPI.post('/v1/login', this.userCreds)
      .then( (response) => {
        return response.data['session'] as ClientSessionType;
      }).catch( (error) => {
        this.log.error('Failed to login:', error);
        throw error;
      });
  }

  private async readCache() {
    const cache = await readFile(this.cachePath, 'utf-8');
    // this.log.debug('Read from cache:', cache);
    return cache;
  }

  private async writeToCache(data: cacheable) {
    try {
      await this.makeCacheDirectory();
      await writeFile(this.cachePath, JSON.stringify(data));
      this.log.debug('Successfully saved session to cache:', JSON.stringify(this.session));
    } catch (error) {
      this.log.debug('Failed to cache client', error);
    }
  }

  private async makeCacheDirectory() {
    try {
      const dir = path.dirname(this.cachePath);
      await mkdir(dir);
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