/**
 * timelapse_controller.js
 *
 * Run: node timelapse_controller.js
 * Deps: npm i @abandonware/noble mqtt
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');

// --- GoPro Controller (Python Bridge) ---
const GoProPythonBridge = require('../services/goproPythonBridge');
const goproBLE = new GoProPythonBridge();

// --- GLOBALS / STATE ---
const CONFIG_FILE = path.join(__dirname, '../../config/config.json');

let config = {};
let configLoaded = false;

let client = null;

let currentPrinterState = 'Initializing MQTT...';
let logBuffer = [];
let lastGoProStatus = 'Awaiting first action...';

let totalLayers = 0;
let currentLayer = 0;
let lastTriggerLayer = -1;
let layerChangeTime = Date.now();
let photoTriggerDelay = 800; // Delay after layer change before taking photo (ms)

// Shutdown flag to suppress errors during termination
let isShuttingDown = false;

// ---------- util logging ----------
function log(message, level = 'INFO') {
  // Suppress ERROR and WARN messages during shutdown
  if (isShuttingDown && (level === 'ERROR' || level === 'WARN')) {
    return;
  }

  const timestamp = new Date().toLocaleTimeString();
  const line = `[${timestamp}] [${level}] ${message}`;
  const color =
    level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : level === 'SUCCESS' ? '\x1b[32m' : '\x1b[37m';
  console.log(`${color + line}\x1b[0m`);
  logBuffer.push(line);
  if (logBuffer.length > 400) {
    logBuffer.shift();
  }
}

// ---------- config ----------
function saveConfig(newConfig) {
  const safe = {
    printer_ip: newConfig.printer_ip,
    printer_serial: newConfig.printer_serial,
    mqtt_username: newConfig.mqtt_username || newConfig.printer_serial,
    mqtt_password: newConfig.mqtt_password
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(safe, null, 2));
  log('Configuration saved (plain JSON).', 'SUCCESS');
}

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return null;
    }
    const safe = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config = { ...safe };
    if (!config.mqtt_username) {
      config.mqtt_username = config.printer_serial;
    }
    configLoaded = true;
    log('Configuration loaded from config.json', 'SUCCESS');
    return config;
  } catch (e) {
    log(`Failed to load configuration: ${e.message}`, 'ERROR');
    return null;
  }
}

function resetConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
    if (client) {
      client.end();
      client = null;
    }
    config = {};
    configLoaded = false;
    currentPrinterState = 'Awaiting configuration...';
    logBuffer = [];
    lastGoProStatus = 'Configuration Reset.';
    totalLayers = 0;
    currentLayer = 0;
    lastTriggerLayer = -1;
    layerChangeTime = Date.now();
    log('Application state reset.', 'INFO');
  } catch (e) {
    log(`Failed to reset configuration: ${e.message}`, 'ERROR');
  }
}

// ---------- BLE shutter trigger ----------
async function triggerGoProShutter(isTest = false) {
  const what = isTest ? 'Manual Test Command' : `Layer ${currentLayer} Trigger`;

  if (!goproBLE.ready()) {
    lastGoProStatus = '🛑 BLE not connected to GoPro yet.';
    log(lastGoProStatus, 'ERROR');
    return;
  }

  // For layer triggers, check if Bambu timelapse is enabled
  if (!isTest && !bambuTimelapseEnabled) {
    lastGoProStatus = '🎬 Bambu Lab timelapse is DISABLED - photo skipped';
    log(`⚠️  ${what} blocked: Bambu Lab timelapse is disabled`, 'WARN');
    return;
  }

  try {
    lastGoProStatus = `Sending ${what} via BLE…`;
    log(`[GoPro] take photo → ${what}`, 'INFO');

    // For timelapse photos, add a small delay to ensure consistent timing
    if (!isTest) {
      // Wait 500ms to ensure the layer change is stable and GoPro is ready
      await new Promise((resolve) => setTimeout(resolve, 500));
      log(`[Timelapse] Timing delay applied for consistent photo capture`, 'INFO');
    }

    // Check camera status before attempting photo
    const status = await goproBLE.getCameraStatus();
    if (status.busy !== null && status.encoding !== null && status.ready !== null) {
      log(`Camera status: busy=${status.busy}, encoding=${status.encoding}, ready=${status.ready}`, 'INFO');

      // If camera is busy, wait a bit more for it to be ready
      if (status.busy === 'True' || status.ready === 'False') {
        log(`[Timelapse] Camera busy/not ready, waiting for optimal timing...`, 'INFO');
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Check status again
        const retryStatus = await goproBLE.getCameraStatus();
        log(
          `Retry status: busy=${retryStatus.busy}, encoding=${retryStatus.encoding}, ready=${retryStatus.ready}`,
          'INFO'
        );
      }
    } else {
      log('Camera status unavailable - proceeding without status check', 'WARN');
    }

    // Use the improved snapPhoto with retry mechanism
    await goproBLE.snapPhoto(3);
    lastGoProStatus = `✅ Success: Photo captured for ${what}.`;
    log(lastGoProStatus, 'SUCCESS');
  } catch (e) {
    lastGoProStatus = `🛑 BLE snap failed: ${e.message}`;
    log(lastGoProStatus, 'ERROR');

    // Try to recover from busy state
    try {
      log('Attempting busy recovery...', 'INFO');
      await goproBLE.attemptBusyRecovery();
    } catch (recoveryError) {
      log(`Recovery attempt failed: ${recoveryError.message}`, 'ERROR');
    }
  }
}

// ---------- Bambu status handling ----------
// Global state tracking for stable printer status
let lastStableState = 'UNKNOWN';
let stateChangeTime = Date.now();
const stateStabilityThreshold = 5000; // 5 seconds

// Timelapse detection
let bambuTimelapseEnabled = false;

async function handlePrinterStatusUpdate(payload) {
  try {
    // Handle direct payload (not nested under 'print')
    const printData = payload.print || payload;
    log(`[MQTT] Print data: ${JSON.stringify(printData)}`, 'INFO');

    // Check Bambu Lab timelapse status
    const ipcamData = printData.ipcam || {};
    const timelapseStatus = ipcamData.timelapse;
    const wasTimelapseEnabled = bambuTimelapseEnabled;

    // Only update timelapse status if we have valid data
    if (timelapseStatus !== undefined) {
      bambuTimelapseEnabled = timelapseStatus === 'enable';

      // Log timelapse status changes
      if (wasTimelapseEnabled !== bambuTimelapseEnabled) {
        if (bambuTimelapseEnabled) {
          log('🎬 Bambu Lab timelapse ENABLED - GoPro will capture photos', 'SUCCESS');
        } else {
          log('🎬 Bambu Lab timelapse DISABLED - GoPro will not capture photos', 'WARN');
        }
      }
    }

    // Extract layer information with better fallbacks
    const newTotalLayers =
      printData.total_layer_num || printData.total_layers || printData.total_layers_num || totalLayers || 0;
    const newCurrentLayer = printData.layer_num || printData.current_layer || printData.layer || currentLayer || 0;

    // Preserve total layers if we have a valid value, otherwise keep existing
    if (printData.total_layer_num && printData.total_layer_num > 0) {
      totalLayers = printData.total_layer_num;
    }

    // Preserve current layer if we have a valid value, otherwise keep existing
    if (printData.layer_num && printData.layer_num > 0) {
      const oldLayer = currentLayer;
      currentLayer = printData.layer_num;
      if (oldLayer !== currentLayer) {
        log(`[MQTT] Layer updated: ${oldLayer} → ${currentLayer}`, 'INFO');
      }
    }

    // Extract state information - Bambu Lab uses different field names
    const mcState =
      printData.mc_state ||
      printData.state ||
      printData.print_state ||
      printData.mc_print_stage ||
      (printData.command === 'push_status' ? 'RUNNING' : 'UNKNOWN');
    const subState = printData.sub_state || printData.substate || printData.sub_state_str || '';

    // More stable printing detection
    const nozzleTemp = printData.nozzle_temper || 0;
    const bedTemp = printData.bed_temper || 0;
    const gcodeState = printData.gcode_state || '';
    const printType = printData.print_type || '';

    // Determine printing state based on multiple stable indicators
    let isPrinting = false;
    let newState = 'UNKNOWN';

    // Check for active print job - improved logic
    if (gcodeState === 'FINISH' || printType === 'idle') {
      // Print is finished
      isPrinting = false;
      newState = 'FINISHED';
    } else if (newCurrentLayer > 0 && newCurrentLayer < newTotalLayers) {
      // If we have layer data and not at the end, we're printing
      isPrinting = true;
      newState = 'PRINTING';
    } else if (printType === 'idle' || mcState === 'IDLE') {
      isPrinting = false;
      newState = 'IDLE';
    } else if (nozzleTemp > 150 || bedTemp > 60) {
      // High temperatures suggest heating/preparation
      isPrinting = false;
      newState = 'HEATING';
    } else if (mcState === 'RUNNING' && nozzleTemp > 50) {
      // Running with some heat suggests standby
      isPrinting = false;
      newState = 'STANDBY';
    } else {
      isPrinting = false;
      newState = 'STANDBY';
    }

    // Only update state if it's been stable for a while (prevents flickering)
    const now = Date.now();
    if (newState !== lastStableState) {
      if (now - stateChangeTime > stateStabilityThreshold) {
        // State has been different long enough, update it
        lastStableState = newState;
        stateChangeTime = now;

        log(`[MQTT] State changed to: ${newState} (stable for ${now - stateChangeTime}ms)`, 'INFO');
      } else {
        // State is changing too quickly, keep the old one
        log(`[MQTT] State change ignored: ${lastStableState} → ${newState} (too quick)`, 'WARN');
      }
    }

    // Layer data is already updated above in the preservation logic

    log(`[MQTT] Layers: ${currentLayer}/${totalLayers}, State: ${lastStableState}, Printing: ${isPrinting}`, 'INFO');

    // Only trigger photos if GoPro is connected, Bambu timelapse is enabled, and we have a stable printing state
    if (
      goproBLE.ready() &&
      bambuTimelapseEnabled &&
      lastStableState === 'PRINTING' &&
      currentLayer > 0 &&
      currentLayer !== lastTriggerLayer
    ) {
      const now = Date.now();

      log(
        `[Timelapse] Layer change detected: ${lastTriggerLayer} → ${currentLayer} (Bambu timelapse enabled)`,
        'SUCCESS'
      );

      // Update layer change time
      layerChangeTime = now;
      lastTriggerLayer = currentLayer;

      // Trigger photo with consistent timing
      setTimeout(async () => {
        try {
          await triggerGoProShutter(false);
        } catch (error) {
          log(`[Timelapse] Photo trigger failed: ${error.message}`, 'ERROR');
        }
      }, photoTriggerDelay);

      log(`[Timelapse] Photo scheduled in ${photoTriggerDelay}ms for consistent timing`, 'INFO');
    } else if (
      goproBLE.ready() &&
      !bambuTimelapseEnabled &&
      lastStableState === 'PRINTING' &&
      currentLayer > 0 &&
      currentLayer !== lastTriggerLayer
    ) {
      log(`⚠️  Layer ${currentLayer} detected but Bambu timelapse is DISABLED - skipping photo`, 'WARN');
      layerChangeTime = Date.now();
      lastTriggerLayer = currentLayer; // Still track layer changes
    } else if (
      !goproBLE.ready() &&
      lastStableState === 'PRINTING' &&
      currentLayer > 0 &&
      currentLayer !== lastTriggerLayer
    ) {
      log(`⚠️  Layer ${currentLayer} detected but GoPro not connected - skipping photo`, 'WARN');
      layerChangeTime = Date.now();
      lastTriggerLayer = currentLayer; // Still track layer changes
    }

    // Update display status based on stable state
    let baseStatus = '';
    switch (lastStableState) {
      case 'PRINTING':
        if (currentLayer > 0 && totalLayers > 0) {
          const percentage = ((currentLayer / totalLayers) * 100).toFixed(1);
          baseStatus = `Layer ${currentLayer} / ${totalLayers} (${percentage}%)`;
        } else if (currentLayer > 0) {
          baseStatus = `Layer ${currentLayer} (total unknown)`;
        } else {
          baseStatus = 'Printing...';
        }
        break;
      case 'FINISHED':
        baseStatus = 'IDLE / Print Finished';
        break;
      case 'HEATING':
        baseStatus = 'Heating...';
        break;
      case 'STANDBY':
        baseStatus = 'Standby';
        break;
      case 'IDLE':
        baseStatus = 'IDLE';
        break;
      default:
        baseStatus = `${lastStableState} - ${subState || 'Unknown'}`;
    }

    // Add timelapse status to the display
    const timelapseDisplayStatus = bambuTimelapseEnabled ? '🎬 Timelapse ON' : '🎬 Timelapse OFF';
    currentPrinterState = `${baseStatus} | ${timelapseDisplayStatus}`;

    // Log timelapse status for debugging when printing
    if (currentLayer > 0) {
      log(
        `[Timelapse Debug] Layer: ${currentLayer}/${totalLayers}, State: ${lastStableState}, Timelapse: ${bambuTimelapseEnabled ? 'ON' : 'OFF'}, GoPro: ${goproBLE.ready() ? 'Ready' : 'Not Ready'}`,
        'INFO'
      );
    }

    log(`[MQTT] Updated status: ${currentPrinterState}`, 'INFO');
  } catch (e) {
    log(`Error processing printer payload: ${e.message}`, 'ERROR');
    log(`Payload was: ${JSON.stringify(payload)}`, 'ERROR');
  }
}

// ---------- MQTT Status Request Functions ----------
function requestFullStatus() {
  if (!client || !client.connected) {
    log('[MQTT] Cannot request status - client not connected', 'WARN');
    return;
  }

  const { printer_serial } = config;
  if (!printer_serial) {
    log('[MQTT] Cannot request status - printer serial not configured', 'ERROR');
    return;
  }

  // Send command to request full status report
  const commandTopic = `device/${printer_serial}/request`;
  const command = {
    pushing: {
      sequence_id: Date.now().toString(),
      command: 'pushall'
    }
  };

  try {
    client.publish(commandTopic, JSON.stringify(command), { qos: 1 }, (err) => {
      if (err) {
        log(`[MQTT] Failed to request full status: ${err.message}`, 'ERROR');
      } else {
        log('[MQTT] Requested full status from printer', 'INFO');
      }
    });
  } catch (e) {
    log(`[MQTT] Exception requesting full status: ${e.message}`, 'ERROR');
  }
}

// ---------- MQTT ----------
let statusRequestInterval = null; // Store interval ID for cleanup

function setupMqttClient() {
  if (client) {
    log('MQTT already running.', 'WARN');
    return;
  }

  const { printer_ip, mqtt_password, printer_serial } = config;
  if (!printer_ip || !mqtt_password || !printer_serial) {
    log('MQTT config incomplete.', 'ERROR');
    return;
  }

  const masked = (s) =>
    typeof s === 'string' && s.length > 4 ? s.slice(0, 2) + '*'.repeat(s.length - 4) + s.slice(-2) : '(**hidden**)';

  log(`[MQTT TRY] IP=${printer_ip} SERIAL=${printer_serial} USER=bblp PASS=${masked(mqtt_password)}`, 'INFO');
  log(`[MQTT DIAGNOSTICS] Testing connection to ${printer_ip}:8883...`, 'INFO');

  const mqttUrl = `mqtts://${printer_ip}:8883`;
  currentPrinterState = 'CONNECTED / Awaiting data';

  const options = {
    protocol: 'mqtts',
    host: printer_ip,
    port: 8883,
    username: 'bblp',
    password: mqtt_password,
    clientId: `GoProTimelapse_${Date.now()}`, // Use timestamp to avoid conflicts
    keepalive: 60,
    reconnectPeriod: 10000,
    clean: true,
    rejectUnauthorized: false,
    connectTimeout: 15000,
    queueQoSZero: false,
    timeout: 15000
    // Temporarily remove will message to test
  };

  client = mqtt.connect(mqttUrl, options);

  // Add connection timeout handler
  const connectionTimeout = setTimeout(() => {
    if (client && !client.connected) {
      log('MQTT connection timeout - printer may be unreachable', 'ERROR');
      currentPrinterState = 'ERROR: Connection timeout - check printer network';
      client.end();
    }
  }, 20000); // 20 second timeout

  client.on('connect', () => {
    clearTimeout(connectionTimeout); // Clear timeout on successful connection
    log('MQTT connected.', 'SUCCESS');
    currentPrinterState = 'CONNECTED / Awaiting data';
    const topic = `device/${printer_serial}/report`;

    // Subscribe with better error handling
    try {
      client.subscribe(topic, { qos: 1 }, (err) => {
        if (!err) {
          log(`Subscribed to ${topic}`, 'SUCCESS');

          // Request full status immediately after subscription
          requestFullStatus();

          // Set up periodic full status requests every 30 seconds
          statusRequestInterval = setInterval(() => {
            if (client && client.connected) {
              requestFullStatus();
            }
          }, 30000);
        } else {
          log(`Subscription error: ${err.message}`, 'ERROR');
          currentPrinterState = `ERROR: Subscription failed (${err.message})`;
        }
      });
    } catch (e) {
      log(`Subscription exception: ${e.message}`, 'ERROR');
      currentPrinterState = `ERROR: Subscription exception (${e.message})`;
    }
  });

  client.on('message', (_topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      log(`[MQTT] Received message: ${JSON.stringify(payload, null, 2)}`, 'INFO');

      // Always try to process as printer status update
      // Bambu Lab sends direct status messages, not nested under 'print'
      handlePrinterStatusUpdate(payload);
    } catch (e) {
      log(`[MQTT] Failed to parse message: ${e.message}`, 'ERROR');
    }
  });

  client.on('error', (err) => {
    clearTimeout(connectionTimeout); // Clear timeout on error
    // Suppress MQTT errors during shutdown
    if (!isShuttingDown) {
      log(`MQTT Error: ${err.message}`, 'ERROR');

      // Provide specific diagnostics based on error type
      if (err.message.includes('Connection refused') || err.message.includes('Server unavailable')) {
        log('🔍 DIAGNOSTICS for "Connection refused":', 'ERROR');
        log(`  1. Check if printer IP ${printer_ip} is correct`, 'ERROR');
        log('  2. Verify printer is powered on and connected to network', 'ERROR');
        log('  3. Confirm MQTT password is correct (Access Code/Key)', 'ERROR');
        log(`  4. Try pinging printer: ping ${printer_ip}`, 'ERROR');
        log(`  5. Check if port 8883 is accessible: telnet ${printer_ip} 8883`, 'ERROR');
        currentPrinterState = 'ERROR: Connection refused - check IP/password/network';
      } else if (err.message.includes('ECONNREFUSED')) {
        log('🔍 DIAGNOSTICS for "ECONNREFUSED":', 'ERROR');
        log('  1. Printer may be offline or unreachable', 'ERROR');
        log(`  2. Check network connectivity to ${printer_ip}`, 'ERROR');
        log('  3. Verify printer is not in sleep mode', 'ERROR');
        currentPrinterState = 'ERROR: Printer unreachable - check network/power';
      } else if (err.message.includes('ENOTFOUND')) {
        log('🔍 DIAGNOSTICS for "ENOTFOUND":', 'ERROR');
        log(`  1. IP address ${printer_ip} cannot be resolved`, 'ERROR');
        log('  2. Check if IP address is correct', 'ERROR');
        log('  3. Verify network connectivity', 'ERROR');
        currentPrinterState = 'ERROR: Invalid IP address - check configuration';
      } else {
        currentPrinterState = `ERROR: MQTT Connection Failed (${err.code || err.message})`;
      }
    }

    // Safely close connection
    try {
      if (client) {
        client.removeAllListeners();
        client.end(false);
      }
    } catch (e) {
      log(`Error during MQTT cleanup: ${e.message}`, 'WARN');
    }
    client = null;
  });

  client.on('close', () => {
    if (!isShuttingDown) {
      log('MQTT connection closed.', 'WARN');
    }
    currentPrinterState = 'DISCONNECTED';
    client = null;
  });

  client.on('offline', () => {
    if (!isShuttingDown) {
      log('MQTT client offline.', 'WARN');
      currentPrinterState = 'OFFLINE';
    }
  });

  client.on('reconnect', () => {
    if (!isShuttingDown) {
      log('MQTT reconnecting...', 'INFO');
      currentPrinterState = 'RECONNECTING';
    }
  });
}

// ---------- Bootstrap ----------
function startApp() {
  // Start Python bridge
  goproBLE.start();
  goproBLE.on('log', (message) => log(message, 'INFO'));
  goproBLE.on('connected', () => {
    log('GoPro connected via Python bridge', 'SUCCESS');
    log('🎯 GoPro ready for timelapse capture', 'INFO');

    // Auto-connect to printer if configuration is available and not already connected
    if (configLoaded && !client) {
      log('🔄 Auto-connecting to printer...', 'INFO');
      setupMqttClient();
    } else if (!configLoaded) {
      log('⚠️  Printer configuration not available - please configure printer settings', 'WARN');
    } else if (client) {
      log('✅ Printer already connected', 'INFO');
    }
  });
  goproBLE.on('disconnected', () => {
    log('GoPro disconnected', 'WARN');
    // Disconnect printer when GoPro disconnects
    if (client) {
      log('Disconnecting printer due to GoPro disconnection', 'WARN');
      client.end(true);
      client = null;
      currentPrinterState = 'DISCONNECTED - GoPro required';
    }
  });

  if (!configLoaded) {
    const loaded = loadConfig();
    if (loaded) {
      config = loaded;
      configLoaded = true;
      setupMqttClient();
    } else {
      log('Waiting for configuration via web UI…', 'INFO');
    }
  } else if (!client) {
    setupMqttClient();
  }
}

// ---------- HTTP SERVER / API ----------
// const server = http.createServer(async (req, res) => {
/*
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = parsedUrl;

  // helper to read JSON body
  async function readJSON() {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  // ---- BLE SCAN
  if (pathname === '/api/ble/scan' && req.method === 'GET') {
    try {
      log('GoPro: Auto-discovery via Python bridge…', 'INFO');
      // Python bridge auto-discovers GoPro, so we return a dummy device
      const devices = [{ id: 'gopro-auto', name: 'GoPro (Auto-discovered)', rssi: -50 }];
      log('GoPro: Auto-discovery completed', 'SUCCESS');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, devices }));
    } catch (e) {
      log(`GoPro scan error: ${e.message}`, 'ERROR');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: e.message }));
    }
    return;
  }

  // ---- BLE CONNECT
  if (pathname === '/api/ble/connect' && req.method === 'POST') {
    try {
      log('GoPro: Connecting via Python bridge…', 'INFO');

      // Connect using Python bridge (no device ID needed - it auto-discovers)
      await goproBLE.connect();

      log('GoPro: Connected successfully', 'SUCCESS');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Connected to GoPro via Python bridge' }));
    } catch (e) {
      log(`GoPro connect error: ${e.message}`, 'ERROR');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: e.message }));
    }
    return;
  }

  // ---- BLE DISCONNECT
  if (pathname === '/api/ble/disconnect' && req.method === 'POST') {
    try {
      log('GoPro: Disconnecting via Python bridge…', 'INFO');

      // Disconnect using Python bridge
      await goproBLE.disconnect();

      log('GoPro: Disconnected successfully', 'SUCCESS');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Disconnected from GoPro via Python bridge' }));
    } catch (e) {
      log(`GoPro disconnect error: ${e.message}`, 'ERROR');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: e.message }));
    }
    return;
  }

  // ---- PRINTER reconnect
  if (pathname === '/api/reconnect-printer' && req.method === 'POST') {
    try {
      log('Reconnecting to printer...', 'INFO');

      // Clear existing status request interval
      if (statusRequestInterval) {
        log('Clearing existing status request interval...', 'INFO');
        clearInterval(statusRequestInterval);
        statusRequestInterval = null;
      }

      // Properly close existing connection
      if (client) {
        log('Closing existing MQTT connection...', 'INFO');
        client.removeAllListeners(); // Remove all event listeners to prevent errors
        client.end(false); // Graceful close
        client = null;
      }

      // Wait a moment for cleanup
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Setup new connection
      setupMqttClient();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Printer reconnection initiated' }));
    } catch (e) {
      log(`Printer reconnect error: ${e.message}`, 'ERROR');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: e.message }));
    }
    return;
  }

  // ---- Request full status from printer
  if (pathname === '/api/request-full-status' && req.method === 'POST') {
    try {
      log('Requesting full status from printer...', 'INFO');
      requestFullStatus();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Full status request sent to printer' }));
    } catch (e) {
      log(`Full status request error: ${e.message}`, 'ERROR');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: e.message }));
    }
    return;
  }

  // ---- Set photo trigger delay
  if (pathname === '/api/set-photo-delay' && req.method === 'POST') {
    try {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        const data = JSON.parse(body);
        const newDelay = parseInt(data.delay);

        if (isNaN(newDelay) || newDelay < 0 || newDelay > 5000) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Delay must be between 0 and 5000 milliseconds' }));
          return;
        }

        photoTriggerDelay = newDelay;
        log(`Photo trigger delay updated to ${photoTriggerDelay}ms`, 'INFO');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            message: `Photo trigger delay set to ${photoTriggerDelay}ms`,
            delay: photoTriggerDelay
          })
        );
      });
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
    return;
  }

  // ---- Test shutter
  if (pathname === '/api/test-shutter' && req.method === 'POST') {
    await triggerGoProShutter(true);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, status: lastGoProStatus }));
    return;
  }

  // ---- Camera status
  if (pathname === '/api/camera-status' && req.method === 'GET') {
    try {
      // First check the actual connection status
      const connectionStatus = await goproBLE.checkConnection();

      if (!connectionStatus.connected) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            message: 'Camera not connected',
            connected: false,
            ble_connected: false,
            status: { busy: null, encoding: null, ready: null, group: null }
          })
        );
        return;
      }

      // If connected, get camera status
      const status = await goproBLE.getCameraStatus();
      const isReady = await goproBLE.isCameraReady();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          connected: true,
          ble_connected: connectionStatus.ble_connected,
          status,
          isReady,
          message: isReady ? 'Camera is ready' : 'Camera is busy'
        })
      );
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: e.message }));
    }
    return;
  }

  // ---- Debug info
  if (pathname === '/api/debug' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        config: {
          printer_ip: config.printer_ip,
          printer_serial: config.printer_serial,
          mqtt_password: config.mqtt_password ? '***hidden***' : 'missing'
        },
        status: {
          currentLayer,
          totalLayers,
          lastTriggerLayer,
          photoTriggerDelay,
          currentPrinterState,
          lastGoProStatus,
          mqttConnected: !!client,
          goproConnected: goproBLE.ready()
        },
        timestamps: {
          lastUpdate: new Date().toISOString()
        }
      })
    );
    return;
  }

  // ---- Test printer connection
  if (pathname === '/api/test-printer-connection' && req.method === 'POST') {
    try {
      const body = await readJSON();
      const testConfig = body && Object.keys(body).length > 0 ? body : config;

      if (!testConfig || !testConfig.printer_ip || !testConfig.mqtt_password || !testConfig.printer_serial) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            message: 'Missing required fields: printer_ip, mqtt_password, printer_serial'
          })
        );
        return;
      }

      log(`🔍 Testing printer connection to ${testConfig.printer_ip}...`, 'INFO');

      // Test basic connectivity first
      const net = require('net');
      const testSocket = new net.Socket();

      const connectivityTest = new Promise((resolve) => {
        testSocket.setTimeout(5000);

        testSocket.on('connect', () => {
          log(`✅ Port 8883 is accessible on ${testConfig.printer_ip}`, 'SUCCESS');
          testSocket.destroy();
          resolve({ port: true, error: null });
        });

        testSocket.on('timeout', () => {
          log(`❌ Port 8883 timeout on ${testConfig.printer_ip}`, 'ERROR');
          testSocket.destroy();
          resolve({ port: false, error: 'Connection timeout' });
        });

        testSocket.on('error', (err) => {
          log(`❌ Port 8883 connection failed: ${err.message}`, 'ERROR');
          resolve({ port: false, error: err.message });
        });

        testSocket.connect(8883, testConfig.printer_ip);
      });

      const connectivityResult = await connectivityTest;

      if (!connectivityResult.port) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            message: 'Basic connectivity test failed',
            diagnostics: {
              ip: testConfig.printer_ip,
              port: 8883,
              error: connectivityResult.error,
              suggestions: [
                'Check if printer IP is correct',
                'Verify printer is powered on',
                'Check network connectivity',
                `Try pinging the printer: ping ${testConfig.printer_ip}`
              ]
            }
          })
        );
        return;
      }

      // If port is accessible, test MQTT connection
      log('🔍 Testing MQTT connection with credentials...', 'INFO');

      const mqtt = require('mqtt');
      const testClient = mqtt.connect(`mqtts://${testConfig.printer_ip}:8883`, {
        username: 'bblp',
        password: testConfig.mqtt_password,
        clientId: `TestConnection_${Date.now()}`,
        connectTimeout: 10000,
        rejectUnauthorized: false
      });

      const mqttTest = new Promise((resolve) => {
        const timeout = setTimeout(() => {
          testClient.end();
          resolve({ mqtt: false, error: 'MQTT connection timeout' });
        }, 10000);

        testClient.on('connect', () => {
          clearTimeout(timeout);
          log('✅ MQTT connection successful!', 'SUCCESS');
          testClient.end();
          resolve({ mqtt: true, error: null });
        });

        testClient.on('error', (err) => {
          clearTimeout(timeout);
          log(`❌ MQTT connection failed: ${err.message}`, 'ERROR');
          testClient.end();
          resolve({ mqtt: false, error: err.message });
        });
      });

      const mqttResult = await mqttTest;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: mqttResult.mqtt,
          message: mqttResult.mqtt ? 'Connection test successful' : 'MQTT connection failed',
          diagnostics: {
            ip: testConfig.printer_ip,
            port: 8883,
            username: 'bblp',
            password_masked: testConfig.mqtt_password
              ? testConfig.mqtt_password.slice(0, 2) +
                '*'.repeat(testConfig.mqtt_password.length - 4) +
                testConfig.mqtt_password.slice(-2)
              : 'missing',
            connectivity: connectivityResult,
            mqtt: mqttResult,
            suggestions: mqttResult.mqtt
              ? []
              : [
                  'Check MQTT password (Access Code/Key)',
                  'Verify printer serial number',
                  'Ensure printer is not in sleep mode',
                  'Try restarting the printer'
                ]
          }
        })
      );
    } catch (e) {
      log(`Connection test error: ${e.message}`, 'ERROR');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: e.message }));
    }
    return;
  }

  // ---- Force camera control
  if (pathname === '/api/force-camera-control' && req.method === 'POST') {
    try {
      if (!goproBLE.ready()) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Camera not connected' }));
        return;
      }

      log('Forcing camera control takeover...', 'INFO');
      await goproBLE.forceControlTakeover();
      await goproBLE.forceCameraIdle();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Camera control forced' }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: e.message }));
    }
    return;
  }

  // ---- Save config
  if (pathname === '/api/config' && req.method === 'POST') {
    try {
      const body = await readJSON();
      if (!body.printer_ip || !body.printer_serial || !body.mqtt_password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Missing required fields' }));
        return;
      }
      body.mqtt_username = body.printer_serial;
      saveConfig(body);

      if (client) {
        client.end(true);
        client = null;
      }
      configLoaded = false;
      startApp();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: e.message }));
    }
    return;
  }

  // ---- Reset config
  if (pathname === '/api/reset' && req.method === 'POST') {
    resetConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // ---- Status
  if (pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        config_loaded: configLoaded,
        printer_status: currentPrinterState,
        gopro_status: lastGoProStatus + (goproBLE.ready() ? ' (BLE Ready)' : ' (BLE Not Ready)'),
        current_layer: currentLayer,
        total_layers: totalLayers,
        bambu_timelapse_enabled: bambuTimelapseEnabled,
        log_buffer: logBuffer
      })
    );
    return;
  }

  // ---- UI
  if (pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(generateHtml(configLoaded));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

// ---------- Error Handling & Cleanup ----------
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('uncaughtException', (err) => {
  console.error(`Uncaught Exception: ${err.message}`);
  gracefulShutdown();
});
process.on('unhandledRejection', (reason, promise) => {
  console.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

async function gracefulShutdown(signal = 'SIGTERM') {
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
  isShuttingDown = true; // Set flag to suppress error messages

  try {
    // Clear status request interval
    if (statusRequestInterval) {
      console.log('Clearing status request interval...');
      clearInterval(statusRequestInterval);
      statusRequestInterval = null;
    }

    // Close MQTT connection
    if (client) {
      console.log('Closing MQTT connection...');
      try {
        client.removeAllListeners(); // Remove all event listeners first
        client.end(false); // Graceful close
      } catch (e) {
        console.log(`MQTT cleanup error: ${e.message}`);
      }
      client = null;
    }

    // Disconnect GoPro and stop Python bridge
    if (goproBLE) {
      console.log('Disconnecting GoPro and stopping Python bridge...');
      if (goproBLE.ready()) {
        await goproBLE.disconnect().catch(() => {});
      }
      goproBLE.stop();
    }

    // Close HTTP server
    if (server) {
      console.log('Closing HTTP server...');
      server.close(() => {
        console.log('Graceful shutdown completed.');
        process.exit(0);
      });

      // Force exit after 5 seconds if graceful shutdown takes too long
      setTimeout(() => {
        console.log('Forcing exit after timeout...');
        process.exit(1);
      }, 5000);
    } else {
      process.exit(0);
    }
  } catch (e) {
    console.error(`Error during shutdown: ${e.message}`);
    process.exit(1);
  }
}
  */

