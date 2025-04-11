import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { RuuvitagAccessory } from './ruuvitagAccessory';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

import * as ruuvi from 'node-ruuvitag';
import { io } from 'socket.io-client';

// This is only required when using Custom Services and Characteristics not support by HomeKit
import { EveHomeKitTypes } from 'homebridge-lib/EveHomeKitTypes';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class RuuvitagPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  // This is only required when using Custom Services and Characteristics not support by HomeKit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly CustomServices: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly CustomCharacteristics: any;

  private socket: any;
  private waitingTags: Record<string, (tag: any) => void> = {};
  private tags: Record<string, any> = {};

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    // This is only required when using Custom Services and Characteristics not support by HomeKit
    this.CustomServices = new EveHomeKitTypes(this.api).Services;
    this.CustomCharacteristics = new EveHomeKitTypes(this.api).Characteristics;

    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {
    // Check if socket connection is configured
    if (this.config.socket) {
      this.socket = io(this.config.socket);
      this.log.debug('Socket set to:', this.config.socket);
    } else {
      // Use node-ruuvitag for direct Bluetooth discovery
      ruuvi.on('found', (tag: any) => {
        this.tags[tag.id] = tag;
        if (this.waitingTags[tag.id]) {
          this.waitingTags[tag.id](tag);
          delete this.waitingTags[tag.id];
        }
        this.log.debug('Found Ruuvitag:', tag.id);
        this.registerAccessory(tag.id, tag.id);
      });
    }

    // Register accessories from config if provided
    if (Array.isArray(this.config.tags)) {
      for (const tagConfig of this.config.tags) {
        if (tagConfig.id) {
          this.registerAccessory(tagConfig.id, tagConfig.name || tagConfig.id, tagConfig);
        }
      }
    }

    // Clean up accessories no longer in config or discovered
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }

  registerAccessory(id: string, displayName: string, config: any = {}) {
    const uuid = this.api.hap.uuid.generate(id);
    this.discoveredCacheUUIDs.push(uuid);

    const existingAccessory = this.accessories.get(uuid);
    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      new RuuvitagAccessory(this, existingAccessory);
    } else {
      this.log.info('Adding new accessory:', displayName);
      const accessory = new this.api.platformAccessory(displayName, uuid);
      accessory.context.device = { id, exampleDisplayName: displayName, ...config };
      new RuuvitagAccessory(this, accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    // Set up listener for this tag
    if (this.socket) {
      this.tags[id] = { id };
      const tag = this.tags[id];
      this.listenToSocket(tag);
    } else if (this.tags[id]) {
      this.listenToTag(this.tags[id]);
    } else {
      this.waitingTags[id] = (tag: any) => {
        this.listenToTag(tag);
      };
    }
  }

  listenToSocket(tag: any) {
    this.socket.on('updated', (data: any) => {
      if (data.tagId === tag.id) {
        const accessory = this.accessories.get(this.api.hap.uuid.generate(tag.id));
        if (accessory) {
          (accessory.context.accessoryInstance as RuuvitagAccessory).update(tag, data);
        }
      }
    });
  }

  listenToTag(tag: any) {
    tag.on('updated', (data: any) => {
      const accessory = this.accessories.get(this.api.hap.uuid.generate(tag.id));
      if (accessory) {
        (accessory.context.accessoryInstance as RuuvitagAccessory).update(tag, data);
      }
    });
  }
}
