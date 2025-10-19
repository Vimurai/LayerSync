# LayerSync - Project Structure

This document describes the organized folder structure of LayerSync.

## 📁 Directory Structure

```
layersync/
├── src/                          # Source code
│   ├── controllers/              # Application controllers
│   │   └── timelapse_controller.js
│   ├── services/                 # Business logic services
│   │   ├── goproPythonBridge.js  # GoPro Python bridge wrapper
│   │   ├── goproService.js       # GoPro camera service
│   │   ├── mqttService.js        # MQTT communication service
│   │   └── printerService.js     # Printer status service
│   ├── utils/                    # Utility modules
│   │   ├── config.js             # Configuration management
│   │   └── logger.js             # Logging utility
│   ├── views/                    # UI templates
│   │   └── htmlTemplates.js      # HTML templates
│   └── index.js                  # Main entry point
├── python/                       # Python scripts
│   └── gopro_python_bridge.py   # GoPro SDK bridge
├── config/                       # Configuration files
│   ├── config.json              # Main configuration
│   └── config.json.example      # Configuration template
├── docs/                         # Documentation
├── scripts/                      # Build and utility scripts
├── tests/                        # Test files
├── venv/                         # Python virtual environment
├── node_modules/                 # Node.js dependencies
├── package.json                  # Node.js package configuration
├── Makefile                      # Build automation
└── README.md                     # Project documentation
```

## 🏗️ Architecture Overview

### Controllers (`src/controllers/`)

- **timelapse_controller.js**: Main application controller that orchestrates all
  services

### Services (`src/services/`)

- **goproPythonBridge.js**: JavaScript wrapper for the Python GoPro SDK bridge
- **goproService.js**: High-level GoPro camera operations and status management
- **mqttService.js**: MQTT communication with Bambu Lab printers
- **printerService.js**: Printer status parsing and state management

### Utils (`src/utils/`)

- **config.js**: Configuration file loading and validation
- **logger.js**: Centralized logging with buffering and formatting

### Views (`src/views/`)

- **htmlTemplates.js**: HTML templates for the web interface

### Python (`python/`)

- **gopro_python_bridge.py**: Python script that interfaces with the GoPro SDK

### Config (`config/`)

- **config.json**: Main configuration file with printer and MQTT settings
- **config.json.example**: Template configuration file

## 🚀 Getting Started

1. **Install dependencies**:

   ```bash
   npm install
   pip install -r requirements.txt
   ```

2. **Configure the application**:

   ```bash
   cp config/config.json.example config/config.json
   # Edit config/config.json with your printer details
   ```

3. **Start the application**:
   ```bash
   npm start
   # or
   make start
   ```

## 🔧 Development

- **Development mode**: `npm run dev` or `make dev`
- **Linting**: `npm run lint` or `make lint`
- **Formatting**: `npm run format` or `make format`
- **Testing**: `npm test` or `make test`

## 📝 Key Features

- **Modular Architecture**: Clean separation of concerns
- **Service-Oriented**: Each service handles specific functionality
- **Configuration Management**: Centralized config loading and validation
- **Logging**: Structured logging with buffering
- **Error Handling**: Robust error handling throughout
- **Web Interface**: Beautiful, responsive web UI
- **Real-time Updates**: Live status monitoring and updates

## 🔄 Data Flow

1. **Configuration**: Loaded from `config/config.json`
2. **MQTT Service**: Connects to Bambu Lab printer
3. **GoPro Service**: Manages camera connection and status
4. **Printer Service**: Parses printer data and manages state
5. **Controller**: Orchestrates all services and handles web requests
6. **Web Interface**: Provides real-time status and controls

This structure ensures maintainability, scalability, and ease of development
while keeping all existing functionality intact.
