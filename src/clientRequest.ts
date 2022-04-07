import axios from 'axios';
import agentkeepalive from 'agentkeepalive';
import { Logger } from 'homebridge';

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

interface Request<T> {
  endpoint: string;
  body?: Partial<T>;
}

type ClientDataType = string | number | boolean | object;

export const currentState = <T>(endpoint: string) => {
  return generateRequest<T>(endpoint);
};

export const updateState = <T>(endpoint: string, key: keyof T, newValue: ClientDataType) => {
  const body = makeReqBody(key, newValue);
  return generateRequest(endpoint, body);
};

const makeReqBody = <T>(key: keyof T, data: ClientDataType) => {
  const body: Partial<T> = {};
  body[key as string] = data;
  return body;
};

const generateRequest = <T>(endpoint: string, data?: Partial<T>): Request<T> => {
  return {
    endpoint: endpoint,
    body: data,
  };
};

export const put = async <T>(req: Request<T>, log?: Logger) => {
  try {
    const res = await clientAPI.put(req.endpoint, req.body);
    return res.data as T;
  } catch (error) {
    log?.debug('PUT request failed:', error);
    return null;
  }
};

export const get = async <T>(req: Request<T>, log?: Logger) => {
  try {
    const res = await clientAPI.get(req.endpoint);
    return res.data as T;
  } catch (error) {
    log?.debug('GET request failed:', error);
    return null;
  }
};