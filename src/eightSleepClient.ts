import axios from 'axios';
import { Logger } from 'homebridge';

import { readFile, writeFile, mkdir } from 'fs/promises';
const clientCacheDir = '/8slp';
const sessionFile = '/client-session.txt';

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

  public readonly log: Logger;

  constructor(email: string, password: string, logger: Logger) {
    this.log = logger;

    // User credentials are read from config file on homebridge startup
    // Session related info will be cached to disk using HAP-Storage
    this.userCreds = {
      email: email,
      password: password,
    };
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
        this.log.error('Failed to resolve login promise', error);
      });
  }

  async fetchUserSession(path: string) {
    await this.makeCacheDirectory(path.concat(clientCacheDir))
      .catch((error) => {
        this.log.error(`Client session cache 'mkdir' failed: ${error}`);
      });

    const currSession = await this.readCache(path.concat(clientCacheDir, sessionFile))
      .catch((error) => {
        this.log.error('Unable to read read session cache', (error as Error).message);
      });

    if (currSession) {
      const sessionJSON: ClientSession = JSON.parse(currSession.toString());
      this.log.warn('Got session:', sessionJSON.expirationDate, sessionJSON.token, sessionJSON.userId);
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

  async readCache(filePath: string): Promise<Buffer> {
    const currSession = await readFile(filePath);
    return currSession;
  }

}