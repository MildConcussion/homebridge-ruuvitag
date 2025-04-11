import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { RuuvitagAccessory } from './ruuvitagAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

// Import as a dynamic import since node-ruuvitag might not support ES modules directly
import { io } from 'socket.io-client';
import debug from 'debug';

// This is only required when using Custom Services and Characteristics not support by HomeKit
import { EveHomeKitTypes } from 'homebridge-lib/EveHomeKitTypes';

// For CommonJS compatibility
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

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

  // Keep track of accessory instances
  private readonly accessoryInstances: Map<string, RuuvitagAccessory> = new Map();

  // This is only required when using Custom Services and Characteristics not support by HomeKit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly CustomServices: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly CustomCharacteristics: any;

  private socket: any;
  private waitingTags: Record<string, (tag: any) => void> = {};
  private tags: Record<string, any> = {};
  private debugLog: debug.Debugger;
  private ruuviInstance: any;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.debugLog = debug('homebridge-ruuvitag');

    // This is only required when using Custom Services and Characteristics not support by HomeKit
    this.CustomServices = new EveHomeKitTypes(this.api).Services;
    this.CustomCharacteristics = new EveHomeKitTypes(this.api).Characteristics;

    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      log.debug('Executed didFinishLaunching callback');

      // Initialize ruuvi if needed
      if (!this.config.socket) {
        try {
          // Simple direct require like ruuvitag-debug uses
          this.ruuviInstance = require('node-ruuvitag');
          log.debug('Successfully imported node-ruuvitag using require');
        } catch (error) {
          log.error('Failed to import node-ruuvitag:', error);
        }
      }

      // run the method to discover / register your devices as accessories
      this.discoverDevices();

      // After 10 seconds, if no data has been received, simulate data for testing
      setTimeout(() => {
        this.testSendSampleData();
      }, 10000);
    });
  }

  /**
   * Test method to send sample Ruuvi data to registered accessories
   */
  private testSendSampleData() {
    if (Array.isArray(this.config.tags)) {
      for (const tagConfig of this.config.tags) {
        if (tagConfig.id) {
          // Check if this tag has received any real data
          const accessoryInstance = this.accessoryInstances.get(tagConfig.id);
          if (accessoryInstance) {
            this.log.info(`Sending sample data to tag ${tagConfig.id}`);
            const sampleData = {
              temperature: 22.5,
              humidity: 55.0,
              pressure: 101325,
              battery: 2900 // in mV
            };

            const mockTag = { id: tagConfig.id };
            // Simulate an update - for testing only
            accessoryInstance.update(mockTag, sampleData);
          }
        }
      }
    }
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
    } else if (this.ruuviInstance) {
      // Use node-ruuvitag for direct Bluetooth discovery
      this.log.info('Starting to find RuuviTags using event-based approach...');

      // Listen for warnings
      this.ruuviInstance.on('warning', (message: string) => {
        this.log.warn(`Ruuvitag warning: ${message}`);
      });

      // Listen for tags being found - this matches the ruuvitag-debug approach
      this.ruuviInstance.on('found', (tag: any) => {
        this.log.info(`Found RuuviTag with ID: ${tag.id}`);
        this.log.debug('Tag details:', JSON.stringify(tag));

        this.tags[tag.id] = tag;
        if (this.waitingTags[tag.id]) {
          this.waitingTags[tag.id](tag);
          delete this.waitingTags[tag.id];
        }

        // Register the accessory if not already registered
        this.registerAccessory(tag.id, tag.id);

        // Set up listener for this tag
        this.listenToTag(tag);
      });

      // Start scanning - no need to call findTags()
      if (typeof this.ruuviInstance.start === 'function') {
        this.ruuviInstance.start();
        this.log.info('Started scanning for RuuviTags');
      } else {
        this.log.warn('start method not available on ruuviInstance');
      }
    } else {
      this.log.error('Failed to initialize ruuvi module - using only config tags');
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
      const accessoryInstance = new RuuvitagAccessory(this, existingAccessory);
      this.accessoryInstances.set(id, accessoryInstance);
    } else {
      this.log.info('Adding new accessory:', displayName);
      const accessory = new this.api.platformAccessory(displayName, uuid);
      accessory.context.device = { id, exampleDisplayName: displayName, ...config };
      const accessoryInstance = new RuuvitagAccessory(this, accessory);
      this.accessoryInstances.set(id, accessoryInstance);
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
      this.log.debug(`Socket data received for tag ${tag.id}:`, JSON.stringify(data));

      if (data && (data.tagId === tag.id || data.id === tag.id)) {
        this.log.info(`Processing data update for ${tag.id}: temp=${data.temperature}, humidity=${data.humidity}, battery=${data.battery}`);

        const accessoryInstance = this.accessoryInstances.get(tag.id);
        if (accessoryInstance) {
          accessoryInstance.update(tag, data);
        } else {
          this.log.warn(`Could not find accessory instance for tag ID ${tag.id}`);
        }
      }
    });

    // Listen for connection errors
    this.socket.on('connect_error', (error: any) => {
      this.log.error('Socket connection error:', error);
    });

    // Listen for disconnect
    this.socket.on('disconnect', (reason: string) => {
      this.log.error('Socket disconnected:', reason);
    });

    // Listen for connect
    this.socket.on('connect', () => {
      this.log.info('Socket connected successfully');
    });
  }

  listenToTag(tag: any) {
    this.log.info(`Setting up listener for tag ${tag.id}`);

    tag.on('updated', (data: any) => {
      this.log.debug(`Direct BLE data received for tag ${tag.id}:`, JSON.stringify(data));
      this.log.info(`Processing direct BLE update for ${tag.id}: temp=${data.temperature}, humidity=${data.humidity}, battery=${data.battery}`);

      const accessoryInstance = this.accessoryInstances.get(tag.id);
      if (accessoryInstance) {
        accessoryInstance.update(tag, data);
      } else {
        this.log.warn(`Could not find accessory instance for tag ID ${tag.id}`);
      }
    });
  }
}
