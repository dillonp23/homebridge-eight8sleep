import { Logger } from 'homebridge';
import * as Client from './clientRequest';
import {
  newState,
  currentState } from './clientRequest';

interface UserSettings {
  currentLevel: number;
  currentState: BedState;
}

interface BedState {
  type: Mode;
}

enum Mode {
  on = 'smart',
  off = 'off',
}

export interface AccessoryInfo {
  userId: string;
  deviceId: string;
}

type Endpoint = (accInfo: AccessoryInfo) => string;
const resolveUsersUrl: Endpoint = (accInfo) => `/users/${accInfo.userId}/temperature`;
const resolveDevicesUrl: Endpoint = (accInfo) => `/devices/${accInfo.deviceId}`;


export class AccessoryClientAdapter {
  private userEndpoint = resolveUsersUrl(this.accessoryInfo);
  private deviceEndpoint = resolveDevicesUrl(this.accessoryInfo);

  constructor(
      readonly accessoryInfo: AccessoryInfo,
      private readonly log: Logger,
  ) {}

  // Current Device On/Off Status & Updates
  async isDeviceOn() {
    try {
      const response = await Client.get(currentState<UserSettings>(this.userEndpoint));
      this.log.debug('Current device state:', response?.currentState);
      return (response && response.currentState.type !== Mode.off);
    } catch (error) {
      this.log.error('Error fetching bed on/off status from client');
      return false;
    }
  }

  /**
   * Since client returns 'smart:bedtime', 'smart:initial', or 'smart:final'
   * depending on when the request is made, it makes checking if response
   * is === `BedState.on` complicated (`on` enum value is just 'smart').
   * Easier to ensure not 'off' instead of checking if some 'smart:...'
   */
  async turnOnDevice() {
    const data: BedState = { type: Mode.on };
    this.log.warn('turning on device', data);
    const response = await Client.put(newState<UserSettings>(this.userEndpoint, 'currentState', data));
    return (response?.currentState.type !== Mode.off);
  }

  async turnOffDevice() {
    const data: BedState = { type: Mode.off };
    this.log.warn('turning on device', data);
    const response = await Client.put(newState<UserSettings>(this.userEndpoint, 'currentState', data));
    return (response?.currentState.type === Mode.off);
  }

  // Update Bed Temperature ('level')
  async updateBedTemp(newLevel: number) {
    const response = await Client.put(newState<UserSettings>(this.userEndpoint, 'currentLevel', newLevel));
    this.log.debug('Updated bed temp (level):', response?.currentLevel, response?.currentState);

    if (response?.currentLevel !== newLevel) {
      this.log.error(`Attempted bed level update to ${newLevel}, but client returned ${response?.currentLevel}`);
    }
  }

}