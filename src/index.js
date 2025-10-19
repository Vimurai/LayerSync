#!/usr/bin/env node

/**
 * LayerSync - Main Entry Point
 * Professional 3D Printing Timelapse Automation
 *
 * @author Emir Kovacevic
 * @version 1.0.0
 */

const path = require('path');
const { start } = require('./controllers/timelapse_controller');

// Start the application
start();
