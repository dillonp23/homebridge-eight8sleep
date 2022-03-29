import axios from 'axios';
import { Logger } from 'homebridge';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

// ClientSession caching paths
const EIGHT_SLEEP_DIR = '8slp';
const CACHE_FILE = 'client-session.txt';
type cacheable = string | Partial<ClientSession> | UserInfo;

const clientAPI = axios.create({
  baseURL: 'https://client-api.8slp.net',
  headers: {
    'Host': 'client-api.8slp.net',
    'Content-Type': 'application/json',
    'User-Agent': 'Eight%20Sleep/15296 CFNetwork/1331.0.7 Darwin/21.4.0',
    'Accept': 'application/json',
  },
});

// Private credentials from config
interface UserCredentials {
  email: string;
  password: string;
}

interface ClientSession {
  expirationDate: string;
  userId: string;
  token: string;
}

// User Info & Device from client API
interface UserInfo {
  userId: string;
  currentDevice: {
    id: string;
    side: string;
  };
}

export class EightSleepClient {
  private userCreds: UserCredentials;
  public session?: ClientSession;
  public userInfo?: UserInfo;
  private cachePath: string;
  public readonly log: Logger;

  constructor(email: string, password: string, userStoragePath: string, logger: Logger) {
    // User credentials read from `config.json` on homebridge startup
    this.userCreds = {
      email: email,
      password: password,
    };

    this.log = logger;
    this.cachePath = path.resolve(userStoragePath, EIGHT_SLEEP_DIR, CACHE_FILE);
  }

  async login() {
    this.log.info(`Logging in ${this.userCreds.email}, using client api:`, clientAPI.defaults.headers);

    return axios.post('/v1/login', this.userCreds)
      .then((loginResponse) => {
        const sessionInfo = loginResponse.data['session'];

        this.log.info('Successfully logged in:', sessionInfo);
        this.session = sessionInfo;
        this.log.info('User Session:', this.session);

        // ** TODO **
        // Write the returned session object to in-disk cache
      }).catch((error) => {
        this.log.error('Failed to login:', error);
      });
  }

  async readCache(): Promise<string> {
    this.log.debug(`Reading cache from '${this.cachePath}'`);
    const cache = await readFile(this.cachePath, 'utf-8');
    return cache;
  }

  async writeToCache(data: cacheable) {
    try {
      this.log.debug(`Writing to cache at '${this.cachePath}'`);
      await this.makeCacheDirectory(path.dirname(this.cachePath));
      await writeFile(this.cachePath, JSON.stringify(data));
    } catch (error) {
      this.log.error(`Failed to cache user session at '${this.cachePath}':`, (error as Error).message);
    }
  }

  async makeCacheDirectory(dir: string) {
    return await mkdir(dir)
      .catch((error) => {
        const errnoExcept = error as NodeJS.ErrnoException;
        /*
          - If dir already exists, caught error code will be 'EEXIST'
          * Only throw if it's NOT an 'EEXIST' error, otherwise return
            and continue `fetchUserSession()` execution.
        */
        if (errnoExcept.code !== 'EEXIST') {
          throw error;
        }
      });
  }

}