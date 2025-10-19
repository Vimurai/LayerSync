/**
 * Printer Service for LayerSync
 * Handles printer-specific operations and status parsing
 */

class PrinterService {
  constructor() {
    this.currentState = 'UNKNOWN';
    this.lastStableState = 'UNKNOWN';
    this.stateChangeTime = Date.now();
    this.stateStabilityThreshold = 2000; // 2 seconds

    this.totalLayers = 0;
    this.currentLayer = 0;
    this.lastTriggerLayer = -1;
    this.layerChangeTime = Date.now();
    this.photoTriggerDelay = 800;

    this.bambuTimelapseEnabled = false;
    this.printingState = false;
  }

  /**
   * Parse MQTT message and extract printer status
   * @param {Buffer} message - MQTT message buffer
   * @returns {Object} Parsed printer data
   */
  parseMessage(message) {
    try {
      const data = JSON.parse(message.toString());
      return data.print || data;
    } catch (error) {
      console.error('Failed to parse MQTT message:', error.message);
      return null;
    }
  }

  /**
   * Update printer state based on MQTT data
   * @param {Object} data - Parsed MQTT data
   * @returns {Object} Updated state information
   */
  updateState(data) {
    if (!data) return null;

    const now = Date.now();
    const timeSinceStateChange = now - this.stateChangeTime;

    // Update layer information
    if (data.layer_num !== undefined) {
      this.currentLayer = data.layer_num;
    }
    if (data.total_layer_num !== undefined) {
      this.totalLayers = data.total_layer_num;
    }

    // Update timelapse status
    if (data.ipcam && data.ipcam.timelapse !== undefined) {
      this.bambuTimelapseEnabled = data.ipcam.timelapse === 'enable';
    }

    // Determine printing state
    const printingState = this.determinePrintingState(data);

    // Update state with stability check
    const newState = this.getStateFromData(data);
    if (newState !== this.currentState) {
      if (timeSinceStateChange < this.stateStabilityThreshold) {
        console.log(`State change ignored: ${this.currentState} → ${newState} (too quick)`);
        return { state: this.currentState, printing: printingState };
      }

      this.lastStableState = this.currentState;
      this.currentState = newState;
      this.stateChangeTime = now;
      console.log(`State changed to: ${newState} (stable for ${timeSinceStateChange}ms)`);
    }

    this.printingState = printingState;
    return { state: this.currentState, printing: printingState };
  }

  /**
   * Determine if printer is currently printing
   * @param {Object} data - MQTT data
   * @returns {boolean} Printing status
   */
  determinePrintingState(data) {
    // Check various indicators of printing state
    const hasLayerProgress = this.currentLayer > 0;
    const hasPrintingState = data.print_type === 'printing' || data.mc_print_stage === '1';
    const hasActiveTemperatures = data.nozzle_target_temper > 0 || data.bed_target_temper > 0;

    return hasLayerProgress || hasPrintingState || hasActiveTemperatures;
  }

  /**
   * Get printer state from MQTT data
   * @param {Object} data - MQTT data
   * @returns {string} Printer state
   */
  getStateFromData(data) {
    if (data.print_type === 'printing' || data.mc_print_stage === '1') {
      return 'PRINTING';
    } else if (data.print_type === 'idle') {
      return 'IDLE';
    } else if (data.nozzle_target_temper > 0 || data.bed_target_temper > 0) {
      return 'HEATING';
    } else if (data.print_type === 'finished') {
      return 'FINISHED';
    } else {
      return 'STANDBY';
    }
  }

  /**
   * Check if layer change should trigger photo
   * @returns {boolean} Should trigger photo
   */
  shouldTriggerPhoto() {
    return (
      this.currentLayer > 0 &&
      this.currentLayer !== this.lastTriggerLayer &&
      this.printingState &&
      this.bambuTimelapseEnabled
    );
  }

  /**
   * Mark layer as triggered
   */
  markLayerTriggered() {
    this.lastTriggerLayer = this.currentLayer;
    this.layerChangeTime = Date.now();
  }

  /**
   * Reset printer state
   */
  reset() {
    this.currentState = 'UNKNOWN';
    this.lastStableState = 'UNKNOWN';
    this.stateChangeTime = Date.now();
    this.totalLayers = 0;
    this.currentLayer = 0;
    this.lastTriggerLayer = -1;
    this.layerChangeTime = Date.now();
    this.bambuTimelapseEnabled = false;
    this.printingState = false;
  }

  /**
   * Get current printer status
   * @returns {Object} Current status
   */
  getStatus() {
    return {
      state: this.currentState,
      printing: this.printingState,
      currentLayer: this.currentLayer,
      totalLayers: this.totalLayers,
      timelapseEnabled: this.bambuTimelapseEnabled,
      photoTriggerDelay: this.photoTriggerDelay
    };
  }
}

module.exports = PrinterService;
