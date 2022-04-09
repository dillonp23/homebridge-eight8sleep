
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
export class TwoWayTempMapper {
  private tempsF: Record<number, number> = {};
  private levels: Record<number, number> = {};

  constructor() {
    this.generateMaps();
  }

  public getFahrenheitFrom(level: number) {
    return this.levels[level];
  }

  public getCelsiusFrom(level: number) {
    const farenheit = this.levels[level];
    return Math.round((farenheit - 32) * 5/9);
  }

  public convertToCelsius(farenheit: number) {
    return Math.round((farenheit - 32) * 5/9);
  }

  public convertToFahrenheit(celsius: number) {
    return Math.round(celsius * 9/5) + 32;
  }

  public getLevelFromFahrenheit(degF: number) {
    return this.tempsF[degF];
  }

  public getLevelFromCelsius(degC: number) {
    const farenheit = Math.round(degC * 9/5) + 32;
    return this.tempsF[farenheit];
  }

  /**
     * Actual min. on Homekit thermostat is 50°, but client API applies a different
     * weight to 'real' temps when between 50°F-61°F. For this initial lower bound
     * each 1°F displayed in 8slp app corresponds to a 'level' increase of +1.
     *  - i.e. between 55°F/61°F, the level ranges from -96 to -90 (each 1°F is
     *    equivalent to +1 level), whereas above 62°F, each 1°F corresponds to an
     *    increase of approx. +3 on the client API's 'level' scale.
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
    if (!this.tempsF[temp]) {
      this.tempsF[temp] = level;
    }
  }

  private calculateTempFrom(level: number) {
    switch (true) {
      case (level <= -89):
        // Adjust temp according to (seemingly) arbitrary client api values.
        // Cooling levels between -100 & -89 from the API correspond to a
        // single degree difference locally on thermostat
        return 50 - (-100 - level);

      case (level <= this.cooling_level_end):
        // Cooling level range -88 <= level <= 0
        // Each 1°F corresponds to approx. +3 on 'level' scale
        return this.getCoolingTemp(level);

      default:
        // Heating level range 0 <= level <= 100
        // Each 1°F corresponds to approx. +3 on 'level' scale
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

export const tempMapper = new TwoWayTempMapper();