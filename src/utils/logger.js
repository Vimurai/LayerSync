/**
 * Logger utility for LayerSync
 * Provides consistent logging across the application
 */

class Logger {
  constructor() {
    this.logBuffer = [];
    this.maxBufferSize = 400;
  }

  /**
   * Log a message with timestamp and level
   * @param {string} message - Message to log
   * @param {string} level - Log level (INFO, ERROR, WARN, SUCCESS)
   */
  log(message, level = 'INFO') {
    const timestamp = new Date().toLocaleTimeString();
    const line = `[${timestamp}] [${level}] ${message}`;

    // Color coding for console output
    const color = this.getColorForLevel(level);
    console.log(`${color + line}\x1b[0m`);

    // Add to buffer
    this.logBuffer.push(line);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }
  }

  /**
   * Get color code for log level
   * @param {string} level - Log level
   * @returns {string} ANSI color code
   */
  getColorForLevel(level) {
    switch (level) {
      case 'ERROR':
        return '\x1b[31m';
      case 'WARN':
        return '\x1b[33m';
      case 'SUCCESS':
        return '\x1b[32m';
      default:
        return '\x1b[37m';
    }
  }

  /**
   * Get log buffer
   * @returns {Array} Array of log messages
   */
  getLogBuffer() {
    return [...this.logBuffer];
  }

  /**
   * Clear log buffer
   */
  clearBuffer() {
    this.logBuffer = [];
  }
}

module.exports = Logger;
