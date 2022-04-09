import { Logger } from 'homebridge';
import * as Client from './clientRequest';
import { updateState, currentState } from './clientRequest';

interface UserSettings {
  currentLevel: number;
  currentState: CurrentState;
}

type CurrentState = { type: DeviceMode };

enum DeviceMode {
  on = 'smart',
  off = 'off',
}

type SharedDeviceResponse = { result: SharedDeviceSettings };

interface SharedDeviceSettings {
  leftHeatingLevel: number;
  leftTargetHeatingLevel: number;
  leftNowHeating: boolean;
  rightHeatingLevel: number;
  rightTargetHeatingLevel: number;
  rightNowHeating: boolean;
  priming: boolean;
  needsPriming: boolean;
  hasWater: boolean;
}

const stateFor = (newState: DeviceMode): CurrentState => {
  return { type: newState };
};

type Endpoint = (id: string) => string;
const resolveUsersUrl: Endpoint = (id) => `/users/${id}/temperature`;
const resolveDevicesUrl: Endpoint = (id) => `/devices/${id}`;


export class PlatformClientAdapter {
  private devicesEndpoint = resolveDevicesUrl(this.sharedDeviceId);
  private sharedDeviceSettings = this.loadSharedDeviceState();

  constructor(
    readonly sharedDeviceId: string,
    private readonly log: Logger,
  ) {}

  private async loadSharedDeviceState() {
    try {
      this.log.warn('Fetching shared device state');
      const response = await Client.get(currentState<SharedDeviceResponse>(this.devicesEndpoint), this.log);
      this.log.warn('Shared device state:', response?.result);
      return response ? response.result : null;
    } catch (error) {
      this.log.warn('Error getting shared device status:', error);
      return null;
    }
  }

  async currentLevelForSide(side: 'left' | 'right') {
    const currentSettings = await this.sharedDeviceSettings;
    if (side === 'left') {
      return currentSettings ? currentSettings.leftHeatingLevel : 0;
    } else {
      return currentSettings ? currentSettings.rightHeatingLevel : 0;
    }
  }
}


export class AccessoryClientAdapter {
  private usersEndpoint = resolveUsersUrl(this.accessoryUserId);
  private currentUserSettings = this.fetchCurrentSettings();

  constructor(
      readonly accessoryUserId: string,
      private readonly log: Logger,
  ) {}

  private async fetchCurrentSettings() {
    try {
      // Returns `level` and `currentState`, i.e. mode `type: smart` or `type: off`
      const response = await Client.get(currentState<UserSettings>(this.usersEndpoint), this.log);
      this.log.debug('Current device state:', response);
      return response;
    } catch (error) {
      this.log.error('Error fetching current user device settings from client');
      return null;
    }
  }

  async userTargetLevel() {
    const settings = await this.currentUserSettings;
    // `currentLevel` represents temp at which bed is *currently set* to
    // i.e. not the measured temp of the bed, but target temp
    return settings ? settings.currentLevel : 0;
  }

  // Current Device On/Off Status & Updates
  async accessoryIsOn() {
    const settings = await this.currentUserSettings;
    return settings?.currentState.type !== DeviceMode.off;
  }

  /**
   * `PUT` methods below to alter client device state after local changes.
   * - Each of these methods returns a full response object `UserSettings`
   * - Rather than making a `PUT` followed by a `GET`, we update the stored
   *   `currentUserSettings` Promise with each client `PUT` response
   */

  // Update Bed Temperature ('level') --> target temp locally == 'currentLevel' in client API
  async updateUserTargetLevel(newLevel: number) {
    const response = await Client.put(updateState<UserSettings>(this.usersEndpoint, 'currentLevel', newLevel));
    this.updateCurrentSettingsFrom(response);
    this.log.debug('Updated bed temp (level):', response?.currentLevel);
    return response ? response.currentLevel : newLevel;
  }

  async turnOnAccessory() {
    const onState = stateFor(DeviceMode.on);
    const response = await Client.put(updateState<UserSettings>(this.usersEndpoint, 'currentState', onState));
    this.updateCurrentSettingsFrom(response);
    /**
     * Since client returns 'smart:bedtime', 'smart:initial', or 'smart:final'
     * depending on when the request is made, it makes checking if response
     * is === `BedState.on` complicated (`on` enum value is just 'smart').
     * Easier to ensure not 'off' instead of checking if some 'smart:...'
     */
    return response?.currentState.type !== DeviceMode.off;
  }

  async turnOffAccessory() {
    const offState = stateFor(DeviceMode.off);
    const response = await Client.put(updateState<UserSettings>(this.usersEndpoint, 'currentState', offState));
    this.updateCurrentSettingsFrom(response);
    return response?.currentState.type === DeviceMode.off;
  }

  // Reset to new value whenever a client `PUT` request returns updated response
  private updateCurrentSettingsFrom(response: UserSettings | null) {
    this.currentUserSettings = Promise.resolve(response);
  }

}