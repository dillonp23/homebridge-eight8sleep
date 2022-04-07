import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { EightSleepThermostatAccessory } from './platformAccessory';
import { EightSleepConnection } from './eightSleepConnection';

const pluginDisplayName = 'Eight Sleep Thermostat';

export class EightSleepThermostatPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  public connection?: EightSleepConnection;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {

    if (this.config['email'] && this.config['password']) {
      this.connection = new EightSleepConnection(this, this.config['email'], this.config['password']);

      this.log.debug('Finished initializing platform:', this.config.name);
      this.api.on('didFinishLaunching', () => {
        log.debug('Executed didFinishLaunching callback');
        try {
          this.discoverDevices();
        } catch (error) {
          this.log.error('There was a problem connecting to Eight Sleep, plugin will not be loaded:', error);
        }
      });

    } else {
      const configError = new Error(
        'You need to specify your Eight Sleep account credentials (email & password). Either manually update ' +
        'the \'config.json\' file, or from your Homebridge dashboard -> navigate to the \'Plugins\' tab -> find ' +
        `'${pluginDisplayName}' in the list of installed plugins, & click 'SETTINGS' to complete account setup.`);
      this.log.error('Unable to setup plugin:', configError.message);
    }
  }

  /**
   * REQUIRED - Homebridge will call "configureAccessory" method once for each restored cached accessory
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    // add restored accessory to the local cache to track if its already been registered
    this.accessories.push(accessory);
  }

  async discoverDevices() {
    const [primaryUser, session] = [await this.connection?.primaryUser, await this.connection?.session];

    if (!this.connection || !primaryUser || !session) {
      throw new Error('Could not login and/or load accessories. Please verify your login credentials in Homebridge config.json.');
    }

    const eightSleepDevices = [
      {
        accessoryUUID: `${primaryUser.id}:LEFT`,
        sharedDeviceId: primaryUser.id,
        isOwner: primaryUser.side === 'left' ? true : false,
        side: 'left',
        displayName: primaryUser.side === 'left' ? 'My Bed' : 'Guest Bed',
      },
      {
        accessoryUUID: `${primaryUser.id}:RIGHT`,
        sharedDeviceId: primaryUser.id,
        isOwner: primaryUser.side === 'right' ? true : false,
        side: 'right',
        displayName: primaryUser.side === 'right' ? 'My Bed' : 'Guest Bed',
      },
    ];

    for (const device of eightSleepDevices) {
      // TODO #1 -> refer to 'platform.ts' Craft document
      const uuid = this.api.hap.uuid.generate(device.accessoryUUID);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
      const guestId = `guest-${device.sharedDeviceId}-${device.side}`;

      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.context.device = device;
        existingAccessory.context.device.userId = device.isOwner ? session.userId : guestId;
        this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new EightSleepThermostatAccessory(this, existingAccessory);

      } else {
        this.log.info('Adding new accessory:', device.displayName);

        const accessory = new this.api.platformAccessory(device.displayName, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;
        accessory.context.device.userId = device.isOwner ? session.userId : guestId;

        new EightSleepThermostatAccessory(this, accessory);

        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}