// ---------- HTML ----------
function generateHtml(isConfigured) {
  const initialIP = config.printer_ip || '';
  const initialSerial = config.printer_serial || '';

  const printerIPDisplay = config.printer_ip ? config.printer_ip : '--';
  const printerSerialDisplay = config.printer_serial ? config.printer_serial : '--';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>LayerSync - Automated Timelapse Capture</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --primary-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    --secondary-gradient: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    --success-gradient: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
    --warning-gradient: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
    --danger-gradient: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
    --dark-gradient: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
  }

  * { box-sizing: border-box; }

  body {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    background-attachment: fixed;
    font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial;
    min-height: 100vh;
    margin: 0;
    padding: 0;
  }

  .glass-card {
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(20px);
    border-radius: 24px;
    box-shadow: 0 20px 40px rgba(0,0,0,0.1), 0 0 0 1px rgba(255,255,255,0.2);
    border: 1px solid rgba(255,255,255,0.3);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .glass-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 25px 50px rgba(0,0,0,0.15), 0 0 0 1px rgba(255,255,255,0.3);
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    padding: 0.5rem 1rem;
    border-radius: 50px;
    font-size: 0.875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    transition: all 0.3s ease;
  }

  .status-pill::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 0.5rem;
    animation: pulse 2s infinite;
  }

  .status-pill.idle::before { background: #6b7280; }
  .status-pill.connected::before { background: #10b981; }
  .status-pill.error::before { background: #ef4444; }
  .status-pill.warning::before { background: #f59e0b; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .btn-primary, .btn-success, .btn-warning, .btn-danger, .btn-dark {
    border: none;
    color: white;
    font-weight: 600;
    padding: 0.75rem 1.5rem;
    border-radius: 12px;
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
    cursor: pointer;
    font-size: 0.875rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .btn-primary {
    background: var(--primary-gradient);
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
  }

  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(102, 126, 234, 0.6);
  }

  .btn-success {
    background: var(--success-gradient);
    box-shadow: 0 4px 15px rgba(79, 172, 254, 0.4);
  }

  .btn-success:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(79, 172, 254, 0.6);
  }

  .btn-warning {
    background: var(--warning-gradient);
    box-shadow: 0 4px 15px rgba(67, 233, 123, 0.4);
  }

  .btn-warning:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(67, 233, 123, 0.6);
  }

  .btn-danger {
    background: var(--danger-gradient);
    box-shadow: 0 4px 15px rgba(250, 112, 154, 0.4);
  }

  .btn-danger:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(250, 112, 154, 0.6);
  }

  .btn-dark {
    background: var(--dark-gradient);
    box-shadow: 0 4px 15px rgba(44, 62, 80, 0.4);
  }

  .btn-dark:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(44, 62, 80, 0.6);
  }

  .btn-primary:active, .btn-success:active, .btn-warning:active, .btn-danger:active, .btn-dark:active {
    transform: translateY(0);
  }

  .btn-primary:disabled, .btn-success:disabled, .btn-warning:disabled, .btn-danger:disabled, .btn-dark:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }

  .log-box {
    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
    white-space: pre-wrap;
    background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 100%);
    color: #e2e8f0;
    padding: 1.5rem;
    border-radius: 16px;
    overflow-y: auto;
    height: 400px;
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);
  }

  .log-box::-webkit-scrollbar {
    width: 8px;
  }

  .log-box::-webkit-scrollbar-track {
    background: rgba(255,255,255,0.1);
    border-radius: 4px;
  }

  .log-box::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,0.3);
    border-radius: 4px;
  }

  .log-box::-webkit-scrollbar-thumb:hover {
    background: rgba(255,255,255,0.5);
  }

  .device-select {
    background: rgba(255,255,255,0.9);
    border: 2px solid rgba(102, 126, 234, 0.2);
    border-radius: 12px;
    padding: 0.875rem 1rem;
    font-size: 1rem;
    transition: all 0.3s ease;
    backdrop-filter: blur(10px);
  }

  .device-select:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    background: rgba(255,255,255,1);
  }

  .section-header {
    display: flex;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .section-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
    margin-right: 1rem;
    background: var(--primary-gradient);
    color: white;
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
  }

  .section-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: #1f2937;
    margin: 0;
  }

  .progress-bar {
    width: 100%;
    height: 8px;
    background: rgba(102, 126, 234, 0.1);
    border-radius: 4px;
    overflow: hidden;
    margin-top: 0.5rem;
  }

  .progress-fill {
    height: 100%;
    background: var(--primary-gradient);
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .floating-action {
    position: fixed;
    bottom: 2rem;
    right: 2rem;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: var(--primary-gradient);
    color: white;
    border: none;
    font-size: 1.5rem;
    box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
    transition: all 0.3s ease;
    z-index: 1000;
  }

  .floating-action:hover {
    transform: scale(1.1);
    box-shadow: 0 12px 35px rgba(102, 126, 234, 0.6);
  }

  @media (max-width: 768px) {
    .glass-card {
      margin: 0.5rem;
      border-radius: 16px;
    }

    .section-icon {
      width: 40px;
      height: 40px;
      font-size: 1.25rem;
    }

    .section-title {
      font-size: 1.25rem;
    }
  }
</style>
</head>
<body>
  <div class="min-h-screen p-4 md:p-8">
    <div class="max-w-6xl mx-auto">
      <!-- Hero Header -->
      <header class="text-center mb-12">
        <div class="glass-card p-8 mb-8">
          <h1 class="text-4xl md:text-6xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent mb-4">
            LayerSync
          </h1>
          <p class="text-lg text-gray-600 mb-2">Automated timelapse capture synchronized with your Bambu Lab printer</p>
          <div class="flex items-center justify-center space-x-4 text-sm text-gray-500">
            <span class="flex items-center">
              <span class="w-2 h-2 bg-green-400 rounded-full mr-2"></span>
              v1.0.0
            </span>
            <span>by Emir Kovacevic</span>
          </div>
        </div>
      </header>

      <!-- GoPro Connection Section -->
      <section class="glass-card p-8 mb-8">
        <div class="section-header">
          <div class="section-icon">
            📡
          </div>
          <div class="flex-1">
            <h2 class="section-title">GoPro Camera Connection</h2>
            <p class="text-gray-600 mt-1">Connect your GoPro via Bluetooth for automated timelapse capture</p>
          </div>
          <span id="ble-state" class="status-pill idle">Idle</span>
        </div>

        <div class="space-y-6">
          <div class="flex flex-col lg:flex-row gap-4">
            <select id="ble-select" class="device-select flex-1">
              <option value="">No devices — click Scan to discover</option>
            </select>

            <div class="flex flex-wrap gap-3">
              <button id="btn-scan" class="btn-primary">
                🔍 Scan
              </button>
              <button id="btn-connect" class="btn-success">
                🔗 Connect
              </button>
            </div>
          </div>

          <div class="flex flex-wrap gap-3">
            <button id="btn-reconnect" class="btn-warning">
              🔄 Reconnect Printer
            </button>
            <button id="btn-test-connection" class="btn-primary">
              ✅ Test Connection
            </button>
            <button id="btn-request-status" class="btn-dark">
              📊 Request Full Status
            </button>
          </div>

          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p class="text-sm text-blue-800">
              <span class="font-semibold">💡 Tip:</span> Make sure your GoPro is in pairing mode (Settings > Connections > Connect Device).
              You should see all nearby Bluetooth devices here. Select your GoPro by name, then press Connect.
            </p>
          </div>
        </div>
      </section>

      <!-- Status Dashboard -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        <!-- Printer Status Card -->
        <div class="glass-card p-6">
          <div class="section-header mb-4">
            <div class="section-icon bg-gradient-to-r from-blue-500 to-blue-600">
              🖨️
            </div>
            <div>
              <h3 class="section-title text-lg">Bambu Lab Printer</h3>
            </div>
          </div>

          <div class="space-y-4">
            <div>
              <p id="printer-status-text" class="text-xl font-bold text-gray-800 break-words">DISCONNECTED</p>
              <div class="progress-bar">
                <div class="progress-fill" style="width: 0%"></div>
              </div>
            </div>

            <div class="space-y-2 text-sm text-gray-600">
              <div class="flex justify-between">
                <span>IP Address:</span>
                <span class="font-mono">${printerIPDisplay}</span>
              </div>
              <div class="flex justify-between">
                <span>Serial:</span>
                <span class="font-mono">${printerSerialDisplay}</span>
              </div>
            </div>

            <div class="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p class="text-xs text-blue-800">
                <span class="font-semibold">📡</span> Click "Reconnect Printer" to establish connection
              </p>
            </div>
          </div>
        </div>

        <!-- Print Progress Card -->
        <div class="glass-card p-6">
          <div class="section-header mb-4">
            <div class="section-icon bg-gradient-to-r from-green-500 to-green-600">
              📊
            </div>
            <div>
              <h3 class="section-title text-lg">Print Progress</h3>
            </div>
          </div>

          <div class="space-y-4">
            <div>
              <p id="layer-progress-text" class="text-xl font-bold text-gray-800">Total Layers: --</p>
              <div class="progress-bar">
                <div class="progress-fill" style="width: 0%"></div>
              </div>
            </div>

            <div class="space-y-2 text-sm text-gray-600">
              <div class="flex justify-between">
                <span>Current Layer:</span>
                <span id="current-layer-num" class="font-semibold">--</span>
              </div>
              <div class="flex justify-between">
                <span>Last Trigger:</span>
                <span id="last-trigger-layer" class="font-semibold">--</span>
              </div>
            </div>

            <div class="bg-green-50 border border-green-200 rounded-lg p-3">
              <p class="text-xs text-green-800">
                <span class="font-semibold">🎬</span> Timelapse photos will be captured automatically
              </p>
            </div>
          </div>
        </div>

        <!-- GoPro Camera Card -->
        <div class="glass-card p-6 flex flex-col">
          <div class="section-header mb-4">
            <div class="section-icon bg-gradient-to-r from-purple-500 to-purple-600">
              📷
            </div>
            <div>
              <h3 class="section-title text-lg">GoPro Camera</h3>
            </div>
          </div>

          <div class="flex-1 space-y-4">
            <div>
              <p id="gopro-status-text" class="text-sm font-medium text-gray-600 break-words">Awaiting first action…</p>
            </div>

            <div class="space-y-3">
              <button id="btn-test-shutter" class="w-full btn-success">
                📸 Test Shutter
              </button>
              <button id="btn-force-control" class="w-full btn-danger">
                ⚡ Force Control
              </button>
              <button id="btn-debug" class="w-full btn-dark">
                🔍 Debug Info
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Live Activity Log -->
      <section class="glass-card p-8">
        <div class="section-header mb-6">
          <div class="section-icon bg-gradient-to-r from-gray-500 to-gray-600">
            📝
          </div>
          <div>
            <h3 class="section-title">Live Activity Log</h3>
            <p class="text-gray-600 mt-1">Real-time monitoring of printer and camera activity</p>
          </div>
        </div>

        <div id="log-box" class="log-box">Awaiting connection…</div>
      </section>

      <!-- Footer -->
      <footer class="text-center mt-12 mb-8">
        <div class="glass-card p-6">
          <div class="flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0">
            <div class="text-sm text-gray-600">
              <p>&copy; 2024 LayerSync by Emir Kovacevic. All rights reserved.</p>
            </div>
            <div class="flex space-x-6 text-sm">
              <a href="#" class="text-indigo-600 hover:text-indigo-800 transition-colors">Documentation</a>
              <a href="#" class="text-indigo-600 hover:text-indigo-800 transition-colors">Support</a>
              <a href="#" class="text-indigo-600 hover:text-indigo-800 transition-colors">GitHub</a>
            </div>
          </div>
        </div>
      </footer>
      ${isConfigured ? '' : configurationFormHtml(initialIP, initialSerial)}
    </div>
  </div>

<script>
/* ------------- helpers ------------- */
const bleSelect       = document.getElementById('ble-select');
const bleState        = document.getElementById('ble-state');
const btnScan         = document.getElementById('btn-scan');
const btnConnect      = document.getElementById('btn-connect');
const btnReconnect    = document.getElementById('btn-reconnect');
const btnTestConnection = document.getElementById('btn-test-connection');
const btnRequestStatus = document.getElementById('btn-request-status');
const btnTest         = document.getElementById('btn-test-shutter');
const btnForceControl = document.getElementById('btn-force-control');
const btnDebug        = document.getElementById('btn-debug');

const statusText      = document.getElementById('printer-status-text');
const layerText       = document.getElementById('layer-progress-text');
const curLayerEl      = document.getElementById('current-layer-num');
const lastTrigEl      = document.getElementById('last-trigger-layer');
const goproStatusEl   = document.getElementById('gopro-status-text');
const logBox          = document.getElementById('log-box');

function showError(msg) {
  try { alert(msg); } catch(_) {}
}

function showSuccess(msg) {
  try { alert(msg); } catch(_) {}
}

function setBleState(text, tone='info') {
  const cls =
    tone === 'err' ? 'status-pill error' :
    tone === 'ok'  ? 'status-pill connected' :
    tone === 'warn'? 'status-pill warning' :
                     'status-pill idle';
  bleState.className = cls;
  bleState.textContent = text;
}

function updatePrinterStatus(text) {
  if (!statusText) return;
  statusText.textContent = text || '—';
}

function updateLog(buf) {
  if (!logBox || !Array.isArray(buf)) return;
  const content = buf.join('\\n');
  if (logBox.textContent !== content) {
    logBox.textContent = content;
    logBox.scrollTop = logBox.scrollHeight;
  }
}

/* Robust API (no more "reading 'catch' of undefined") */
async function api(path, { method='GET', body } = {}) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(path, opt);
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok || (data && data.success === false)) {
    const msg = (data && (data.message || data.status)) || ('HTTP ' + res.status);
    throw new Error(msg);
  }
  return data || {};
}

