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
import { PlatformClientAdapter } from './clientAdapter';

const pluginDisplayName = 'Eight Sleep Thermostat';

interface EightSleepDeviceContext {
  accessoryUUID: string;
  sharedDeviceId: string;
  pluginSerial: string;
  isOwner: boolean;
  side: string;
  displayName: string;
}

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
      this.api.on('didFinishLaunching', () => {
        this.discoverDevices().catch ( (error) => {
          this.log.error('Something went wrong...', error);
        });
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
    const [primaryUserDevice, session] = [await this.connection?.primaryUserDevice, await this.connection?.session];

    if (!this.connection || !primaryUserDevice || !session) {
      throw new Error('Unexpected failure occured during plugin load.');
    }

    const sharedPlatformClient = new PlatformClientAdapter(primaryUserDevice.id, this.log);

    const soloBedName = this.config['solo-bed-name'];
    const leftBedName = this.config['left-bed-name'];
    const rightBedName = this.config['right-bed-name'];

    let eightSleepDevices: EightSleepDeviceContext[];

    if (primaryUserDevice.side === 'solo') {
      eightSleepDevices = [
        {
          accessoryUUID: `${primaryUserDevice.id}:SOLO`,
          sharedDeviceId: primaryUserDevice.id,
          pluginSerial: primaryUserDevice.id.substring(0, 12).concat(':Solo'),
          isOwner: true,
          side: 'solo',
          displayName: soloBedName ?? 'Pod Pro Solo',
        },
      ];
    } else {
      eightSleepDevices = [
        {
          accessoryUUID: `${primaryUserDevice.id}:LEFT`,
          sharedDeviceId: primaryUserDevice.id,
          pluginSerial: primaryUserDevice.id.substring(0, 12).concat(':Left'),
          isOwner: primaryUserDevice.side === 'left' ? true : false,
          side: 'left',
          displayName: leftBedName ?? 'Pod Pro Left',
        },
        {
          accessoryUUID: `${primaryUserDevice.id}:RIGHT`,
          sharedDeviceId: primaryUserDevice.id,
          pluginSerial: primaryUserDevice.id.substring(0, 12).concat(':Right'),
          isOwner: primaryUserDevice.side === 'right' ? true : false,
          side: 'right',
          displayName: rightBedName ?? 'Pod Pro Right',
        },
      ];
    }

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
        new EightSleepThermostatAccessory(this, existingAccessory, sharedPlatformClient);

      } else {
        this.log.info('Adding new accessory:', device.displayName);

        const accessory = new this.api.platformAccessory(device.displayName, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;
        accessory.context.device.userId = device.isOwner ? session.userId : guestId;

        new EightSleepThermostatAccessory(this, accessory, sharedPlatformClient);

        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}
