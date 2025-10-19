/**
 * GoPro Python Bridge - JavaScript wrapper for Python GoPro SDK
 * Handles communication between Node.js and Python GoPro bridge
 */

const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

class GoProPythonBridge extends EventEmitter {
  constructor() {
    super();
    this.pythonProcess = null;
    this.isConnected = false;
    this.commandId = 0;
    this.pendingCommands = new Map();
  }

  /**
   * Start the GoPro Python bridge
   */
  start() {
    if (this.pythonProcess) {
      console.log('GoPro Python Bridge already running');
      return;
    }

    try {
      // Use Python from virtual environment
      const pythonPath = path.join(process.cwd(), 'venv', 'bin', 'python3');
      const scriptPath = path.join(process.cwd(), 'python', 'gopro_python_bridge.py');

      console.log(`Starting GoPro Python Bridge with: ${pythonPath}`);
      console.log(`Script path: ${scriptPath}`);

      this.pythonProcess = spawn(pythonPath, [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.pythonProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          try {
            // Try to parse as JSON response
            const response = JSON.parse(output);
            console.log(`[RESPONSE] ${output}`);

            // Check if this is a response to a pending command
            if (response.commandId && this.pendingCommands.has(response.commandId)) {
              const { resolve, reject } = this.pendingCommands.get(response.commandId);
              this.pendingCommands.delete(response.commandId);

              if (response.success) {
                resolve(response);
              } else {
                reject(new Error(response.error || 'Command failed'));
              }
            }
          } catch (e) {
            // Not JSON, log as regular output
            console.log(`[INFO] ${output}`);
            this.emit('log', output);
          }
        }
      });

      this.pythonProcess.stderr.on('data', (data) => {
        const error = data.toString().trim();
        if (error) {
          // Filter out ugly connection timeout errors
          if (
            error.includes('Connection request timed out') ||
            error.includes('Failed to connect. Retrying') ||
            error.includes('Establishing BLE connection')
          ) {
            // Suppress these ugly logs
            return;
          }
          console.log(`[ERROR] ${error}`);
        }
      });

      this.pythonProcess.on('close', (code) => {
        console.log(`GoPro Python Bridge exited with code ${code}`);
        this.pythonProcess = null;
        this.isConnected = false;
      });

      console.log('GoPro Python Bridge started');
    } catch (error) {
      console.log(`Failed to start GoPro Python Bridge: ${error.message}`);
    }
  }

  /**
   * Stop the GoPro Python bridge
   */
  stop() {
    if (this.pythonProcess) {
      console.log('Stopping GoPro Python Bridge...');
      this.pythonProcess.kill();
      this.pythonProcess = null;
      this.isConnected = false;
    }
  }

  /**
   * Send command to Python bridge
   * @param {string} command - Command to send
   * @param {Object} params - Command parameters
   * @returns {Promise} Command result
   */
  async sendCommand(command, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.pythonProcess) {
        reject(new Error('Python bridge not running'));
        return;
      }

      const commandId = ++this.commandId;
      const commandData = {
        command,
        commandId,
        ...params
      };

      this.pendingCommands.set(commandId, { resolve, reject });

      // Send command to Python process
      this.pythonProcess.stdin.write(`${JSON.stringify(commandData)}\n`);

      // Set timeout for command
      setTimeout(() => {
        if (this.pendingCommands.has(commandId)) {
          this.pendingCommands.delete(commandId);
          reject(new Error('Command timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Connect to GoPro with retry mechanism
   * @param {number} maxRetries - Maximum number of retry attempts
   * @returns {Promise} Connection result
   */
  async connect(maxRetries = 3) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`GoPro connection attempt ${attempt}/${maxRetries}...`);
        const result = await this.sendCommand('connect');
        this.isConnected = result.connected;

        if (result.connected) {
          console.log('GoPro connected successfully!');
          this.emit('connected');
          return result;
        } else {
          throw new Error('Connection failed - GoPro not ready');
        }
      } catch (error) {
        lastError = error;
        console.log(`GoPro connection attempt ${attempt} failed: ${error.message}`);

        if (attempt < maxRetries) {
          console.log(`Retrying in 2 seconds...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    // All retries failed
    console.log(`GoPro connection failed after ${maxRetries} attempts`);
    throw lastError;
  }

  /**
   * Disconnect from GoPro
   * @returns {Promise} Disconnection result
   */
  async disconnect() {
    try {
      const result = await this.sendCommand('disconnect');
      this.isConnected = result.connected;
      if (!result.connected) {
        this.emit('disconnected');
      }
      return result;
    } catch (error) {
      console.log(`GoPro disconnection failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check GoPro connection status
   * @returns {Promise} Connection status
   */
  async checkConnection() {
    try {
      const result = await this.sendCommand('check_connection');
      this.isConnected = result.connected;
      return result;
    } catch (error) {
      console.log(`GoPro connection check failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Take a photo
   * @param {number} retries - Number of retry attempts
   * @returns {Promise} Photo result
   */
  async takePhoto(retries = 3) {
    try {
      const result = await this.sendCommand('take_photo', { retries });
      return result;
    } catch (error) {
      console.log(`Photo capture failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get camera status
   * @returns {Promise} Camera status
   */
  async getCameraStatus() {
    try {
      const result = await this.sendCommand('status');
      return result.status;
    } catch (error) {
      console.log(`Camera status check failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if GoPro is ready
   * @returns {boolean} Ready status
   */
  ready() {
    return this.pythonProcess !== null && this.isConnected;
  }

  /**
   * Get connection status
   * @returns {Object} Connection status information
   */
  getConnectionStatus() {
    return {
      connected: this.isConnected,
      pythonProcess: this.pythonProcess !== null,
      commandId: this.commandId
    };
  }
}

module.exports = GoProPythonBridge;
