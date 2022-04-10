import { Service, PlatformAccessory, CharacteristicValue, HAPStatus } from 'homebridge';
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

  private Thermostat_data: Record<string, CharacteristicValue> = {
    CurrentHeatingCoolingState: 0,
    TargetHeatingCoolingState: 0,
    CurrentTemperature: 0,
    TargetTemperature: 0,
    TemperatureDisplayUnits: 1,
  };

  private tempMapper: TwoWayTempMapper = tempMapper;
  private userIdForSide = this.accessory.context.device.userId as string;
  private deviceSide = this.accessory.context.device.side as string;

  // Used to update device settings, specific to each accessory
  private accessoryClient: AccessoryClientAdapter;

  constructor(
    private readonly platform: EightSleepThermostatPlatform,
    private readonly accessory: PlatformAccessory,
    // PlatformClientAdapter used to fetch device info, shared between accessories
    // since the device info for both sides is returned from single call to API
    private readonly platformClient: PlatformClientAdapter,
    private isNotResponding: boolean = false,
  ) {
    this.log.debug('Accessory Context:', this.accessory.context);

    this.accessoryClient = new AccessoryClientAdapter(this.accessory.context.device.userId, this.log);

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
  }

  /**
   * Gets the *measured* current temperature of each side of bed from
   * client API. This metric is returned from client for both sides
   * of bed from the same endpoint. In order to prevent multiple
   * unecessary requests to the same endpoint for each side of bed,
   * we query API once and parse the data using the 'side' property
   */
  private async fetchCurrentTemp() {
    const currentMeasuredLevel = await this.platformClient.currentLevelForSide(this.deviceSide as 'left' | 'right');
    const currentC = this.tempMapper.levelToCelsius(currentMeasuredLevel);
    return currentC;
  }

  private async fetchTargetState() {
    const accessoryIsOn = await this.accessoryClient.accessoryIsOn();
    const targetState = accessoryIsOn ? 3 : 0;
    return targetState;
  }

  private async fetchTargetTemp() {
    const targetLevel = await this.accessoryClient.userTargetLevel();
    const targetC = this.tempMapper.levelToCelsius(targetLevel);
    return targetC;
  }

  private async fetchCurrentState() {
    const targetState = await this.fetchTargetState();

    if (targetState === 0) {
      return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    }

    const [currTemp, targetTemp] = [await this.fetchCurrentTemp(), await this.fetchTargetTemp()];

    if (this.tempsAreEqual(currTemp, targetTemp)) {
      return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    } else if (currTemp < targetTemp) {
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
    if (newValue === 3) {
      await this.accessoryClient.turnOnAccessory();
    } else if (newValue === 0) {
      await this.accessoryClient.turnOffAccessory();
    }
    this.log.warn(`Toggled device state -> ${newValue} for device:`, this.userIdForSide);
    this.updateCurrentHCState();
  }


  /**
   * Current Temperature & State Handlers
   */
  async handleCurrentHeatingCoolingStateGet() {
    const currentState = await this.fetchCurrentState();
    this.log.debug(`${this.deviceSide} GET CurrentHeatingCoolingState`, currentState);
    return currentState;
  }

  async handleCurrentTemperatureGet() {
    const currTemp = await this.fetchCurrentTemp();
    this.log.debug(`${this.deviceSide} GET CurrentTemperature`, currTemp);
    return currTemp;
  }


  /**
   * Target Temperature Handlers
   */
  async handleTargetTemperatureGet() {
    const targetTemp = await this.fetchTargetTemp();
    this.log.debug(`${this.deviceSide} GET TargetTemperature`, targetTemp);
    return targetTemp;
  }

  async handleTargetTemperatureSet(value: CharacteristicValue) {
    const targetTemp = value as number;
    this.updateTargetTemperature(targetTemp);
    this.log.debug(`${this.deviceSide} SET TargetTemperature:`, targetTemp);
  }


  /**
   * Target State Handlers
   */
  async handleTargetHeatingCoolingStateGet() {
    const targetState = await this.fetchTargetState();
    this.log.debug(`${this.deviceSide} GET TargetHeatingCoolingState`, targetState);
    return targetState;
  }

  async handleTargetHeatingCoolingStateSet(value: CharacteristicValue) {
    const newTargetState = value as number;
    this.updateDeviceState(newTargetState);
    this.log.debug(`${this.deviceSide} SET TargetHeatingCoolingState:`, newTargetState);
  }


  /**
   * Temperature Display Units Handlers
   */
  async handleTemperatureDisplayUnitsGet() {
    const tempUnits = this.Thermostat_data.TemperatureDisplayUnits;
    return tempUnits;
  }

  async handleTemperatureDisplayUnitsSet(value: CharacteristicValue) {
    this.Thermostat_data.TemperatureDisplayUnits = value as number;
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