import { Service, PlatformAccessory, CharacteristicValue, HAPStatus } from 'homebridge';
import { EightSleepThermostatPlatform } from './platform';
import { tempMapper, TwoWayTempMapper } from './twoWayTempMapper';
import { AccessoryClientAdapter, PlatformClientAdapter } from './clientAdapter';

export class EightSleepThermostatAccessory {
  private service: Service;
  private readonly log = this.platform.log;

  private minTemp = 10;
  private maxTemp = 45;

  private Thermostat_data: Record<string, CharacteristicValue> = {
    CurrentHeatingCoolingState: 0,
    TargetHeatingCoolingState: 0,
    CurrentTemperature: 34,
    TargetTemperature: 26,
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
      .setProps({ minValue: this.minTemp, maxValue: this.maxTemp });

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onSet(this.handleTargetTemperatureSet.bind(this))
      .onGet(this.handleTargetTemperatureGet.bind(this))
      .setProps({ minStep: 0.5, minValue: this.minTemp, maxValue: this.maxTemp });

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this))
      .onGet(this.handleTemperatureDisplayUnitsGet.bind(this));
  }

  private ensureDeviceResponsiveness() {
    if (this.isNotResponding) {
      throw new this.platform.api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async fetchDeviceStatus() {
    const isOn = await this.client.isDeviceOn();
    const targetState = isOn ? 3 : 0;
    this.Thermostat_data.TargetHeatingCoolingState = targetState;
    this.log.debug('Fetched target state:', targetState);
  private async updateTargetTemperature(newValue: CharacteristicValue) {
    const targetCelsius = newValue as number;
    const targetLevel = this.tempMapper.getLevelFromCelsius(targetCelsius);
    this.log.warn(`New target ${targetCelsius}°F ==> level ${targetLevel}`);

    if (!targetLevel || targetLevel > 100 || targetLevel < -100) {
      this.log.error('Something went wrong calculating new bed temp:', targetLevel);
      return;
    }
    this.accessoryClient.updateUserTargetLevel(targetLevel);
  }

  // Current Temperature & State Handlers
  async handleCurrentHeatingCoolingStateGet() {
    this.ensureDeviceResponsiveness();
    const currentState = this.Thermostat_data.CurrentHeatingCoolingState as number;
    this.log.debug('GET CurrentHeatingCoolingState', currentState);
    return currentState;
  }

  async handleCurrentTemperatureGet() {
    this.ensureDeviceResponsiveness();
    const currTemp = this.Thermostat_data.CurrentTemperature;
    this.log.debug('GET CurrentTemperature', currTemp);
    return currTemp;
  }

  // Target Temperature & State Handlers
  async handleTargetTemperatureGet() {
    this.ensureDeviceResponsiveness();
    const targetTemp = this.Thermostat_data.TargetTemperature;
    this.log.debug('GET TargetTemperature', targetTemp);
    return targetTemp;
  }

  async handleTargetTemperatureSet(value: CharacteristicValue) {
    this.ensureDeviceResponsiveness();
    // Send request to Eight Sleep Client to update current state (only if value has changed)
    if (this.Thermostat_data.TargetTemperature !== value) {
      this.updateDeviceTemperature(value);
    }
    this.Thermostat_data.TargetTemperature = value as number;
    this.log.debug('SET TargetTemperature:', value);
    this.triggerCurrentHeatingCoolingStateUpdate();
  }

  async handleTargetHeatingCoolingStateGet() {
    this.ensureDeviceResponsiveness();
    const targetState = this.Thermostat_data.TargetHeatingCoolingState;
    this.log.debug('GET TargetHeatingCoolingState', targetState);
    return targetState;
  }

  async handleTargetHeatingCoolingStateSet(value: CharacteristicValue) {
    this.ensureDeviceResponsiveness();
    // Send request to Eight Sleep Client to update current state (only if value has changed)
    if (this.Thermostat_data.TargetHeatingCoolingState !== value) {
      this.updateDeviceState(value);
    }
    this.Thermostat_data.TargetHeatingCoolingState = value as number;
    this.log.debug('SET TargetHeatingCoolingState:', value);
    this.triggerCurrentHeatingCoolingStateUpdate();
  }

  // Temperature Display Units Handlers
  async handleTemperatureDisplayUnitsGet() {
    this.ensureDeviceResponsiveness();
    const tempUnits = this.Thermostat_data.TemperatureDisplayUnits;
    this.log.debug('GET TemperatureDisplayUnits', tempUnits);
    return tempUnits;
  }

  async handleTemperatureDisplayUnitsSet(value: CharacteristicValue) {
    this.ensureDeviceResponsiveness();
    this.Thermostat_data.TemperatureDisplayUnits = value as number;
    this.log.debug('SET TemperatureDisplayUnits:', value);
  }

  // Adjust equality comparison to account for the `minStep` property
  // of 0.5 on Target temp. Ensures that display temps are actually
  // equal when determining the current state. If target state is set
  // to `on` (`Auto`, `Cool`, `Heat`), then current state will display
  // `Idle` in home status when temps are equal.
  tempsAreEqual(current: number, target: number) {
    const diff = Math.abs(target - current);
    return (diff <= 0.49);
  }

  // Pushes changes to Current(Temp/State) via `updateCharacteristic()`
  // method. Called whenever Target(Temp/HeatingCoolingState) is changed
  // by a `set` Characteristic handler.
  private async triggerCurrentHeatingCoolingStateUpdate() {
    const currTemp = this.Thermostat_data.CurrentTemperature as number;
    const targetTemp = this.Thermostat_data.TargetTemperature as number;

    if (this.tempsAreEqual(currTemp, targetTemp) || this.Thermostat_data.TargetHeatingCoolingState === 0) {
      // If target state === 0 --> current state will display as 'Off' in Home app status
      // If target state === 1 && currTemp === targetTemp --> current state displays as 'Idle' in Home app status
      this.Thermostat_data.CurrentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState.OFF;

    } else if (currTemp < targetTemp) {
      this.Thermostat_data.CurrentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;

    } else if (currTemp > targetTemp) {
      this.Thermostat_data.CurrentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
    }

    // Manually push update through to speed up response time
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState,
      this.Thermostat_data.CurrentHeatingCoolingState);

    this.log.debug('Update CurrentState:', this.Thermostat_data.CurrentHeatingCoolingState);
  }

  private async updateDeviceState(newValue: CharacteristicValue) {
    if (newValue === 3) {
      this.log.warn('Turning on device ->', this.userIdForSide);
      this.accessoryClient.turnOnAccessory();
    } else if (newValue === 0) {
      this.accessoryClient.turnOffAccessory();
      this.log.warn('Turning off device ->', this.userIdForSide);
    }
  }

  private async updateDeviceTemperature(newValue: CharacteristicValue) {
    const targetTemp = newValue as number;
    const targetF = Math.round(targetTemp * 9/5) + 32;
    const targetLevel = this.tempMapper.getLevelFrom(targetF);
    this.log.warn(`New target ${targetF}°F ==> level ${targetLevel}`);

    if (!targetLevel || targetLevel > 100 || targetLevel < -100) {
      this.log.error('Something went wrong calculating new bed temp:', targetLevel);
      return;
    }

    this.client.updateBedTemp(targetLevel);
  }

}