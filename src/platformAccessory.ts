import { Service, PlatformAccessory, Logger, CharacteristicValue } from 'homebridge';

import { EightSleepThermostatPlatform } from './platform';


export class EightSleepThermostatAccessory {
  private service: Service;

  private tempDisplayUnits = 1;
  private minTemp = 10;
  private maxTemp = 45;

  private currTemp = 28;
  private targetTemp = 25;

  private bedState = 1;

  constructor(
    private readonly platform: EightSleepThermostatPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly log: Logger,
  ) {

    this.log.debug('Accessory Context:', this.accessory.context);

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
      .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this));

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


  // Current Temperature & State Handlers
  handleCurrentTemperatureGet() {
    this.log.debug('Triggered GET CurrentTemperature', this.currTemp);
    return this.currTemp;
  }

  handleCurrentHeatingCoolingStateGet() {
    this.log.debug('Triggered GET CurrentHeatingCoolingState', this.bedState);

    // Displayed in HomeKit "status" (section at top of home/room screen):
    switch (true) {
      case (this.bedState !== 0 && this.currTemp > this.targetTemp):
        //  1. 'Cooling' with blue 'down arrow' & current temp on blue circle
        return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;

      case (this.bedState !== 0 && this.currTemp < this.targetTemp):
        //  2. 'Heating' with orange 'up arrow' & current temp on orange circle
        return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;

      default:
        // if target state is on && current temp === target temp:
        //    3. 'Idle' with 'green/white hyphen' & current temp on green circle
        // else if target state is off:
        //    4. 'Off' with current temp inside transparent circle
        return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    }
  }

  // Target Temperature & State Handlers
  handleTargetTemperatureGet() {
    this.log.debug('Triggered GET TargetTemperature', this.targetTemp);
    return this.targetTemp;
  }

  handleTargetTemperatureSet(value: CharacteristicValue) {
    this.targetTemp = value as number;
    this.log.debug('Triggered SET TargetTemperature:', this.targetTemp);
  }

  handleTargetHeatingCoolingStateGet() {
    this.log.debug('Triggered GET TargetHeatingCoolingState');

    if (this.bedState === 0) {
      return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    } else {
      return this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
    }
  }

  handleTargetHeatingCoolingStateSet(value: CharacteristicValue) {
    this.bedState = value as number;
    this.log.debug('Triggered SET TargetHeatingCoolingState:', this.bedState);
  }

  // Temperature Display Units Handlers
  handleTemperatureDisplayUnitsGet() {
    this.log.debug('Triggered GET TemperatureDisplayUnits', this.tempDisplayUnits);
    return this.tempDisplayUnits;
  }

  handleTemperatureDisplayUnitsSet(value: CharacteristicValue) {
    this.tempDisplayUnits = value as number;
    this.log.debug('Triggered SET TemperatureDisplayUnits:', this.tempDisplayUnits);
  }
}