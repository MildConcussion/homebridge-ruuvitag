import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { RuuvitagPlatform } from './platform.js';
import { hypotenuse } from './utils.js';

/**
 * Ruuvitag Accessory
 * An instance of this class is created for each Ruuvitag sensor accessory registered by the platform.
 * Each accessory may expose multiple services of different service types based on configuration.
 */
export class RuuvitagAccessory {
  private tempService?: Service;
  private humidityService?: Service;
  private batteryService: Service;
  private heatTriggerService?: Service;
  private coldTriggerService?: Service;
  private motionTriggerService?: Service;
  private highHumidityTriggerService?: Service;
  private lowHumidityTriggerService?: Service;

  private updatedAt = 0;
  private temperature?: number;
  private humidity?: number;
  private batteryLevel?: number;
  private batteryState?: number;
  private heatState?: number;
  private coldState?: number;
  private motionState?: boolean;
  private highHumidityState?: number;
  private lowHumidityState?: number;

  private heatTriggerValue?: number;
  private coldTriggerValue?: number;
  private motionTriggerValue?: number;
  private highHumidityTriggerValue?: number;
  private lowHumidityTriggerValue?: number;
  private tagId: string;

  // Store previous values separately from the ruuvi tag object
  private previousValues: {
    accelerationX?: number;
    accelerationY?: number;
    accelerationZ?: number;
  } = {};

  constructor(
    private readonly platform: RuuvitagPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // Don't store a reference to this instance in the accessory context
    this.tagId = accessory.context.device.id;

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Ruuvitag')
      .setCharacteristic(this.platform.Characteristic.Model, 'Ruuvitag Sensor')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.tagId || 'Unknown');

    const config = this.accessory.context.device || {};

    // Initialize services based on configuration
    if (!config.disableTemp) {
      this.tempService = this.accessory.getService(this.platform.Service.TemperatureSensor) ||
        this.accessory.addService(this.platform.Service.TemperatureSensor);
      this.tempService.setCharacteristic(this.platform.Characteristic.Name, this.accessory.displayName);
      this.tempService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .setProps({ minValue: -200, maxValue: 200, minStep: 0.01 });
    }

    if (!config.disableHumidity) {
      this.humidityService = this.accessory.getService(this.platform.Service.HumiditySensor) ||
        this.accessory.addService(this.platform.Service.HumiditySensor);
      this.humidityService.setCharacteristic(this.platform.Characteristic.Name, this.accessory.displayName);
      this.humidityService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
        .setProps({ minValue: 0, maxValue: 100, minStep: 0.5 });
    }

    this.batteryService = this.accessory.getService(this.platform.Service.Battery) ||
      this.accessory.addService(this.platform.Service.Battery);
    this.batteryService.setCharacteristic(this.platform.Characteristic.Name, this.accessory.displayName);
    this.batteryService.getCharacteristic(this.platform.Characteristic.ChargingState)
      .setValue(this.platform.Characteristic.ChargingState.NOT_CHARGEABLE);

    if (config.heatTrigger) {
      this.heatTriggerService = this.accessory.getServiceById(this.platform.Service.ContactSensor, 'heat') ||
        this.accessory.addService(this.platform.Service.ContactSensor, config.heatTrigger.name || this.accessory.displayName, 'heat');
      this.heatTriggerValue = Number(config.heatTrigger.value || 0);
    }

    if (config.coldTrigger) {
      this.coldTriggerService = this.accessory.getServiceById(this.platform.Service.ContactSensor, 'cold') ||
        this.accessory.addService(this.platform.Service.ContactSensor, config.coldTrigger.name || this.accessory.displayName, 'cold');
      this.coldTriggerValue = Number(config.coldTrigger.value || 0);
    }

    if (config.motionTrigger) {
      this.motionTriggerService = this.accessory.getService(this.platform.Service.MotionSensor) ||
        this.accessory.addService(this.platform.Service.MotionSensor, config.motionTrigger.name || this.accessory.displayName);
      this.motionTriggerValue = Number(config.motionTrigger.value || 0);
    }

    if (config.highHumidityTrigger) {
      this.highHumidityTriggerService = this.accessory.getServiceById(this.platform.Service.ContactSensor, 'highHumidity') ||
        this.accessory.addService(this.platform.Service.ContactSensor, config.highHumidityTrigger.name || this.accessory.displayName, 'highHumidity');
      this.highHumidityTriggerValue = Number(config.highHumidityTrigger.value || 0);
    }

    if (config.lowHumidityTrigger) {
      this.lowHumidityTriggerService = this.accessory.getServiceById(this.platform.Service.ContactSensor, 'lowHumidity') ||
        this.accessory.addService(this.platform.Service.ContactSensor, config.lowHumidityTrigger.name || this.accessory.displayName, 'lowHumidity');
      this.lowHumidityTriggerValue = Number(config.lowHumidityTrigger.value || 0);
    }

