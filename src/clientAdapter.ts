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

  // Time of last CurrentTemp `GET` request made by controller
  private lastActive = Date.now();
  private refreshInterval?: ReturnType<typeof setInterval> | null;

  constructor(
    readonly sharedDeviceId: string,
    private readonly log: Logger,
  ) {
    this.refreshInterval = this.startRefreshing();
  }

  private async loadSharedDeviceState() {
    try {
      const response = await Client.get(currentState<SharedDeviceResponse>(this.devicesEndpoint), this.log);
      this.log.debug('Fetched device settings');
      return response ? response.result : null;
    } catch (error) {
      this.log.error('Error getting shared device status:', error);
      return null;
    }
  }

  private refreshState = () => {
    this.sharedDeviceSettings = this.loadSharedDeviceState();
    this.clearRefreshIfNotActive();
  };

  private startRefreshing() {
    // Fetch updated client API temps every 10 seconds (while active)
    return setInterval(this.refreshState, 1000 * 15);
  }

  /**
   * When `GET` CurrentTemp handler fired, update last active timestamp.
   * Continuing refreshing state every 15 seconds while active, but once
   * handler hasn't been fired in more than 1.5 minutes, cancel the refresh
   * interval... i.e. we only continue hitting the client API while a home
   * controller is actively requesting an updated current temperature,
   * otherwise go into standby to prevent unnecessary requests
   */
  private clearRefreshIfNotActive() {
    this.log.debug('Platform client last active:', new Date(this.lastActive));
    if (this.refreshInterval && this.lastActive < Date.now() - 1000 * 90) {
      // Go into standby until next time there is controller activity
      this.log.debug('No platform activity detected for >1.5 minute, entering standby...');
      global.clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  async getCurrentLevelForSide(side: 'left' | 'right') {
    this.lastActive = Date.now();

    if (!this.refreshInterval) {
      // Fetch new state & start refreshing every 15 seconds for next 1.5 minutes
      this.sharedDeviceSettings = this.loadSharedDeviceState();
      this.refreshInterval = this.startRefreshing();
    }

    return this.checkForUpdates(side);
  }

  async checkForUpdates(side: 'left' | 'right') {
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

  // Time of last `GET` request made by controller to fetch on/off state or target temp
  private lastActive = Date.now();
  private refreshInterval?: ReturnType<typeof setInterval> | null;

  constructor(
    readonly accessoryUserId: string,
    private readonly log: Logger,
  ) {
    this.refreshInterval = this.startRefreshing();
  }

  private async fetchCurrentSettings() {
    try {
      // Returns `level` and `currentState`, i.e. mode `type: smart` or `type: off`
      const response = await Client.get(currentState<UserSettings>(this.usersEndpoint), this.log);
      this.log.debug('Fetched current device state');
      return response;
    } catch (error) {
      this.log.error('Error fetching current user device settings from client');
      return null;
    }
  }

  async getUserTargetLevel() {
    this.setAccessoryAsActive();
    const settings = await this.currentUserSettings;
    // `currentLevel` represents temp at which bed is *currently set* to
    // i.e. not the measured temp of the bed, but target temp
    return settings ? settings.currentLevel : 0;
  }

  // Current Device On/Off Status & Updates
  async getAccessoryIsOn() {
    this.setAccessoryAsActive();
    const settings = await this.currentUserSettings;
    return settings?.currentState.type !== DeviceMode.off;
  }

  async checkForUpdates() {
    const settings = await this.currentUserSettings;
    if (settings) {
      const targetLevel = settings.currentLevel;
      const targetState = settings.currentState.type === DeviceMode.off ? 0 : 3;
      return [targetState, targetLevel];
    } else {
      return [0, 0];
    }
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
    this.log.debug('Updated current settings');
    this.setAccessoryAsActive();
    this.currentUserSettings = Promise.resolve(response);
  }

  private setAccessoryAsActive() {
    this.lastActive = Date.now();

    if (!this.refreshInterval) {
      // Fetch new state & start refreshing every 15 seconds for next 1.5 minutes
      this.currentUserSettings = this.fetchCurrentSettings();
      this.refreshInterval = this.startRefreshing();
    }
  }

  /**
   * Refresh interval to continue updating state for accessory
   * while there is Homekit controller actvity
   */
  private refreshState = async () => {
    this.currentUserSettings = this.fetchCurrentSettings();
    this.clearRefreshIfNotActive();
  };

  private startRefreshing() {
    // Fetch updated client accessory state & target temp every 15 seconds (while active)
    return setInterval(this.refreshState, 1000 * 15);
  }

  /**
   * When `GET` CurrentTemp handler fired, update last active timestamp.
   * Continuing refreshing state every 15 seconds while active, but once
   * handler hasn't been fired in more than 1.5 minutes, cancel the refresh
   * interval... i.e. we only continue hitting the client API while a home
   * controller is actively requesting an updated current temperature,
   * otherwise go into standby to prevent unnecessary requests
   */
  private clearRefreshIfNotActive() {
    this.log.debug('Accessory client last active:', new Date(this.lastActive));
    if (this.refreshInterval && this.lastActive < Date.now() - 1000 * 90) {
      // Go into standby until next time there is controller activity
      this.log.warn('No accessory activity detected for >1.5 minute, entering standby...');
      global.clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}