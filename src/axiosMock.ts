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

export const addMock = (url: string, data: string | object) => {
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

const headsUpMessage = () => {
  log.warn('\n\n\nHeads up - Changes might not be sent to the API because you have mocking turned on.\n\n\n');
};

export const startIntercepting = (instance: AxiosInstance, logger: Logger) => {
  log = logger;
  mockingEnabled = true;
  stubRequestInterceptor(instance);
  stubResponseInterceptor(instance);
  setTimeout(headsUpMessage, 1500);
  log.debug('Begin intercepting Axios requests...');

  addMock(MockData.GUEST_BED_SETTING_URL, MockData.GUEST_CURRENT_SETTINGS);
  addMock(MockData.OWNER_BED_SETTING_URL, MockData.OWNER_CURRENT_SETTINGS);
  addMock(MockData.PRIMARY_USER_LOGIN_URL, MockData.LOGIN_SESSION_RESPONSE);
  addMock(MockData.SHARED_DEVICE_STATUS_URL, MockData.SHARED_DEVICE_STATUS);
};

const stubRequestInterceptor = (instance: AxiosInstance) => {
  // Add a request interceptor
  instance.interceptors.request.use(config => {
    const url = config.url;

    if (mockingEnabled && url && !isUrlWhitelisted(url)) {
      // ** Uncomment next line for request details **
      // log.debug(`Client request initiated for ${url}, with headers:`, config.headers);

      const configData = config.data;

      if (config.method === 'put' && configData) {
        // Updates stored mock data using properties from the request's config data
        for (const [k, v] of Object.entries(config.data)) {
          const data: object = mocks[url];
          data[k] = v;
          mocks[url] = data;
        }
      } else if (config.method === 'post' && configData) {
        log.warn('Client API `POST` request initiated.', url);
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
      const response = await getMockResponse(error);
      // ** Uncomment next line for response details **
      // log.warn('Client responded with:', response.data);
      return response;
    }
    return Promise.reject(error);
  });
};