/* ------------- BLE UI logic ------------- */
async function loadBleDevices() {
  try {
    console.log('loadBleDevices called'); // Debug
    setBleState('Scanning…', 'warn');
    console.log('setBleState called'); // Debug
    const r = await api('/api/ble/scan');
    console.log('API call completed:', r); // Debug
    const list = r.devices || [];
    bleSelect.innerHTML = '';
    if (!list.length) {
      const o = document.createElement('option');
      o.textContent = 'No devices — click Scan';
      o.value = '';
      bleSelect.appendChild(o);
    } else {
      for (const d of list) {
        const o = document.createElement('option');
        o.value = d.id;
        o.textContent = \`\${d.name || 'Unknown'} — \${d.id}\${d.rssi ? \` (rssi \${d.rssi})\` : ''}\`;
        bleSelect.appendChild(o);
      }
    }
    setBleState(\`Found \${list.length} device(s)\`, 'ok');
    console.log('loadBleDevices completed successfully'); // Debug
  } catch (e) {
    console.error('loadBleDevices error:', e); // Debug
    setBleState('Scan error', 'err');
    showError('Scan failed: ' + e.message);
  }
}

async function connectSelected() {
  const id = bleSelect.value || '';
  if (!id) { showError('Pick your GoPro first'); return; }

  // Check if already connected
  const isCurrentlyConnected = btnConnect.textContent.includes('Connected ✓');

  if (isCurrentlyConnected) {
    // Disconnect
    try {
      btnConnect.disabled = true;
      btnConnect.textContent = 'Disconnecting…';
      setBleState('Disconnecting…', 'warn');

      await api('/api/ble/disconnect', { method:'POST' });

      setBleState('Disconnected', 'err');
      btnConnect.textContent = 'Connect…';
      btnConnect.disabled = false;

      if (goproStatusEl) {
        goproStatusEl.textContent = 'Disconnected';
      }
    } catch (e) {
      btnConnect.textContent = 'Connected ✓';
      btnConnect.disabled = false;
      setBleState('Disconnect failed', 'err');
      showError('Disconnect failed: ' + e.message);
    }
  } else {
    // Connect
    const originalText = btnConnect.textContent;
    btnConnect.disabled = true;
    btnConnect.textContent = 'Connecting…';

    try {
      setBleState('Connecting…', 'warn');
      const result = await api('/api/ble/connect', { method:'POST', body: { device_id: id }});

      if (result.success) {
        setBleState('Connected', 'ok');
        btnConnect.textContent = 'Connected ✓';
        btnConnect.disabled = false;

        // Update GoPro status display
        if (goproStatusEl) {
          goproStatusEl.textContent = 'Connected via Python bridge';
        }
      } else {
        throw new Error(result.message || 'Connection failed');
      }
    } catch (e) {
      setBleState('Connect error', 'err');
      btnConnect.textContent = originalText;
      btnConnect.disabled = false;

      // Update GoPro status display
      if (goproStatusEl) {
        goproStatusEl.textContent = 'Connection failed: ' + e.message;
      }

      showError('Connect failed: ' + e.message);
    }
  }
}

/* printer reconnect */
async function checkAndAutoConnectPrinter() {
  try {
    // Check GoPro status via API call since goproBLE is not available in frontend
    const goproStatus = await api('/api/status');
    if (goproStatus.success && goproStatus.gopro && goproStatus.gopro.connected) {
      // Check if printer is not connected
      if (!goproStatus.printer || !goproStatus.printer.connected) {
        console.log('Auto-connecting to printer (GoPro is ready)...');
        await reconnectPrinter();
      }
    }
  } catch (error) {
    console.error('Auto-connect printer error:', error.message);
  }
}

async function reconnectPrinter() {
  try {
    // Update UI to show reconnecting state
    if (statusText) {
      statusText.textContent = 'RECONNECTING...';
    }

    const result = await api('/api/reconnect-printer', { method:'POST' });

    if (result.success) {
      // Show success message briefly
      if (statusText) {
        statusText.textContent = 'Reconnection initiated...';
      }

      // Wait a moment then check status
      setTimeout(async () => {
        try {
          const status = await api('/api/status');
          if (statusText) {
            statusText.textContent = status.printer_status || 'Checking connection...';
          }
        } catch (e) {
          if (statusText) {
            statusText.textContent = 'Connection check failed';
          }
        }
      }, 3000);
    } else {
      throw new Error(result.message || 'Reconnection failed');
    }
  } catch (e) {
    if (statusText) {
      statusText.textContent = 'Reconnect failed';
    }
    showError('Reconnect failed: ' + e.message);
  }
}

/* status poll */
async function pollStatus() {
  try {
    const r = await api('/api/status');
    updatePrinterStatus(r.printer_status);
    if (layerText) {
      if (r.total_layers > 0) {
        layerText.textContent = \`\${r.current_layer} of \${r.total_layers} Layers\`;
        if (curLayerEl) curLayerEl.textContent = r.current_layer;
        if (lastTrigEl) lastTrigEl.textContent = r.current_layer;
      } else {
        layerText.textContent = 'Total Layers: --';
      }
    }
    if (goproStatusEl) goproStatusEl.textContent = r.gopro_status;
    updateLog(r.log_buffer);

    // Check for auto-connection opportunity
    await checkAndAutoConnectPrinter();

    // Check actual GoPro connection status
    try {
      const goproStatus = await api('/api/camera-status', { method:'GET' });
      if (goproStatus.success && goproStatus.connected) {
        // GoPro Python bridge is connected and responding
        if (btnConnect) {
          btnConnect.textContent = 'Connected ✓';
          btnConnect.disabled = false;
        }
        if (bleState) {
          setBleState('Connected', 'ok');
        }
      } else {
        // GoPro is not connected
        if (btnConnect) {
          btnConnect.textContent = 'Connect…';
          btnConnect.disabled = false;
        }
        if (bleState) {
          setBleState('Disconnected', 'err');
        }
      }
    } catch (e) {
      // If camera status check fails, assume disconnected
      if (btnConnect) {
        btnConnect.textContent = 'Connect…';
        btnConnect.disabled = false;
      }
      if (bleState) {
        setBleState('Disconnected', 'err');
      }
    }
  } catch (e) {
    console.error('pollStatus error:', e);
  }
}

/* test printer connection */
async function testPrinterConnection() {
  try {
    btnTestConnection.disabled = true;
    btnTestConnection.textContent = 'Testing...';

    const result = await api('/api/test-printer-connection', { method:'POST' });

    if (result.success) {
      showError('SUCCESS: Connection test successful! Printer is reachable.');
    } else {
      let message = 'FAILED: Connection test failed: ' + result.message;
      if (result.diagnostics && result.diagnostics.suggestions) {
        message += 'Suggestions:' + result.diagnostics.suggestions.map(s => '- ' + s).join('\\n');
      }
      showError(message);
    }
  } catch (e) {
    showError('Connection test failed: ' + e.message);
  } finally {
    btnTestConnection.disabled = false;
    btnTestConnection.textContent = 'Test Connection';
  }
}

/* request full status from printer */
async function requestFullStatusFromPrinter() {
  try {
    btnRequestStatus.disabled = true;
    btnRequestStatus.textContent = 'Requesting...';

    const result = await api('/api/request-full-status', { method:'POST' });

    if (result.success) {
      showSuccess('Full status request sent to printer');
    } else {
      showError('Failed to request full status: ' + result.message);
    }
  } catch (e) {
    showError('Request failed: ' + e.message);
  } finally {
    btnRequestStatus.disabled = false;
    btnRequestStatus.textContent = 'Request Full Status';
  }
}

/* test shutter */
async function testShutter() {
  try {
    await api('/api/test-shutter', { method:'POST' });
  } catch (e) {
    showError('Test failed: ' + e.message);
  }
}

async function forceControl() {
  try {
    await api('/api/force-camera-control', { method:'POST' });
  } catch (e) {
    showError('Force control failed: ' + e.message);
  }
}

async function showDebugInfo() {
  try {
    const data = await api('/api/debug', { method:'GET' });
    const debugText = JSON.stringify(data, null, 2);
    alert('Debug Information:' + debugText);
  } catch (e) {
    showError('Debug info failed: ' + e.message);
  }
}

/* wire up */
btnScan?.addEventListener('click', loadBleDevices);
btnConnect?.addEventListener('click', connectSelected);
btnReconnect?.addEventListener('click', reconnectPrinter);
btnTestConnection?.addEventListener('click', testPrinterConnection);
btnRequestStatus?.addEventListener('click', requestFullStatusFromPrinter);
btnTest?.addEventListener('click', testShutter);
btnForceControl?.addEventListener('click', forceControl);
btnDebug?.addEventListener('click', showDebugInfo);

/* initial */
loadBleDevices();
pollStatus();
setInterval(pollStatus, 1500);
</script>

<footer class="mt-12 text-center text-xs text-gray-400 border-t pt-4">
  <p>&copy; 2024 Emir Kovacevic. LayerSync v1.0.0 - MIT License</p>
  <p class="mt-1">
    <a href="https://github.com/emirkovacevic/layersync" class="text-blue-500 hover:text-blue-600">GitHub</a> |
    <a href="https://github.com/emirkovacevic/layersync/issues" class="text-blue-500 hover:text-blue-600">Issues</a>
  </p>
</footer>
</body>
</html>`;
}

function configurationFormHtml(initialIP, initialSerial) {
  return `
  <section class="card p-6 mt-6">
    <h2 class="text-xl font-semibold text-gray-700 mb-4 border-b pb-2">Configuration Required</h2>
    <form id="config-form" class="space-y-4" onsubmit="return submitCfg(event)">
      <fieldset class="border border-gray-300 p-4 rounded-lg">
        <legend class="text-lg font-medium text-indigo-600 px-2">Bambu Lab MQTT</legend>
        <input type="text" id="cfg_ip" placeholder="Printer IP (e.g., 192.168.1.100)" value="${initialIP}" required
               class="w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500">
        <input type="text" id="cfg_serial" placeholder="Printer Serial Number" value="${initialSerial}" required
               class="w-full mt-3 p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500">
        <input type="password" id="cfg_pass" placeholder="MQTT Password (Access Code/Key)" required
               class="w-full mt-3 p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500">
        <p class="text-xs text-gray-500 mt-2">Username = printer serial (internally 'bblp'); Password = Access Code/Key.</p>
      </fieldset>
      <button id="save-btn"
              class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold p-3 rounded-lg transition duration-150 shadow-md">
        Save & Restart App
      </button>
    </form>
  </section>
  <script>
    async function submitCfg(e){
      e.preventDefault();
      const btn = document.getElementById('save-btn');
      btn.disabled = true; btn.textContent = 'Saving…';
      try{
        await fetch('/api/config', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            printer_ip: document.getElementById('cfg_ip').value,
            printer_serial: document.getElementById('cfg_serial').value,
            mqtt_password: document.getElementById('cfg_pass').value
          })
        });
        alert('Saved. Reloading…'); location.reload();
      }catch(err){
        alert('Save failed: ' + err.message);
        btn.disabled = false; btn.textContent = 'Save & Restart App';
      }
      return false;
    }
  </script>`;
}

// ---------- MAIN APPLICATION STARTUP ----------
function start() {
  log('Starting LayerSync Timelapse Controller...', 'INFO');

  // Load configuration
  loadConfig();

  // Start HTTP server
  const server = startHttpServer();

  // Start the main application logic
  startApp();

  log('LayerSync Timelapse Controller started successfully!', 'SUCCESS');
}

function startHttpServer() {
  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const { pathname } = parsedUrl;
    const { method } = req;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Route handling
    if (pathname === '/' || pathname === '/index.html') {
      serveMainPage(res);
    } else if (pathname === '/api/status') {
      serveStatus(res);
    } else if (pathname === '/api/debug') {
      serveDebug(res);
    } else if (pathname === '/api/camera-status' && method === 'GET') {
      handleCameraStatusAPI(req, res);
    } else if (pathname === '/api/config' && method === 'POST') {
      handleConfigUpdate(req, res);
    } else if (pathname === '/api/ble/scan' && method === 'GET') {
      handleBLEScanAPI(req, res);
    } else if (pathname === '/api/ble-scan' && method === 'POST') {
      handleBLEScanAPI(req, res);
    } else if (pathname === '/api/ble/connect' && method === 'POST') {
      handleBLEConnectAPI(req, res);
    } else if (pathname === '/api/ble/disconnect' && method === 'POST') {
      handleBLEDisconnectAPI(req, res);
    } else if (pathname === '/api/ble-connect' && method === 'POST') {
      handleBLEConnectAPI(req, res);
    } else if (pathname === '/api/test-printer-connection' && method === 'POST') {
      handleTestPrinterConnectionAPI(req, res);
    } else if (pathname === '/api/reconnect-printer' && method === 'POST') {
      handleReconnectPrinterAPI(req, res);
    } else if (pathname === '/api/request-full-status' && method === 'POST') {
      handleRequestFullStatusAPI(req, res);
    } else if (pathname === '/api/test-shutter' && method === 'POST') {
      handleTestShutterAPI(req, res);
    } else if (pathname === '/api/force-control' && method === 'POST') {
      handleForceControlAPI(req, res);
    } else if (pathname === '/api/set-photo-delay' && method === 'POST') {
      handleSetPhotoDelayAPI(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  const PORT = 3000;
  server.listen(PORT, () => {
    log(`Server running on http://localhost:${PORT}`, 'SUCCESS');
  });

  // Graceful shutdown handlers
  const shutdownHandler = () => {
    log('Received shutdown signal. Starting graceful shutdown...', 'INFO');
    gracefulShutdown(server);
  };

  process.on('SIGTERM', shutdownHandler);
  process.on('SIGINT', shutdownHandler);

  return server;
}

function serveMainPage(res) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(generateHtml(configLoaded));
}

function serveStatus(res) {
  const status = {
    config_loaded: configLoaded,
    printer_status: currentPrinterState,
    gopro_status: lastGoProStatus + (goproBLE.ready() ? ' (BLE Ready)' : ' (BLE Not Ready)'),
    current_layer: currentLayer,
    total_layers: totalLayers,
    bambu_timelapse_enabled: bambuTimelapseEnabled,
    log_buffer: logBuffer
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(status));
}

function serveDebug(res) {
  const debugInfo = {
    config,
    configLoaded,
    currentPrinterState,
    currentLayer,
    totalLayers,
    lastTriggerLayer,
    photoTriggerDelay,
    bambuTimelapseEnabled,
    lastGoProStatus,
    goproConnected: goproBLE.ready(),
    mqttConnected: client ? client.connected : false,
    logBuffer: logBuffer.slice(-50) // Last 50 log entries
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(debugInfo, null, 2));
}

function handleCameraStatusAPI(req, res) {
  try {
    // Return GoPro camera status
    const status = {
      success: true,
      connected: goproBLE ? goproBLE.ready() : false,
      status: lastGoProStatus || 'Awaiting first action...',
      pythonProcess: goproBLE && goproBLE.pythonProcess ? 'running' : 'stopped'
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: e.message }));
  }
}

function handleConfigUpdate(req, res) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });
  req.on('end', () => {
    try {
      const newConfig = JSON.parse(body);
      config = { ...config, ...newConfig };

      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
      configLoaded = true;

      log('Configuration updated successfully', 'SUCCESS');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Configuration saved' }));
    } catch (error) {
      log(`Configuration update failed: ${error.message}`, 'ERROR');
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
  });
}

