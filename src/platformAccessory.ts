import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { EightSleepThermostatPlatform } from './platform';
import { tempMapper, TwoWayTempMapper } from './twoWayTempMapper';
import { AccessoryClientAdapter, PlatformClientAdapter } from './clientAdapter';

export class EightSleepThermostatAccessory {
  private service: Service;
  private readonly log = this.platform.log;

  // Minstep calculated based on temp mapping of °C & °F locally,
  // and to ensure precision when converting between degrees/levels
  // when updating and fetching from client API.
  //
  // Since minstep slightly greater than 0.5, max temp allowed needs
  // to be greater than 45 (i.e. 45.1) to ensure we can set the temp
  // to the max on accessory in Home app (displayed as 113°F & 45°C).
  private minStep = 0.55556;
  private minTempC = 10;
  private maxTempC = 45.1;
  private temperatureDisplayUnits = 1;

  private tempMapper: TwoWayTempMapper = tempMapper;
  private userIdForSide = this.accessory.context.device.userId as string;
  private deviceSide = this.accessory.context.device.side as 'left' | 'right';

  // Used to update device settings, specific to each accessory
  private accessoryClient: AccessoryClientAdapter;

  // Time of last CurrentTemp `GET` request made by controller
  private lastActive: number;
  private refreshInterval?: ReturnType<typeof setInterval> | null;

  constructor(
    private readonly platform: EightSleepThermostatPlatform,
    private readonly accessory: PlatformAccessory,
    // PlatformClientAdapter used to fetch device info, shared between accessories
    // since the device info for both sides is returned from single call to API
    private readonly platformClient: PlatformClientAdapter,
    // private isNotResponding: boolean = false,
  ) {
    this.log.debug('Accessory Context:', this.accessory.context);

    this.accessoryClient = new AccessoryClientAdapter(this.userIdForSide, this.log);

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Eight Sleep')
      .setCharacteristic(this.platform.Characteristic.Model, 'Pod Pro')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.UUID);

