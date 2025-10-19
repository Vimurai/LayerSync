#!/usr/bin/env node

/**
 * LayerSync - Main Entry Point
 * Professional 3D Printing Timelapse Automation
 *
 * @author Emir Kovacevic
 * @version 1.0.0
 */

const path = require('path');
const TimelapseController = require('./controllers/timelapseController');

// Start the application
const controller = new TimelapseController();
controller.start();
