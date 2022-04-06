
export interface Request<T> {
  endpoint: string;
  body?: Partial<T>;
}

const generateRequest = <T>(userId: string, endpoint: string, data?: Partial<T>): Request<T> => {
  return {
    endpoint: endpoint,
    body: data,
  };
};

export const getBedState = (userId: string) => {
  return generateRequest(userId, userBedSettingsUrl(userId));
};

export const putBedState = (userId: string, state: BedState) => {
  const body = newReqBody<UserBedSettings>('currentState', { type: state });
  return generateRequest(userId, userBedSettingsUrl(userId), body);
};

export const putBedTemp = (userId: string, level: number) => {
  const body = newReqBody<UserBedSettings>('currentLevel', level);
  return generateRequest(userId, userBedSettingsUrl(userId), body);
};

const newReqBody = <T extends object>(key: keyof T, data: unknown) => {
  const body: Partial<T> = {};
  body[key as string] = data;
  return body;
};

export enum BedState {
  on = 'smart',
  off = 'off',
}

interface CurrentState {
  type: BedState;
}

export interface UserBedSettings {
  currentLevel: number;
  currentState: CurrentState;
}

const userBedSettingsUrl = (userId: string) => `/users/${userId}/temperature`;


export interface ClientDeviceSettings {
  level: number;
}

const clientDeviceSettingsUrl = (deviceId: string) => `/devices/${deviceId}`;