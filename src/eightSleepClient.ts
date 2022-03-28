import axios from 'axios';
import { Logger } from 'homebridge';

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

interface Session {
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
  public session?: Session;
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
    // return clientAPI.get('/v1/login');
  }
}