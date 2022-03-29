import axios from 'axios';
import { Logger } from 'homebridge';
import { readFile, writeFile, mkdir } from 'fs/promises';

// ClientSession caching paths
const EIGHT_SLEEP_DIR_PATH = '/8slp';
const SESSION_FILE_PATH = '/client-session.txt';
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
  private cacheDir: string;
  private cacheFilePath: string;
  public readonly log: Logger;

  constructor(email: string, password: string, userStoragePath: string, logger: Logger) {
    this.log = logger;

    // User credentials are read from config file on homebridge startup
    // Session related info will be cached to disk using HAP-Storage
    this.userCreds = {
      email: email,
      password: password,
    };

    // Setup client cache directory and session file path
    this.cacheDir = userStoragePath.concat(EIGHT_SLEEP_DIR_PATH);
    this.cacheFilePath = this.cacheDir.concat(SESSION_FILE_PATH);

    // ** TODO: load cached user session or login and save to cache
    // this.readCache();
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
    const currSession = await readFile(this.cacheFilePath, 'utf-8');
    // this.log.debug(`Successful retrieval of cached session: ${currSession}`);
    return currSession;
  }

  async writeToCache(data: cacheable) {
    try {
      await this.makeCacheDirectory(this.cacheDir);
      await writeFile(this.cacheFilePath, JSON.stringify(data));
    } catch (error) {
      this.log.error(`Write to cache at path ${this.cacheFilePath} failed:`, (error as Error).message);
    }
  }

  async makeCacheDirectory(cachePath: string) {
    return await mkdir(cachePath)
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