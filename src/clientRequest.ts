
export interface Request<T> {
  endpoint: string;
  body?: T;
}

const generateRequest = <T>(endpoint: string, data?: T): Request<T> => {
  return {
    endpoint: endpoint,
    body: data,
  };
};

const setUserBedEndpoint = (userId: string, data?: UserBedSetting) => {
  const endpoint = `/users/${userId}/temperature`;
  return generateRequest<UserBedSetting>(endpoint, data);
};

export const currentBedStateRequest = (userId: string) => {
  return setUserBedEndpoint(userId);
};

export const putBedStateRequest = (userId: string, state: BedState) => {
  const body: UserBedSetting = {
    currentState: {
      type: state,
    },
  };
  return setUserBedEndpoint(userId, body);
};

export const putBedTempRequest = (userId: string, level: number) => {
  const body: UserBedSetting = {
    currentLevel: level,
  };
  return setUserBedEndpoint(userId, body);
};

export enum BedState {
  on = 'smart',
  off = 'off',
}

export interface UserBedSetting {
  currentLevel?: number;
  currentState?: {
    type: string;
  };
}