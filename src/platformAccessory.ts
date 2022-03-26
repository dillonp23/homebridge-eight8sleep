import { Service, PlatformAccessory, Logger, CharacteristicValue, Characteristic } from 'homebridge';

import { EightSleepThermostatPlatform } from './platform';


export class EightSleepThermostatAccessory {
  private service: Service;

  private tempDisplayUnits = 1;
  private minTemp = 10;
  private maxTemp = 45;

  private currTemp = 23;
  private targetTemp = 25;

  private bedState = 0;

  constructor(
    private readonly platform: EightSleepThermostatPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly log: Logger,
  ) {

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Eight Sleep')
      .setCharacteristic(this.platform.Characteristic.Model, 'Pod Pro')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, '123456-PodPro');

    this.service = this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat);

    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);

    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .setProps({validValues: [
        this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
        this.platform.Characteristic.CurrentHeatingCoolingState.HEAT,
        this.platform.Characteristic.CurrentHeatingCoolingState.COOL ]})
      .onGet(this.getCurrentHeatingCoolingState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({validValues: [
        this.platform.Characteristic.TargetHeatingCoolingState.OFF,
        this.platform.Characteristic.TargetHeatingCoolingState.AUTO ]})
      .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .setProps({ minStep: 1, minValue: this.minTemp, maxValue: this.maxTemp })
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({ minStep: 1, minValue: this.minTemp, maxValue: this.maxTemp })
      .onGet(this.handleTargetTemperatureGet.bind(this))
      .onSet(this.handleTargetTemperatureSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(this.handleTemperatureDisplayUnitsGet.bind(this))
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this));

  }

  getCurrentHeatingCoolingState() {
    this.log.debug('Triggered GET CurrentHeatingCoolingState');

    this.log.debug('Current temp:', this.currTemp);
    this.log.debug('Target temp:', this.targetTemp);

    if (this.bedState === 0) {
      return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    }

    if (this.currTemp < this.targetTemp) {
      return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
    } else {
      return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
    }
  }

  handleTargetHeatingCoolingStateGet() {
    this.log.debug('Triggered GET TargetHeatingCoolingState');

    if (this.bedState === 0) {
      return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    } else {
      return this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
    }
  }

  handleTargetHeatingCoolingStateSet(value) {
    this.log.debug('Triggered SET TargetHeatingCoolingState:', value);

    this.bedState = value;
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .updateValue(value);

    // TODO: send request to update status for 8sleep api
  }

  handleCurrentTemperatureGet() {
    this.log.debug('Triggered GET CurrentTemperature');
    return this.currTemp;
  }

  handleTargetTemperatureGet() {
    this.log.debug('Triggered GET TargetTemperature');
    return this.targetTemp;
  }

  handleTargetTemperatureSet(value) {
    this.log.debug('Triggered SET TargetTemperature:', value);
    this.targetTemp = value;

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .updateValue(value);

    this.log.debug('Updated target temperature, new value:', this.targetTemp);

    this.getCurrentHeatingCoolingState();
  }

  handleTemperatureDisplayUnitsGet() {
    this.log.debug('Triggered GET TemperatureDisplayUnits');

    return this.tempDisplayUnits;
  }

  handleTemperatureDisplayUnitsSet(value) {
    this.log.debug('Triggered SET TemperatureDisplayUnits:', value);
    this.tempDisplayUnits = value;
  }
}