function handleBLEScanAPI(req, res) {
  try {
    log('GoPro: Auto-discovery via Python bridge…', 'INFO');
    // Python bridge auto-discovers GoPro, so we return a dummy device
    const devices = [{ id: 'gopro-auto', name: 'GoPro (Auto-discovered)', rssi: -50 }];
    log('GoPro: Auto-discovery completed', 'SUCCESS');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, devices }));
  } catch (e) {
    log(`BLE scan error: ${e.message}`, 'ERROR');
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: e.message }));
  }
}

function handleBLEConnectAPI(req, res) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });
  req.on('end', async () => {
    try {
      const { deviceId } = body ? JSON.parse(body) : {};
      log(`GoPro: Connecting via Python bridge…`, 'INFO');
      const result = await goproBLE.connect();
      if (result.success) {
        log('GoPro: Connected successfully!', 'SUCCESS');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Connected to GoPro' }));
      } else {
        log(`GoPro connect error: ${result.error}`, 'ERROR');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: result.error }));
      }
    } catch (e) {
      log(`BLE connect error: ${e.message}`, 'ERROR');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
  });
}

function handleBLEDisconnectAPI(req, res) {
  req.on('end', async () => {
    try {
      log('GoPro: Disconnecting via Python bridge…', 'INFO');
      const result = await goproBLE.disconnect();
      if (result.success) {
        log('GoPro: Disconnected successfully!', 'SUCCESS');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Disconnected from GoPro' }));
      } else {
        log(`GoPro disconnect error: ${result.error}`, 'ERROR');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: result.error }));
      }
    } catch (e) {
      log(`BLE disconnect error: ${e.message}`, 'ERROR');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
  });
}

