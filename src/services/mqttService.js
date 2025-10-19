/**
 * MQTT Service for LayerSync
 * Handles MQTT communication with Bambu Lab printers
 */

const mqtt = require('mqtt');

class MQTTService {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  /**
   * Connect to MQTT broker
   * @returns {Promise<boolean>} Connection success
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        const brokerUrl = `mqtts://${this.config.printer_ip}:8883`;
        const clientId = `layersync_${Date.now()}`;

        const options = {
          clientId,
          username: 'bblp',
          password: this.config.mqtt_password,
          clean: true,
          reconnectPeriod: 5000,
          connectTimeout: 30000
        };

        this.client = mqtt.connect(brokerUrl, options);

        this.client.on('connect', () => {
          console.log('MQTT connected successfully');
          this.connected = true;
          this.reconnectAttempts = 0;
          resolve(true);
        });

        this.client.on('error', (error) => {
          console.error('MQTT connection error:', error.message);
          this.connected = false;
          reject(error);
        });

        this.client.on('close', () => {
          console.log('MQTT connection closed');
          this.connected = false;
        });

        this.client.on('reconnect', () => {
          this.reconnectAttempts++;
          console.log(`MQTT reconnecting... (attempt ${this.reconnectAttempts})`);

          if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            this.client.end();
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from MQTT broker
   */
  disconnect() {
    if (this.client) {
      this.client.end();
      this.client = null;
      this.connected = false;
    }
  }

  /**
   * Subscribe to MQTT topic
   * @param {string} topic - MQTT topic
   * @param {Function} callback - Message callback
   */
  subscribe(topic, callback) {
    if (this.client && this.connected) {
      this.client.subscribe(topic);
      this.client.on('message', (receivedTopic, message) => {
        if (receivedTopic === topic) {
          callback(message);
        }
      });
    }
  }

  /**
   * Publish message to MQTT topic
   * @param {string} topic - MQTT topic
   * @param {string} message - Message to publish
   */
  publish(topic, message) {
    if (this.client && this.connected) {
      this.client.publish(topic, message);
    }
  }

  /**
   * Check if MQTT is connected
   * @returns {boolean} Connection status
   */
  isConnected() {
    return this.connected && this.client;
  }
}

module.exports = MQTTService;
