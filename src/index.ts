import { API } from 'homebridge';
import { PLATFORM_NAME } from './settings';
import { EightSleepThermostatPlatformPlugin } from './platform';
// import { PlatformPluginConstructor } from 'homebridge';

/**
 * This method registers the platform with Homebridge
 */
// export = (api: API) => {
//   api.registerPlatform(PLATFORM_NAME,
//     EightSleepThermostatPlatformPlugin as PlatformPluginConstructor);
// };

export = (api: API) => {
  api.registerPlatform(PLATFORM_NAME,
    EightSleepThermostatPlatformPlugin);
};