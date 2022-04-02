import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { EightSleepThermostatPlatform } from './platform';

export class EightSleepThermostatAccessory {
  private service: Service;
  private readonly log = this.platform.log;

  private minTemp = 10;
  private maxTemp = 45;

  private Thermostat_data: Record<string, CharacteristicValue> = {
    CurrentHeatingCoolingState: 1,
    TargetHeatingCoolingState: 3,
    CurrentTemperature: 28,
    TargetTemperature: 33,
    TemperatureDisplayUnits: 1,
  };

  constructor(
    private readonly platform: EightSleepThermostatPlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.log.debug('Accessory Context:', this.accessory.context);

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Eight Sleep')
      .setCharacteristic(this.platform.Characteristic.Model, 'Pod Pro')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.UUID);

    this.service = this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat);

    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);

    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this))
      .setProps({validValues: [
        this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
        this.platform.Characteristic.CurrentHeatingCoolingState.HEAT,
        this.platform.Characteristic.CurrentHeatingCoolingState.COOL ]});

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this))
      .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
      .setProps({validValues: [
        this.platform.Characteristic.TargetHeatingCoolingState.OFF,
        this.platform.Characteristic.TargetHeatingCoolingState.AUTO ]});

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this))
      .setProps({ minStep: 1, minValue: this.minTemp, maxValue: this.maxTemp });

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onSet(this.handleTargetTemperatureSet.bind(this))
      .onGet(this.handleTargetTemperatureGet.bind(this))
      .setProps({ minStep: 1, minValue: this.minTemp, maxValue: this.maxTemp });

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this))
      .onGet(this.handleTemperatureDisplayUnitsGet.bind(this));

  }


  // Current Temperature & State Handlers
  async handleCurrentHeatingCoolingStateGet() {
    const currentState = this.Thermostat_data.CurrentHeatingCoolingState as number;
    this.log.debug('Triggered GET CurrentHeatingCoolingState', currentState);
    return currentState;
  }

  async handleCurrentTemperatureGet() {
    const currTemp = this.Thermostat_data.CurrentTemperature;
    this.log.debug('Triggered GET CurrentTemperature', currTemp);
    return currTemp;
  }

  // Target Temperature & State Handlers
  async handleTargetTemperatureGet() {
    const targetTemp = this.Thermostat_data.TargetTemperature;
    this.log.debug('Triggered GET TargetTemperature', targetTemp);
    return targetTemp;
  }

  async handleTargetTemperatureSet(value: CharacteristicValue) {
    this.Thermostat_data.TargetTemperature = value as number;
    const currTemp = this.Thermostat_data.CurrentTemperature as number;
    const targetTemp = this.Thermostat_data.TargetTemperature as number;

    // Update current heating/cooling state...
    if (currTemp < targetTemp) {
      this.Thermostat_data.CurrentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;

    } else if (currTemp > targetTemp) {
      this.Thermostat_data.CurrentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState.COOL;

    } else {
      // currTemp === targetTemp...will display as 'Idle' in Home app status
      this.Thermostat_data.CurrentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    }

    // Manually push update through to speed up response time
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState,
      this.Thermostat_data.CurrentHeatingCoolingState);

    this.log.debug('Triggered SET TargetTemperature:', this.Thermostat_data.TargetTemperature,
      'and updated current heating/cooling state:', this.Thermostat_data.CurrentHeatingCoolingState);
  }

  async handleTargetHeatingCoolingStateGet() {
    const targetState = this.Thermostat_data.TargetHeatingCoolingState;
    this.log.debug('Triggered GET TargetHeatingCoolingState', targetState);
    return targetState;
  }

  async handleTargetHeatingCoolingStateSet(value: CharacteristicValue) {
    // TODO - update current heating cooling state
    this.Thermostat_data.TargetHeatingCoolingState = value as number;
    this.log.debug('Triggered SET TargetHeatingCoolingState:', value);
  }

  // Temperature Display Units Handlers
  async handleTemperatureDisplayUnitsGet() {
    const tempUnits = this.Thermostat_data.TemperatureDisplayUnits;
    this.log.debug('Triggered GET TemperatureDisplayUnits', tempUnits);
    return tempUnits;
  }

  async handleTemperatureDisplayUnitsSet(value: CharacteristicValue) {
    this.Thermostat_data.TemperatureDisplayUnits = value as number;
    this.log.debug('Triggered SET TemperatureDisplayUnits:', value);
  }

}