import { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { Logger } from 'homebridge';

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

// const isUrlMocked = (url: string) => (url !== MISSING_URL_MESSAGE && url in mocks);
const isUrlWhitelisted = (url: string) => (url in urlsWhitelist);

const getMockError = (config: AxiosRequestConfig) => {
  log.warn('Got here mock', config);
  const mockData = config.url ? mocks[config.url] : 'NO MOCK DATA FOUND';
  const mockError = new MockError('Mocked axios error', mockData, config);
  // mockError.mockData = mocks[config.url];
  // mockError.config = config;
  return Promise.reject(mockError);
};

const isMockError = (error: Error) => {
  // Boolean(error.mockData);
  const mockError = error as MockError;
  if (!mockError.mockData) {
    return false;
  }
  return true;
};

const getMockResponse = (mockError: MockError) => {
  log.warn('Axios mock:', mockError);
  const config = mockError.config;
  const mockResponse = mockError.mockData;

  // Handle mocked error (any non-2xx status code)
  if (mockResponse.status && String(mockResponse.status)[0] !== '2') {
    const err = new Error(mockResponse.statusText || 'Axios error');
    err.message.concat(` | Error code: ${mockResponse.status}`);
    return Promise.reject(err);
  }
  // Handle mocked success
  return Promise.resolve(Object.assign({
    data: {},
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
};

const stubRequestInterceptor = (instance: AxiosInstance) => {
  // Add a request interceptor
  instance.interceptors.request.use(config => {
    const url = config.url || 'MISSING AXIOS CONFIG URL';
    if (mockingEnabled && !isUrlWhitelisted(url)) {
      return getMockError(config);
    }
    return config;
  }, error => Promise.reject(error));
};

const stubResponseInterceptor = (instance: AxiosInstance) => {
// Add a response interceptor
  instance.interceptors.response.use(response => response, error => {
    if (isMockError(error)) {
      return getMockResponse(error);
    }
    return Promise.reject(error);
  });
};