/**
 * GoPro Service for LayerSync
 * Handles GoPro camera operations and status
 */

class GoProService {
  constructor() {
    this.connected = false;
    this.ready = false;
    this.lastStatus = 'Awaiting first action...';
    this.status = {
      busy: null,
      encoding: null,
      ready: null,
      group: 1
    };
  }

  /**
   * Set connection status
   * @param {boolean} connected - Connection status
   */
  setConnected(connected) {
    this.connected = connected;
    this.updateReadyStatus();
  }

  /**
   * Update camera status
   * @param {Object} statusData - Status data from camera
   */
  updateStatus(statusData) {
    this.status = { ...this.status, ...statusData };
    this.updateReadyStatus();
  }

  /**
   * Update ready status based on current state
   */
  updateReadyStatus() {
    this.ready =
      this.connected && this.status.busy === '0' && this.status.encoding === '0' && this.status.ready === '1';
  }

  /**
   * Check if GoPro is ready for photo capture
   * @returns {boolean} Ready status
   */
  isReady() {
    return this.ready;
  }

  /**
   * Check if GoPro is connected
   * @returns {boolean} Connection status
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Set last status message
   * @param {string} message - Status message
   */
  setLastStatus(message) {
    this.lastStatus = message;
  }

  /**
   * Get last status message
   * @returns {string} Last status message
   */
  getLastStatus() {
    return this.lastStatus;
  }

  /**
   * Get current status
   * @returns {Object} Current status
   */
  getStatus() {
    return {
      connected: this.connected,
      ready: this.ready,
      status: this.status,
      lastStatus: this.lastStatus
    };
  }

  /**
   * Reset GoPro service state
   */
  reset() {
    this.connected = false;
    this.ready = false;
    this.lastStatus = 'Awaiting first action...';
    this.status = {
      busy: null,
      encoding: null,
      ready: null,
      group: 1
    };
  }
}

module.exports = GoProService;
