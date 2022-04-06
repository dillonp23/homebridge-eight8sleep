import { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { Logger } from 'homebridge';
import * as MockData from './mockClientResponseData';

let mockingEnabled = false;
const mocks = {};
const urlsWhitelist: string[] = [];
let log: Logger;

class MockError extends Error {
  public mockData: AxiosResponse;
  public config: AxiosRequestConfig;

  constructor(message: string, mockData: AxiosResponse, config: AxiosRequestConfig) {
    super(message);
    Object.setPrototypeOf(this, MockError.prototype);
    this.mockData = mockData;
    this.config = config;
  }
}

export const addMock = (url: string, data: string) => {
  mocks[url] = data;
};

export const enableMocking = () => {
  mockingEnabled = true;
};

export const disableMocking = () => {
  mockingEnabled = false;
};

export const addToUrlWhitelist = (urls: Array<string>) => {
  for (const url in urls) {
    urlsWhitelist.push(url);
  }
};

const isUrlWhitelisted = (url: string) => (url in urlsWhitelist);

const getMockError = (config: AxiosRequestConfig) => {
  const mockData = config.url ? mocks[config.url] : 'NO MOCK DATA FOUND';
  const mockError = new MockError('Mocked axios error', mockData, config);
  return Promise.reject(mockError);
};

const isMockError = (error: Error) => {
  const mockError = error as MockError;
  if (!mockError.mockData) {
    return false;
  }
  return true;
};

const getMockResponse = (mockError: MockError) => {
  const config = mockError.config;
  const mockResponse = mockError.mockData;

  // Handle mocked error (any non-2xx status code)
  if (mockResponse.status && String(mockResponse.status)[0] !== '2') {
    const err = new Error(`Error code: ${mockResponse.status}: ${mockResponse.statusText}` || 'Axios error');
    return Promise.reject(err);
  }
  // Handle mocked success
  return Promise.resolve(Object.assign({
    data: mockResponse,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
    isMock: true,
  }, mockResponse));
};

export const startIntercepting = (instance: AxiosInstance, logger: Logger) => {
  log = logger;
  mockingEnabled = true;
  stubRequestInterceptor(instance);
  stubResponseInterceptor(instance);
  log.debug('Begin intercepting Axios requests...');

  addMock(MockData.GUEST_BED_SETTING_URL, JSON.stringify(MockData.DEVICE_OFF));
  addMock(MockData.OWNER_BED_SETTING_URL, JSON.stringify(MockData.DEVICE_ON));
};

const stubRequestInterceptor = (instance: AxiosInstance) => {
  // Add a request interceptor
  instance.interceptors.request.use(config => {
    const url = config.url;

    if (mockingEnabled && url && !isUrlWhitelisted(url)) {

      if (config.method === 'put' && config.data) {
        // Updates stored mock data using properties from the request's config data
        for (const [k, v] of Object.entries(config.data)) {
          const data: object = JSON.parse(mocks[url]);
          data[k] = v;
          mocks[url] = JSON.stringify(data);
        }
      }

      return getMockError(config);
    }
    return config;
  }, error => Promise.reject(error));
};

const stubResponseInterceptor = async (instance: AxiosInstance) => {
// Add a response interceptor
  instance.interceptors.response.use(response => response, async error => {
    if (isMockError(error)) {
      return await getMockResponse(error);
    }
    return Promise.reject(error);
  });
};