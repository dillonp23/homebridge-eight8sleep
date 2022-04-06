
export interface Request<T> {
  endpoint: string;
  body?: Partial<T>;
}

const generateRequest = <T>(endpoint: string, data?: Partial<T>): Request<T> => {
  return {
    endpoint: endpoint,
    body: data,
  };
};

const resolveUsersUrl = (userId: string, data?: Partial<UserBedSetting>) => {
  const endpoint = `/users/${userId}/temperature`;
  return generateRequest<UserBedSetting>(endpoint, data);
};

export const getBedState = (userId: string) => {
  return resolveUsersUrl(userId);
};

export const putBedState = (userId: string, state: BedState) => {
  const body = newReqBody<UserBedSetting>('currentState', { type: state });
  return resolveUsersUrl(userId, body);
};

export const putBedTemp = (userId: string, level: number) => {
  const body = newReqBody<UserBedSetting>('currentLevel', level);
  return resolveUsersUrl(userId, body);
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

// type userBedSettingKeys = keyof UserBedSetting;
export interface UserBedSetting {
  currentLevel: number;
  currentState: CurrentState;
}