
export interface Request {
  endpoint: string;
}

export interface PutRequest<T> extends Request {
  body: T;
}

const generatePutRequest = <T>(endpoint: string, data: T): PutRequest<T> => {
  return {
    endpoint: endpoint,
    body: data,
  };
};

export const updateBedStateRequest = (state: BedState, userId?: string) => {
  const body: Device = {
    currentState: state,
  };
  const endpoint = `/users/${userId}/temperature`;
  return generatePutRequest<Device>(endpoint, body);
};

export const updateBedTempRequest = (level: number, userId?: string) => {
  const body: Device = {
    currentLevel: level,
  };
  const endpoint = `/users/${userId}/temperature`;
  return generatePutRequest<Device>(endpoint, body);
};

export enum BedState {
  on = '{\'type\': \'smart\'}',
  off = '{\'type\': \'off\'}',
}

interface Device {
  currentLevel?: number;
  currentState?: BedState;
}