    this.service = this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat);

    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);

    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this))
      .setProps({ validValues: [
        this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
        this.platform.Characteristic.CurrentHeatingCoolingState.HEAT,
        this.platform.Characteristic.CurrentHeatingCoolingState.COOL ]});

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this))
      .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
      .setProps({ validValues: [
        this.platform.Characteristic.TargetHeatingCoolingState.OFF,
        this.platform.Characteristic.TargetHeatingCoolingState.AUTO ]});

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this))
      .setProps({ minStep: this.minStep, minValue: this.minTempC, maxValue: this.maxTempC });

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onSet(this.handleTargetTemperatureSet.bind(this))
      .onGet(this.handleTargetTemperatureGet.bind(this))
      .setProps({ minStep: this.minStep, minValue: this.minTempC, maxValue: this.maxTempC });

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this))
      .onGet(this.handleTemperatureDisplayUnitsGet.bind(this));

    this.lastActive = Date.now();
    this.refreshInterval = this.startRefreshing();
  }

  private setPluginAsActive() {
    this.lastActive = Date.now();

    if (!this.refreshInterval) {
      // Fetch new state & start refreshing every 5 seconds for next 2 minutes
      this.refreshInterval = this.startRefreshing();
    }
  }

  private startRefreshing() {
    // Fetch updated info from adapters every 5 seconds (while active)
    // NOTE: this logic loads the last fetched values, it does not initiate
    // a new fetch. Since each adapter sets its own fetch interval, we just
    // need to load from the previous values already retrieved
    return setInterval(this.refreshState, 1000 * 5);
  }

  private refreshState = () => {
    this.publishLatestChanges();
    this.clearRefreshIfNotActive();
  };

  private clearRefreshIfNotActive() {
    if (this.refreshInterval && this.lastActive < Date.now() - 1000 * 60 * 2) {
      // Go into standby until next time there is controller activity
      this.log.warn('No activity detected for >2 minute, entering plugin standby...');
      global.clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  // Updates values every 5 seconds using the latest data that was
  // downloaded by platform & accessory client adapters. These updates
  // are published without directly initiating new requests to client
  // API, thus limiting unnecessary network requests.
  private publishLatestChanges = async () => {
    const [targetState, targetLevel] = await this.accessoryClient.checkForUpdates();
    const targetTemp = this.tempMapper.levelToCelsius(targetLevel);
    this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, targetState);
    this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, targetTemp);

    const currentLevel = await this.platformClient.checkForUpdates(this.deviceSide);
    const currentTemp = this.tempMapper.levelToCelsius(currentLevel);
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, currentTemp);

    const currentState = this.characteristicValueForCurrentState(currentTemp, targetTemp, targetState);
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, currentState);
  };

  /**
   * Gets the *measured* current temperature of each side of bed from
   * client API. This metric is returned from client for both sides
   * of bed from the same endpoint. In order to prevent multiple
   * unecessary requests to the same endpoint for each side of bed,
   * we query API once and parse the data using the 'side' property
   */
  private async fetchCurrentTemp() {
    const currentMeasuredLevel = await this.platformClient.getCurrentLevelForSide(this.deviceSide);
    const currentC = this.tempMapper.levelToCelsius(currentMeasuredLevel);
    return currentC;
  }

  private async fetchTargetState() {
    const accessoryIsOn = await this.accessoryClient.getAccessoryIsOn();
    const targetState = accessoryIsOn ? 3 : 0;
    return targetState;
  }

  private async fetchTargetTemp() {
    const targetLevel = await this.accessoryClient.getUserTargetLevel();
    const targetC = this.tempMapper.levelToCelsius(targetLevel);
    return targetC;
  }

  private async fetchCurrentState() {
    const [targetState, currTemp, targetTemp] = [
      await this.fetchTargetState(),
      await this.fetchCurrentTemp(),
      await this.fetchTargetTemp()];

    return this.characteristicValueForCurrentState(currTemp, targetTemp, targetState);
  }

  private characteristicValueForCurrentState(currentTemp: number, targetTemp: number, targetState: number) {
    if (targetState === 0) {
      return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    }

    if (this.tempsAreEqual(currentTemp, targetTemp)) {
      return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    } else if (currentTemp < targetTemp) {
      return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
    } else {
      return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
    }
  }

  private async updateCurrentHCState() {
    const currState = await this.fetchCurrentState();
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, currState);
  }

  private async updateTargetTemperature(tempC: number) {
    const targetLevel = this.tempMapper.celsiusToLevel(tempC);

    if (!targetLevel || targetLevel > 100 || targetLevel < -100) {
      this.log.error('Something went wrong calculating new bed temp:', targetLevel);
      return;
    }

    const receivedLevel = await this.accessoryClient.updateUserTargetLevel(targetLevel);
    this.verifyInSyncTemps(tempC, targetLevel, receivedLevel);
    this.updateCurrentHCState();
  }

  private async updateDeviceState(newValue: number) {
    const side = this.deviceSide as 'left' | 'right';
    if (newValue === 3) {
      await this.accessoryClient.turnOnAccessory();
    } else if (newValue === 0) {
      await this.accessoryClient.turnOffAccessory();
    }
    this.log.debug(`Toggled device state -> ${newValue} for device:`, side);
    this.updateCurrentHCState();
  }


  /**
   * Current Temperature & State Handlers
   */
  async handleCurrentHeatingCoolingStateGet() {
    const currentState = await this.fetchCurrentState();
    this.log.debug(`${this.deviceSide} GET CurrentHeatingCoolingState`, currentState);
    this.setPluginAsActive();
    return currentState;
  }

  async handleCurrentTemperatureGet() {
    const currTemp = await this.fetchCurrentTemp();
    this.log.debug(`${this.deviceSide} GET CurrentTemperature`, currTemp);
    this.setPluginAsActive();
    return currTemp;
  }


  /**
   * Target Temperature Handlers
   */
  async handleTargetTemperatureGet() {
    const targetTemp = await this.fetchTargetTemp();
    this.log.debug(`${this.deviceSide} GET TargetTemperature`, targetTemp);
    this.setPluginAsActive();
    return targetTemp;
  }

  async handleTargetTemperatureSet(value: CharacteristicValue) {
    const targetTemp = value as number;
    this.updateTargetTemperature(targetTemp);
    this.log.debug(`${this.deviceSide} SET TargetTemperature:`, targetTemp);
    this.setPluginAsActive();
  }


  /**
   * Target State Handlers
   */
  async handleTargetHeatingCoolingStateGet() {
    const targetState = await this.fetchTargetState();
    this.log.debug(`${this.deviceSide} GET TargetHeatingCoolingState`, targetState);
    this.setPluginAsActive();
    return targetState;
  }

  async handleTargetHeatingCoolingStateSet(value: CharacteristicValue) {
    const newTargetState = value as number;
    this.updateDeviceState(newTargetState);
    this.log.debug(`${this.deviceSide} SET TargetHeatingCoolingState:`, newTargetState);
    this.setPluginAsActive();
  }


  /**
   * Temperature Display Units Handlers
   */
  async handleTemperatureDisplayUnitsGet() {
    const tempUnits = this.temperatureDisplayUnits;
    this.setPluginAsActive();
    return tempUnits;
  }

  async handleTemperatureDisplayUnitsSet(value: CharacteristicValue) {
    this.temperatureDisplayUnits = value as number;
    this.setPluginAsActive();
  }


  /**
   * Adjust equality comparison to account for the `minStep` property
   * of 0.5 on Target temp. Ensures that display temps are actually
   * equal when determining the current state. If target state is set
   * to `on` (`Auto`, `Cool`, `Heat`), then current state will display
   * `Idle` in home status when temps are equal.
   */
  private tempsAreEqual(current: number, target: number) {
    const diff = Math.abs(target - current);
    return (diff <= 0.55);
  }

  private verifyInSyncTemps(targetC: number, targetLevel: number, receivedLevel: number) {
    const formattedC = this.tempMapper.formatCelsius(targetC);
    const clientTargetC = this.tempMapper.levelToCelsius(receivedLevel);

    if (formattedC !== clientTargetC || targetLevel !== receivedLevel) {
      const expectation = `${formattedC}°C / ${targetLevel} level`;
      const received = `${clientTargetC}°C / ${receivedLevel} level`;
      this.log.error(`Local/remote temp mismatch. Expected: ${expectation}, but got: ${received}`);
    }
  }

}