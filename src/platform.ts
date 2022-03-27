import {
  API,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { EightSleepThermostatAccessory } from './platformAccessory';
const pluginDisplayName = 'Eight Sleep Thermostat';

export class EightSleepThermostatPlatform {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  private loadingError?: Error;

  // track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    try {
      if (!this.config['email'] || !this.config['password']) {
        const configError = new Error(
          'You need to specify your Eight Sleep account credentials (email & password). Either manually update ' +
          'the \'config.json\' file, or from your Homebridge dashboard -> navigate to the \'Plugins\' tab -> find ' +
          `'${pluginDisplayName}' in the list of installed plugins, & click 'SETTINGS' to complete account setup.`);

        throw (configError);
      }

      this.log.debug('Finished initializing platform:', this.config.name);

      this.api.on('didFinishLaunching', () => {
        log.debug('Executed didFinishLaunching callback');
        this.discoverDevices();
      });

    } catch (error) {
      const loadingError = error as Error;
      this.loadingError = loadingError;
      this.log.error('Unable to setup plugin:', loadingError.message);
    }
  }

  /**
   * REQUIRED - Homebridge will call "configureAccessory" method once for each restored cached accessory
   */
  configureAccessory(accessory: PlatformAccessory) {
    if (!this.loadingError) {
      this.log.info('Loading accessory from cache:', accessory.displayName);
      // add restored accessory to the local cache to track if its already been registered
      this.accessories.push(accessory);
    }
  }

  discoverDevices() {
    const eightSleepDevices = [
      {
        accessoryUUID: 'L083A889BC2BAL',
        displayName: 'Pod Pro Left',
      },
      {
        accessoryUUID: 'R083A889BC2BAR',
        displayName: 'Pod Pro Right',
      },
    ];

    for (const device of eightSleepDevices) {
      // TODO #1 -> refer to 'platform.ts' Craft document
      const uuid = this.api.hap.uuid.generate(device.accessoryUUID);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        // existingAccessory.context.device = device;
        // this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new EightSleepThermostatAccessory(this, existingAccessory, this.log);

      } else {
        this.log.info('Adding new accessory:', device.displayName);

        const accessory = new this.api.platformAccessory(device.displayName, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;

        new EightSleepThermostatAccessory(this, accessory, this.log);

        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}
