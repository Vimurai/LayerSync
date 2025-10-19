/**
 * Configuration utility for LayerSync
 * Handles loading and validation of configuration files
 */

const fs = require('fs');
const path = require('path');

class ConfigManager {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = {};
    this.loaded = false;
  }

  /**
   * Load configuration from file
   * @returns {boolean} Success status
   */
  load() {
    try {
      if (!fs.existsSync(this.configPath)) {
        console.error(`Configuration file not found: ${this.configPath}`);
        return false;
      }

      const configData = fs.readFileSync(this.configPath, 'utf8');
      this.config = JSON.parse(configData);
      this.loaded = true;

      console.log('Configuration loaded successfully');
      return true;
    } catch (error) {
      console.error(`Failed to load configuration: ${error.message}`);
      return false;
    }
  }

  /**
   * Get configuration value
   * @param {string} key - Configuration key
   * @param {*} defaultValue - Default value if key not found
   * @returns {*} Configuration value
   */
  get(key, defaultValue = null) {
    return this.config[key] !== undefined ? this.config[key] : defaultValue;
  }

  /**
   * Set configuration value
   * @param {string} key - Configuration key
   * @param {*} value - Configuration value
   */
  set(key, value) {
    this.config[key] = value;
  }

  /**
   * Get all configuration
   * @returns {Object} Complete configuration object
   */
  getAll() {
    return { ...this.config };
  }

  /**
   * Check if configuration is loaded
   * @returns {boolean} Loaded status
   */
  isLoaded() {
    return this.loaded;
  }

  /**
   * Validate required configuration keys
   * @param {Array} requiredKeys - Array of required keys
   * @returns {boolean} Validation status
   */
  validate(requiredKeys = []) {
    if (!this.loaded) {
      return false;
    }

    for (const key of requiredKeys) {
      if (this.config[key] === undefined || this.config[key] === null || this.config[key] === '') {
        console.error(`Missing required configuration: ${key}`);
        return false;
      }
    }

    return true;
  }
}

module.exports = ConfigManager;
