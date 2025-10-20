// goproPythonBridge.js
// JavaScript wrapper for GoPro Python Bridge using official Open GoPro SDK

const { spawn } = require('child_process');
const EventEmitter = require('events');

class GoProPythonBridge extends EventEmitter {
  constructor() {
    super();
    this.pythonProcess = null;
    this.isConnected = false;
    this.commandQueue = [];
    this.pendingCommands = new Map();
    this.commandId = 0;
  }

  start() {
    if (this.pythonProcess) {
      this.log('Python bridge already running', 'WARN');
      return;
    }

    this.log('Starting GoPro Python Bridge...', 'INFO');

    // Start Python bridge process using virtual environment
    const pythonPath = process.platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python';
    this.pythonProcess = spawn(pythonPath, ['gopro_python_bridge.py'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Handle stdout (responses from Python)
    this.pythonProcess.stdout.on('data', (data) => {
      const lines = data
        .toString()
        .split('\n')
        .filter((line) => line.trim());
      lines.forEach((line) => {
        try {
          const response = JSON.parse(line);
          this.handleResponse(response);
        } catch (e) {
          this.log(`Failed to parse Python response: ${line}`, 'ERROR');
        }
      });
    });

    // Handle stderr (Python errors)
    this.pythonProcess.stderr.on('data', (data) => {
      const message = data.toString().trim();
      // Don't treat INFO messages as errors
      if (message.includes('INFO:') || message.includes('GoPro Python Bridge started')) {
        this.log(message, 'INFO');
      } else {
        this.log(`Python stderr: ${message}`, 'ERROR');
      }
    });

    // Handle process exit
    this.pythonProcess.on('exit', (code) => {
      this.log(`Python bridge exited with code ${code}`, 'WARN');
      this.pythonProcess = null;
      this.isConnected = false;
      this.emit('disconnected');
    });

    this.log('GoPro Python Bridge started', 'SUCCESS');
  }

  stop() {
    if (this.pythonProcess) {
      this.log('Stopping GoPro Python Bridge...', 'INFO');
      this.pythonProcess.kill();
      this.pythonProcess = null;
      this.isConnected = false;
    }
  }

  async sendCommand(command, data = {}) {
    return new Promise((resolve, reject) => {
      if (!this.pythonProcess) {
        reject(new Error('Python bridge not running'));
        return;
      }

      const commandId = ++this.commandId;
      const commandData = {
        id: commandId,
        command: command,
        ...data
      };

      // Store pending command
      this.pendingCommands.set(commandId, { resolve, reject });

      // Send command to Python
      this.pythonProcess.stdin.write(JSON.stringify(commandData) + '\n');

      // Set timeout
      setTimeout(() => {
        if (this.pendingCommands.has(commandId)) {
          this.pendingCommands.delete(commandId);
          reject(new Error(`Command timeout: ${command}`));
        }
      }, 10000); // 10 second timeout
    });
  }

  handleResponse(response) {
    const { id, success, error, message, status } = response;

    // Update connection status based on response
    if (error === 'Not connected' && this.isConnected) {
      this.isConnected = false;
      this.emit('disconnected');
    }

    if (id && this.pendingCommands.has(id)) {
      const { resolve, reject } = this.pendingCommands.get(id);
      this.pendingCommands.delete(id);

      if (success) {
        resolve({ message, status });
      } else {
        reject(new Error(error || 'Unknown error'));
      }
    } else {
      // Handle unsolicited responses - these are likely responses without IDs
      if (success !== undefined) {
        // This is a valid response, find the oldest pending command
        const oldestCommand = Array.from(this.pendingCommands.entries())[0];
        if (oldestCommand) {
          const [commandId, { resolve, reject }] = oldestCommand;
          this.pendingCommands.delete(commandId);

          if (success) {
            resolve({ message, status });
          } else {
            reject(new Error(error || 'Unknown error'));
          }
        } else {
          this.log(`Unsolicited response: ${JSON.stringify(response)}`, 'INFO');
        }
      } else {
        this.log(`Unsolicited response: ${JSON.stringify(response)}`, 'INFO');
      }
    }
  }

  // GoPro control methods
  async connect() {
    try {
      this.log('Connecting to GoPro via Python bridge...', 'INFO');
      const result = await this.sendCommand('connect');
      this.isConnected = true;
      this.log('Connected to GoPro successfully', 'SUCCESS');
      this.emit('connected');
      return result;
    } catch (e) {
      this.log(`Connection failed: ${e.message}`, 'ERROR');
      throw e;
    }
  }

  async disconnect() {
    try {
      this.log('Disconnecting from GoPro...', 'INFO');
      const result = await this.sendCommand('disconnect');
      this.isConnected = false;
      this.log('Disconnected from GoPro', 'SUCCESS');
      this.emit('disconnected');
      return result;
    } catch (e) {
      this.log(`Disconnect failed: ${e.message}`, 'ERROR');
      throw e;
    }
  }

  async getCameraStatus() {
    try {
      const result = await this.sendCommand('status');
      return result.status || { busy: 0, encoding: 0, ready: 1, group: 1 };
    } catch (e) {
      this.log(`Status query failed: ${e.message}`, 'ERROR');
      return { busy: undefined, encoding: undefined, ready: undefined, group: undefined };
    }
  }

  async snapPhoto(maxRetries = 3) {
    this.log('===== PHOTO CAPTURE START (Python SDK) =====', 'INFO');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.log(`Photo attempt ${attempt}/${maxRetries}`, 'INFO');

        const result = await this.sendCommand('take_photo');
        this.log(`Photo captured successfully on attempt ${attempt}`, 'SUCCESS');
        this.log('===== PHOTO CAPTURE END =====', 'INFO');
        return true;
      } catch (e) {
        this.log(`Photo attempt ${attempt} failed: ${e.message}`, 'ERROR');

        if (attempt < maxRetries) {
          const waitTime = 1000;
          this.log(`Waiting ${waitTime}ms before retry...`, 'INFO');
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        } else {
          throw new Error(`All photo attempts failed. Last error: ${e.message}`);
        }
      }
    }

    this.log('===== PHOTO CAPTURE END (FAILED) =====', 'ERROR');
    return false;
  }

  ready() {
    return this.pythonProcess !== null && this.isConnected;
  }

  log(message, level = 'INFO') {
    this.emit('log', `[${level}] ${message}`);
  }
}

module.exports = GoProPythonBridge;