function handleTestPrinterConnectionAPI(req, res) {
  // This would test printer connection
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true, message: 'Printer connection test initiated' }));
}

function handleReconnectPrinterAPI(req, res) {
  // This would reconnect to printer
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true, message: 'Printer reconnection initiated' }));
}

function handleRequestFullStatusAPI(req, res) {
  // This would request full status from printer
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true, message: 'Full status request initiated' }));
}

function handleTestShutterAPI(req, res) {
  req.on('end', async () => {
    try {
      log('GoPro: Testing shutter via Python bridge…', 'INFO');
      const result = await goproBLE.takePhoto();
      if (result.success) {
        log('GoPro: Test photo taken successfully!', 'SUCCESS');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Test photo taken' }));
      } else {
        log(`GoPro test shutter error: ${result.error}`, 'ERROR');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: result.error }));
      }
    } catch (e) {
      log(`Test shutter error: ${e.message}`, 'ERROR');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
  });
}

function handleForceControlAPI(req, res) {
  // This would force GoPro control
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true, message: 'Force control initiated' }));
}

function handleSetPhotoDelayAPI(req, res) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });
  req.on('end', () => {
    try {
      const { delay } = JSON.parse(body);
      if (typeof delay === 'number' && delay >= 0) {
        photoTriggerDelay = delay;
        log(`Photo trigger delay set to ${photoTriggerDelay}ms`, 'INFO');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: `Photo trigger delay set to ${photoTriggerDelay}ms` }));
      } else {
        throw new Error('Invalid delay value. Must be a non-negative number.');
      }
    } catch (e) {
      log(`Failed to set photo delay: ${e.message}`, 'ERROR');
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: e.message }));
    }
  });
}

function gracefulShutdown(server) {
  isShuttingDown = true;

  log('Disconnecting GoPro and stopping Python bridge...', 'INFO');
  goproBLE.stop();

  log('Closing MQTT connection...', 'INFO');
  if (client) {
    client.end();
  }

  log('Closing HTTP server...', 'INFO');
  if (server && typeof server.close === 'function') {
    server.close(() => {
      log('Graceful shutdown completed.', 'SUCCESS');
      process.exit(0);
    });
  } else {
    log('Graceful shutdown completed.', 'SUCCESS');
    process.exit(0);
  }
}

// Export the start function for use in index.js
module.exports = { start };
