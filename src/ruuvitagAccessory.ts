import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { RuuvitagPlatform } from './platform.js';

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

  constructor(
    private readonly platform: RuuvitagPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // Store a reference to this instance in the accessory context for easy access from platform
    this.accessory.context.accessoryInstance = this;

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Ruuvitag')
      .setCharacteristic(this.platform.Characteristic.Model, 'Ruuvitag Sensor')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.device.id || 'Unknown');

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
    const { temperature, humidity, battery, accelerationX, accelerationY, accelerationZ } = data;
    const previous = tag.previousValues || {};
    tag.previousValues = data;

    const now = Date.now();
    if (!config.frequency || (now - this.updatedAt) > config.frequency * 1000) {
      this.updatedAt = now;

      if (this.tempService && temperature !== this.temperature) {
        this.temperature = temperature;
        this.tempService.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(temperature);
      }

      if (this.humidityService && humidity !== this.humidity) {
        this.humidity = humidity;
        this.humidityService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity).updateValue(humidity);
      }

      const batteryLevel = Math.max(0, Math.min(100, (battery - 2000) / 1000 * 100));
      if (batteryLevel !== this.batteryLevel) {
        this.batteryLevel = batteryLevel;
        this.batteryService.getCharacteristic(this.platform.Characteristic.BatteryLevel).updateValue(batteryLevel);
      }
    }

    const batteryState = (battery < 2000) ? 1 : 0;
    if (batteryState !== this.batteryState) {
      this.batteryState = batteryState;
      this.batteryService.getCharacteristic(this.platform.Characteristic.StatusLowBattery).updateValue(batteryState);
    }

    if (this.heatTriggerService) {
      const heatState = (temperature > this.heatTriggerValue!) ? 1 : 0;
      if (heatState !== this.heatState) {
        this.heatState = heatState;
        this.heatTriggerService.getCharacteristic(this.platform.Characteristic.ContactSensorState).updateValue(heatState);
      }
    }

    if (this.coldTriggerService) {
      const coldState = (temperature < this.coldTriggerValue!) ? 1 : 0;
      if (coldState !== this.coldState) {
        this.coldState = coldState;
        this.coldTriggerService.getCharacteristic(this.platform.Characteristic.ContactSensorState).updateValue(coldState);
      }
    }

    if (this.highHumidityTriggerService) {
      const highHumidityState = (humidity > this.highHumidityTriggerValue!) ? 1 : 0;
      if (highHumidityState !== this.highHumidityState) {
        this.highHumidityState = highHumidityState;
        this.highHumidityTriggerService.getCharacteristic(this.platform.Characteristic.ContactSensorState).updateValue(highHumidityState);
      }
    }

    if (this.lowHumidityTriggerService) {
      const lowHumidityState = (humidity < this.lowHumidityTriggerValue!) ? 1 : 0;
      if (lowHumidityState !== this.lowHumidityState) {
        this.lowHumidityState = lowHumidityState;
        this.lowHumidityTriggerService.getCharacteristic(this.platform.Characteristic.ContactSensorState).updateValue(lowHumidityState);
      }
    }

    if (this.motionTriggerService) {
      const deltaX = previous ? (previous.accelerationX - accelerationX) : 0;
      const deltaY = previous ? (previous.accelerationY - accelerationY) : 0;
      const deltaZ = previous ? (previous.accelerationZ - accelerationZ) : 0;
      const movement = previous ? (Math.sqrt(Math.pow(deltaX, 2) + Math.pow(deltaY, 2) + Math.pow(deltaZ, 2)) / 1000) : 0;
      const motionState = movement > this.motionTriggerValue!;
      if (motionState !== this.motionState) {
        this.motionState = motionState;
        this.motionTriggerService.getCharacteristic(this.platform.Characteristic.MotionDetected).updateValue(motionState);
      }
    }

    this.platform.log.debug('Updated Ruuvitag data:', data);
  }
}