    this.platform.log.debug('Initialized Ruuvitag accessory:', this.accessory.displayName);
  }

  update(tag: any, data: any) {
    const config = this.accessory.context.device || {};

    // Detailed logging of what data we're receiving
    this.platform.log.debug(`Raw data received for update on ${this.tagId}:`, JSON.stringify(data));

    // Safely extract values
    const temperature = this.parseFloat(data.temperature);
    const humidity = this.parseFloat(data.humidity);
    const battery = this.parseFloat(data.battery);
    const accelerationX = this.parseFloat(data.accelerationX);
    const accelerationY = this.parseFloat(data.accelerationY);
    const accelerationZ = this.parseFloat(data.accelerationZ);

    if (temperature === undefined && humidity === undefined && battery === undefined) {
      this.platform.log.warn(`No valid data received for tag ${this.tagId}`);
      return;
    }

    // Store values for next update but avoid modifying the tag object
    const previousAccX = this.previousValues.accelerationX;
    const previousAccY = this.previousValues.accelerationY;
    const previousAccZ = this.previousValues.accelerationZ;

    // Update our local previous values
    if (accelerationX !== undefined) {
      this.previousValues.accelerationX = accelerationX;
    }
    if (accelerationY !== undefined) {
      this.previousValues.accelerationY = accelerationY;
    }
    if (accelerationZ !== undefined) {
      this.previousValues.accelerationZ = accelerationZ;
    }

    const now = Date.now();
    if (!config.frequency || (now - this.updatedAt) > config.frequency * 1000) {
      this.updatedAt = now;

      if (this.tempService && temperature !== undefined && temperature !== this.temperature) {
        this.temperature = temperature;
        this.platform.log.debug(`Updating temperature to ${temperature} for ${this.tagId}`);
        this.tempService.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(temperature);
      }

      if (this.humidityService && humidity !== undefined && humidity !== this.humidity) {
        this.humidity = humidity;
        this.platform.log.debug(`Updating humidity to ${humidity} for ${this.tagId}`);
        this.humidityService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity).updateValue(humidity);
      }

      if (battery !== undefined) {
        const batteryLevel = Math.max(0, Math.min(100, (battery - 2000) / 1000 * 100));
        if (batteryLevel !== this.batteryLevel) {
          this.batteryLevel = batteryLevel;
          this.platform.log.debug(`Updating battery level to ${batteryLevel} for ${this.tagId}`);
          this.batteryService.getCharacteristic(this.platform.Characteristic.BatteryLevel).updateValue(batteryLevel);
        }
      }
    }

    if (battery !== undefined) {
      const batteryState = (battery < 2000) ? 1 : 0;
      if (batteryState !== this.batteryState) {
        this.batteryState = batteryState;
        this.batteryService.getCharacteristic(this.platform.Characteristic.StatusLowBattery).updateValue(batteryState);
      }
    }

    if (this.heatTriggerService && temperature !== undefined) {
      const heatState = (temperature > this.heatTriggerValue!) ? 1 : 0;
      if (heatState !== this.heatState) {
        this.heatState = heatState;
        this.heatTriggerService.getCharacteristic(this.platform.Characteristic.ContactSensorState).updateValue(heatState);
      }
    }

    if (this.coldTriggerService && temperature !== undefined) {
      const coldState = (temperature < this.coldTriggerValue!) ? 1 : 0;
      if (coldState !== this.coldState) {
        this.coldState = coldState;
        this.coldTriggerService.getCharacteristic(this.platform.Characteristic.ContactSensorState).updateValue(coldState);
      }
    }

    if (this.highHumidityTriggerService && humidity !== undefined) {
      const highHumidityState = (humidity > this.highHumidityTriggerValue!) ? 1 : 0;
      if (highHumidityState !== this.highHumidityState) {
        this.highHumidityState = highHumidityState;
        this.highHumidityTriggerService.getCharacteristic(this.platform.Characteristic.ContactSensorState).updateValue(highHumidityState);
      }
    }

    if (this.lowHumidityTriggerService && humidity !== undefined) {
      const lowHumidityState = (humidity < this.lowHumidityTriggerValue!) ? 1 : 0;
      if (lowHumidityState !== this.lowHumidityState) {
        this.lowHumidityState = lowHumidityState;
        this.lowHumidityTriggerService.getCharacteristic(this.platform.Characteristic.ContactSensorState).updateValue(lowHumidityState);
      }
    }

    if (this.motionTriggerService &&
        accelerationX !== undefined && previousAccX !== undefined &&
        accelerationY !== undefined && previousAccY !== undefined &&
        accelerationZ !== undefined && previousAccZ !== undefined) {
      const deltaX = previousAccX - accelerationX;
      const deltaY = previousAccY - accelerationY;
      const deltaZ = previousAccZ - accelerationZ;
      const movement = hypotenuse(deltaX, deltaY, deltaZ) / 1000;
      const motionState = movement > this.motionTriggerValue!;
      if (motionState !== this.motionState) {
        this.motionState = motionState;
        this.motionTriggerService.getCharacteristic(this.platform.Characteristic.MotionDetected).updateValue(motionState);
      }
    }

    this.platform.log.debug('Updated Ruuvitag data for', this.tagId);
  }

  /**
   * Parse a value safely to float
   */
  private parseFloat(value: any): number | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    const parsed = Number(value);
    if (isNaN(parsed)) {
      return undefined;
    }

    return parsed;
  }
}