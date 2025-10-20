/**
 * timelapse_controller.js
 *
 * Run: node timelapse_controller.js
 * Deps: npm i @abandonware/noble mqtt
 */

const http = require('http');
const fs = require('fs');
const url = require('url');
const mqtt = require('mqtt');

// --- GoPro Controller (Python Bridge) ---
const GoProPythonBridge = require('./goproPythonBridge');
const goproBLE = new GoProPythonBridge();

// --- GLOBALS / STATE ---
const CONFIG_FILE = 'config.json';

let config = {};
let configLoaded = false;

let client = null;

let currentPrinterState = 'Initializing MQTT...';
let logBuffer = [];
let lastGoProStatus = 'Awaiting first action...';

let totalLayers = 0;
let currentLayer = 0;
let lastTriggerLayer = -1;

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
  console.log(color + line + '\x1b[0m');
  logBuffer.push(line);
  if (logBuffer.length > 400) logBuffer.shift();
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
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const safe = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config = { ...safe };
    if (!config.mqtt_username) config.mqtt_username = config.printer_serial;
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
    if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
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

    // Check camera status before attempting photo
    const status = await goproBLE.getCameraStatus();
    if (status.busy !== null && status.encoding !== null && status.ready !== null) {
      log(`Camera status: busy=${status.busy}, encoding=${status.encoding}, ready=${status.ready}`, 'INFO');
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
let stateStabilityThreshold = 5000; // 5 seconds

// Timelapse detection
let bambuTimelapseEnabled = false;
let lastTimelapseCheck = 0;

async function handlePrinterStatusUpdate(payload) {
  try {
    // Handle direct payload (not nested under 'print')
    const printData = payload.print || payload;
    log(`[MQTT] Print data: ${JSON.stringify(printData)}`, 'INFO');

    // Check Bambu Lab timelapse status
    const ipcamData = printData.ipcam || {};
    const timelapseStatus = ipcamData.timelapse || 'disable';
    const wasTimelapseEnabled = bambuTimelapseEnabled;
    bambuTimelapseEnabled = timelapseStatus === 'enable';

    // Log timelapse status changes
    if (wasTimelapseEnabled !== bambuTimelapseEnabled) {
      if (bambuTimelapseEnabled) {
        log(`🎬 Bambu Lab timelapse ENABLED - GoPro will capture photos`, 'SUCCESS');
      } else {
        log(`🎬 Bambu Lab timelapse DISABLED - GoPro will not capture photos`, 'WARN');
      }
    }

    // Extract layer information with better fallbacks
    const newTotalLayers = printData.total_layer_num || printData.total_layers || printData.total_layers_num || 0;
    const newCurrentLayer = printData.layer_num || printData.current_layer || printData.layer || 0;

    // Extract state information - Bambu Lab uses different field names
    const mcState =
      printData.mc_state ||
      printData.state ||
      printData.print_state ||
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

    // Check for active print job
    if (newCurrentLayer > 0 && newTotalLayers > 0) {
      isPrinting = true;
      newState = 'PRINTING';
    } else if (gcodeState === 'FINISH' && newTotalLayers > 0) {
      isPrinting = false;
      newState = 'FINISHED';
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
        totalLayers = newTotalLayers;
        currentLayer = newCurrentLayer;
        stateChangeTime = now;

        log(`[MQTT] State changed to: ${newState} (stable for ${now - stateChangeTime}ms)`, 'INFO');
      } else {
        // State is changing too quickly, keep the old one
        log(`[MQTT] State change ignored: ${lastStableState} → ${newState} (too quick)`, 'WARN');
      }
    } else {
      // Same state, update layer data
      totalLayers = newTotalLayers;
      currentLayer = newCurrentLayer;
    }

    log(`[MQTT] Layers: ${currentLayer}/${totalLayers}, State: ${lastStableState}, Printing: ${isPrinting}`, 'INFO');

    // Only trigger photos if GoPro is connected, Bambu timelapse is enabled, and we have a stable printing state
    if (
      goproBLE.ready() &&
      bambuTimelapseEnabled &&
      lastStableState === 'PRINTING' &&
      currentLayer > 0 &&
      currentLayer !== lastTriggerLayer
    ) {
      log(
        `[Timelapse] Layer change detected: ${lastTriggerLayer} → ${currentLayer} (Bambu timelapse enabled)`,
        'SUCCESS'
      );
      await triggerGoProShutter(false);
      lastTriggerLayer = currentLayer;
    } else if (
      goproBLE.ready() &&
      !bambuTimelapseEnabled &&
      lastStableState === 'PRINTING' &&
      currentLayer > 0 &&
      currentLayer !== lastTriggerLayer
    ) {
      log(`⚠️  Layer ${currentLayer} detected but Bambu timelapse is DISABLED - skipping photo`, 'WARN');
      lastTriggerLayer = currentLayer; // Still track layer changes
    } else if (
      !goproBLE.ready() &&
      lastStableState === 'PRINTING' &&
      currentLayer > 0 &&
      currentLayer !== lastTriggerLayer
    ) {
      log(`⚠️  Layer ${currentLayer} detected but GoPro not connected - skipping photo`, 'WARN');
      lastTriggerLayer = currentLayer; // Still track layer changes
    }

    // Update display status based on stable state
    let baseStatus = '';
    switch (lastStableState) {
      case 'PRINTING':
        if (currentLayer > 0 && totalLayers > 0) {
          const percentage = ((currentLayer / totalLayers) * 100).toFixed(1);
          baseStatus = `Layer ${currentLayer} / ${totalLayers} (${percentage}%)`;
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

    log(`[MQTT] Updated status: ${currentPrinterState}`, 'INFO');
  } catch (e) {
    log(`Error processing printer payload: ${e.message}`, 'ERROR');
    log(`Payload was: ${JSON.stringify(payload)}`, 'ERROR');
  }
}

// ---------- MQTT ----------
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

  const mqttUrl = `mqtts://${printer_ip}:8883`;
  currentPrinterState = 'CONNECTED / Awaiting data';

  const options = {
    protocol: 'mqtts',
    host: printer_ip,
    port: 8883,
    username: 'bblp',
    password: mqtt_password,
    clientId: `GoProTimelapse_${printer_serial}`,
    keepalive: 60,
    reconnectPeriod: 5000,
    clean: true,
    rejectUnauthorized: false,
    connectTimeout: 30000,
    queueQoSZero: false
  };

  client = mqtt.connect(mqttUrl, options);

  client.on('connect', () => {
    log('MQTT connected.', 'SUCCESS');
    currentPrinterState = 'CONNECTED / Awaiting data';
    const topic = `device/${printer_serial}/report`;

    // Subscribe with better error handling
    try {
      client.subscribe(topic, { qos: 1 }, (err) => {
        if (!err) {
          log(`Subscribed to ${topic}`, 'SUCCESS');
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
    // Suppress MQTT errors during shutdown
    if (!isShuttingDown) {
      log(`MQTT Error: ${err.message}`, 'ERROR');
      currentPrinterState = `ERROR: MQTT Connection Failed (${err.code || err.message})`;
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
    // Don't auto-connect printer - let user control this
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
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

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
      log(`GoPro: Auto-discovery completed`, 'SUCCESS');
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
      log(`GoPro: Connecting via Python bridge…`, 'INFO');

      // Connect using Python bridge (no device ID needed - it auto-discovers)
      const result = await goproBLE.connect();

      log(`GoPro: Connected successfully`, 'SUCCESS');
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
      log(`GoPro: Disconnecting via Python bridge…`, 'INFO');

      // Disconnect using Python bridge
      const result = await goproBLE.disconnect();

      log(`GoPro: Disconnected successfully`, 'SUCCESS');
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
      if (!goproBLE.ready()) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            message: 'Camera not connected',
            status: { busy: null, encoding: null, ready: null, group: null }
          })
        );
        return;
      }

      const status = await goproBLE.getCameraStatus();

      // Determine if camera is ready based on status
      const isReady =
        status.success &&
        status.status &&
        status.status.ready === 'SYSTEM_READY' &&
        status.status.busy === 'SYSTEM_BUSY';

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
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

const PORT = 3000;
server.listen(PORT, async () => {
  log(`Server running on http://localhost:${PORT}`, 'SUCCESS');
  startApp();
});

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
<title>Bambu Timelapse → GoPro (BLE)</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  body { background:#f6f7fb; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Inter, Roboto, "Helvetica Neue", Arial; }
  .card { background:#fff; border-radius:16px; box-shadow: 0 8px 28px rgba(0,0,0,.06); }
  .pill { display:inline-block; padding:.35rem .6rem; border-radius:999px; font-size:.75rem; font-weight:600; }
  .log-box { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; white-space: pre-wrap; background:#0d0f12; color:#d8e1eb; padding:1rem; border-radius:.75rem; overflow-y:auto; height:320px; }
</style>
</head>
<body class="p-5 md:p-8">
  <div class="max-w-5xl mx-auto">
    <header class="mb-8 text-center">
      <h1 class="text-3xl md:text-4xl font-extrabold text-gray-800">Bambu Timelapse → GoPro (BLE)</h1>
      <p class="text-gray-500 mt-1">Pair once, then scan & connect. Shutter on each layer.</p>
    </header>

    <!-- BLE devices row -->
    <section class="card p-5 md:p-6 mb-6 border-t-4 border-indigo-500">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold text-indigo-700">
          <span class="mr-2">📡</span>Bluetooth Devices
        </h2>
        <span id="ble-state" class="pill bg-gray-100 text-gray-700">Idle</span>
      </div>

      <div class="flex flex-col md:flex-row gap-3">
        <select id="ble-select" class="flex-1 border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="">No devices — click Scan</option>
        </select>

        <button id="btn-scan" class="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">
          Scan
        </button>
        <button id="btn-connect" class="px-5 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold">
          Connect…
        </button>
        <button id="btn-reconnect" class="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold">
          Reconnect Printer
        </button>
      </div>

      <p class="text-xs text-gray-500 mt-3">Tip: You should see <b>all</b> nearby Bluetooth devices here. Select your GoPro by name, then press Connect.</p>
    </section>

    <!-- Status cards -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div class="card p-6 border-t-4 border-blue-500">
        <h3 class="text-lg font-semibold text-blue-700 mb-2">Printer Connection</h3>
        <p id="printer-status-text" class="text-2xl font-bold text-gray-800 break-words">DISCONNECTED</p>
        <div class="mt-4 text-sm text-gray-600 space-y-1">
          <p>IP: ${printerIPDisplay}</p>
          <p>Serial/MQTT User: ${printerSerialDisplay}</p>
          <p class="text-blue-600 font-medium">📡 Click "Reconnect Printer" to connect</p>
        </div>
      </div>

      <div class="card p-6 border-t-4 border-green-500">
        <h3 class="text-lg font-semibold text-green-700 mb-2">Layer Progress</h3>
        <p id="layer-progress-text" class="text-2xl font-bold text-gray-800">Total Layers: --</p>
        <div class="mt-4 text-sm text-gray-600">
          <p>Current Layer: <span id="current-layer-num">--</span></p>
          <p>Last Trigger: <span id="last-trigger-layer">--</span></p>
        </div>
      </div>

      <div class="card p-6 border-t-4 border-purple-500 flex flex-col">
        <div class="flex-1">
          <h3 class="text-lg font-semibold text-purple-700 mb-2">GoPro Status (BLE)</h3>
          <p id="gopro-status-text" class="text-sm font-medium text-gray-600 break-words mb-3">Awaiting first action…</p>
        </div>
        <div class="space-y-2">
          <button id="btn-test-shutter" class="w-full px-5 py-3 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold">
            Test Shutter
          </button>
          <button id="btn-debug" class="w-full px-5 py-3 rounded-lg bg-gray-600 hover:bg-gray-700 text-white font-semibold">
            Debug Info
          </button>
        </div>
      </div>
    </div>

    <!-- Live log -->
    <section class="card p-6 mt-6">
      <h3 class="text-lg font-semibold text-gray-700 mb-3">Live Activity Log</h3>
      <div id="log-box" class="log-box">Awaiting connection…</div>
    </section>

    ${isConfigured ? '' : configurationFormHtml(initialIP, initialSerial)}
  </div>

<script>
/* ------------- helpers ------------- */
const bleSelect       = document.getElementById('ble-select');
const bleState        = document.getElementById('ble-state');
const btnScan         = document.getElementById('btn-scan');
const btnConnect      = document.getElementById('btn-connect');
const btnReconnect    = document.getElementById('btn-reconnect');
const btnTest         = document.getElementById('btn-test-shutter');
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

function setBleState(text, tone='info') {
  const cls =
    tone === 'err' ? 'bg-red-100 text-red-700' :
    tone === 'ok'  ? 'bg-green-100 text-green-700' :
    tone === 'warn'? 'bg-yellow-100 text-yellow-800' :
                     'bg-gray-100 text-gray-700';
  bleState.className = 'pill ' + cls;
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
async function reconnectPrinter() {
  try {
    console.log('Reconnect printer button clicked');

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

    // Check actual GoPro connection status
    try {
      const goproStatus = await api('/api/camera-status', { method:'GET' });
      if (goproStatus.success) {
        // GoPro is actually connected
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
  } catch (_) {}
}

/* test shutter */
async function testShutter() {
  try {
    await api('/api/test-shutter', { method:'POST' });
  } catch (e) {
    showError('Test failed: ' + e.message);
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
btnTest?.addEventListener('click', testShutter);
btnDebug?.addEventListener('click', showDebugInfo);

/* initial */
loadBleDevices();
pollStatus();
setInterval(pollStatus, 1500);
</script>
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
