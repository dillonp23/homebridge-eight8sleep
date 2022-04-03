import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { EightSleepClient } from './eightSleepClient';
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

  private mapper = new TwoWayTempMapper(this.log);

  constructor(
    private readonly platform: EightSleepThermostatPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly client: EightSleepClient,
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
      .setProps({ minStep: 0.5, minValue: this.minTemp, maxValue: this.maxTemp });

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
    this.triggerCurrentHeatingCoolingStateUpdate();
  }

  async handleTargetHeatingCoolingStateGet() {
    const targetState = this.Thermostat_data.TargetHeatingCoolingState;
    this.log.debug('Triggered GET TargetHeatingCoolingState', targetState);
    return targetState;
  }

  async handleTargetHeatingCoolingStateSet(value: CharacteristicValue) {
    // Send request to Eight Sleep Client to update current state (only if value has changed)
    if (this.Thermostat_data.TargetHeatingCoolingState !== value) {
      this.updateEightSleepDeviceState(value, this.accessory.context.device.side);
    }
    this.Thermostat_data.TargetHeatingCoolingState = value as number;
    this.log.debug('Triggered SET TargetHeatingCoolingState:', value);
    this.triggerCurrentHeatingCoolingStateUpdate();
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

  // Pushes changes to Current(Temp/State) via `updateCharacteristic()`
  // method. Called whenever Target(Temp/HeatingCoolingState) is changed
  // by a `set` Characteristic handler.
  private async triggerCurrentHeatingCoolingStateUpdate() {
    const currTemp = this.Thermostat_data.CurrentTemperature as number;
    const targetTemp = this.Thermostat_data.TargetTemperature as number;

    if (this.Thermostat_data.TargetHeatingCoolingState === 0 || currTemp === targetTemp) {
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

    this.log.debug('Triggered Update of CurrentHeatingCoolingState:', this.Thermostat_data.CurrentHeatingCoolingState);
  }

  private async updateEightSleepDeviceState(newValue: CharacteristicValue, side: string) {
    if (newValue === 3) {
      this.log.warn('Turning on Eight Sleep device -> sending request to client', side);
    } else if (newValue === 0) {
      this.log.warn('Turning off Eight Sleep device -> sending request to client', side);
    }
  }

}

/**
 * Maps between 'real temps' (degrees °C/°F), and 'levels' used by client API.
 *
 * Locally temps range from 10°C - 45°C, and 50°F - 113°F, but the Eight Sleep
 * API uses a value between -100 (max cooling) to +100 (max heating), independent
 * of the temp units.
 *
 * Eight Sleep app gives users the choice between displaying 'real' temps
 * or displaying a value between -10 & +10. If user selects to display real
 * temps, there's a further specification between °F/°C. Regardless of what
 * the user decides to use, levels (-10/+10) or temps (°F/°C), all of the
 * logic to set the bed temperature is handled on the frontend app and is
 * sent to the client API as a value between -100 & +100. Thus, regardless
 * of user's preferred unit setting, the API always processes the values as
 * if there wasn't any units option at all.
 */
class TwoWayTempMapper {
  private temps: Record<number, number> = {};
  private levels: Record<number, number> = {};

  constructor(private readonly log: Logger) {
    this.generateMaps();
  }

  public getTempFrom(level: number) {
    return this.levels[level];
  }

  public getLevelFrom(temp: number) {
    return this.temps[temp];
  }

  /**
   * Actual min. on Homekit thermostat is 50°, but client API applies a different
   * weight to 'real' temps when between 50°F-61°F. For this initial lower bound
   * each 1°F displayed in 8slp app corresponds to a 'level' increase of +1.
   *  - i.e. between 55°F/61°F, the level ranges from -96 to -90 (each 1°F is
   *    equivalent to +1 level), whereas above 62°F, each 1°F corresponds to an
   *    increase of anywhere between +3/+5 on the client API's 'level' scale.
   *
   * Due to this, we need to apply some trickery to adjust our local thermostat
   * temperature to match the API. Although using 'real' temps in Eight Sleep app
   * doesn't allow going to the full min and max of -100/+100, this plugin has been
   * developed to enable users to do so. This plugin is also designed to keep the
   * current bed temp between Eight Sleep app and homekit as consistent as possible
   * to ensure cooling/heating temps aren't miasligned between the two.
   *
   * See {@linkcode calculateTempFrom()} method below to understand how this works
   */

  // Min & max cooling temps on thermostat
  private cooling_temp_start = 61;
  private cooling_temp_end = 80;

  // Range of cooling levels for client
  private cooling_level_start = -89;
  private cooling_level_end = -1;

  // Min & max heating temps on thermostat
  private heating_temp_start = 81;
  private heating_temp_end = 113;

  // Range of heating levels for client
  private heating_level_start = 2;
  private heating_level_end = 101;

  // Convert client api levels to 'real' temps for thermostat
  private generateMaps() {
    for (let lvl = -100; lvl <= 100; lvl++) {
      const temp = this.calculateTempFrom(lvl);
      this.updateRecords(temp, lvl);
    }
  }

  // Set temp/level records with inverse keys/values
  private updateRecords(temp: number, level: number) {
    this.levels[level] = temp;
    if (!this.temps[temp]) {
      this.temps[temp] = level;
    }
  }

  private calculateTempFrom(level: number) {
    switch (true) {
      case (level <= -89):
        // Adjust temp according to (seemingly) arbitrary client api values.
        // Cooling levels between -100 & -88 from the API correspond to a
        // single degree difference locally on thermostat
        return 50 - (-100 - level);

      case (level <= this.cooling_level_end):
        // Cooling level range -88 <= level <= 0
        // Each 1°F corresponds to +3 to +5 on 'level' scale
        return this.getCoolingTemp(level);

      default:
        // Heating level range 0 <= level <= 100
        // Each 1°F corresponds to +3 to +5 on 'level' scale
        return this.getHeatingTemp(level);
    }
  }

  private getCoolingTemp(level: number) {
    const slope = (this.cooling_temp_end - this.cooling_temp_start) / (this.cooling_level_end - this.cooling_level_start);
    const temp = this.cooling_temp_start + Math.round(slope * (level - this.cooling_level_start));
    return temp;
  }

  private getHeatingTemp(level: number) {
    const slope = (this.heating_temp_end - this.heating_temp_start) / (this.heating_level_end - this.heating_level_start);
    const temp = this.heating_temp_start + Math.round(slope * (level - this.heating_level_start));
    return temp;
  }

}