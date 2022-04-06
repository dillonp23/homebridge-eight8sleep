import axios, { AxiosResponse } from 'axios';
import agentkeepalive from 'agentkeepalive';
import { EightSleepConnection } from './eightSleepConnection';

axios.defaults.headers.common = {
  'Content-Type': 'application/json',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Eight%20Sleep/15296 CFNetwork/1331.0.7 Darwin/21.4.0',
};

export const clientAPI = axios.create({
  baseURL: 'https://client-api.8slp.net/v1',
  httpsAgent: new agentkeepalive.HttpsAgent({ keepAlive: true }),
});

export interface Request<T> {
  endpoint: string;
  body?: Partial<T>;
}

const newReqBody = <T extends object>(key: keyof T, data: unknown) => {
  const body: Partial<T> = {};
  body[key as string] = data;
  return body;
};

const generateRequest = <T>(userId: string, endpoint: string, data?: Partial<T>): Request<T> => {
  return {
    endpoint: endpoint,
    body: data,
  };
};

export const bedState = (userId: string) => {
  return generateRequest(userId, userBedSettingsUrl(userId));
};

export const newBedState = (userId: string, state: BedState) => {
  const body = newReqBody<UserBedSettings>('currentState', { type: state });
  return generateRequest(userId, userBedSettingsUrl(userId), body);
};

export const newBedTemp = (userId: string, level: number) => {
  const body = newReqBody<UserBedSettings>('currentLevel', level);
  return generateRequest(userId, userBedSettingsUrl(userId), body);
};

export enum BedState {
  on = 'smart',
  off = 'off',
}

interface CurrentState {
  type: BedState;
}

const userBedSettingsUrl = (userId: string) => `/users/${userId}/temperature`;
export interface UserBedSettings {
  currentLevel: number;
  currentState: CurrentState;
}

const clientDeviceSettingsUrl = (deviceId: string) => `/devices/${deviceId}`;
export interface ClientDeviceSettings {
  level: number;
}

export const put = async <T>(connection: EightSleepConnection, req: Request<unknown>) => {
  try {
    await connection.currentSession;
    const res = await clientAPI.put(req.endpoint, req.body);
    const data = parseClientResponse<T>(res);
    return data;
  } catch (error) {
    connection.log.error('Unable to PUT device state updates', req.endpoint, error);
    return null;
  }
};

export const get = async <T>(connection: EightSleepConnection, req: Request<unknown>) => {
  try {
    await connection.currentSession;
    const res = await clientAPI.get(req.endpoint);
    const data = parseClientResponse<T>(res);
    return data;
  } catch (error) {
    connection.log.error('Unable to GET device state for request', req.endpoint, error);
    return null;
  }
};

const parseClientResponse = <T>(response: AxiosResponse) => {
  const result = JSON.parse(response?.data) as T;
  return result;
};