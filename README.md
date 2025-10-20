# 🎯 Bambu GoPro Timelapse Controller

A Python + JavaScript hybrid application that automatically triggers GoPro
photos during 3D printing based on layer changes from your Bambu Lab printer.

## ✨ Features

- **🖨️ Bambu Lab Integration**: MQTT connection to your printer
- **📸 GoPro Control**: BLE connection using official GoPro Open SDK
- **🌐 Web Interface**: Real-time status and manual controls
- **🔄 Auto Layer Detection**: Automatic photo triggers on layer changes
- **📊 Live Status**: Real-time camera and printer status monitoring
- **🎛️ Manual Controls**: Test shutter, force control, and more

## 🚀 Quick Start

### Option 1: One-Command Setup

```bash
make run
```

### Option 2: Interactive Setup

```bash
./startup.sh
```

### Option 3: Manual Setup

```bash
make install    # Install Node.js dependencies
make setup      # Setup Python environment
make start      # Start the application
```

## 📋 Prerequisites

- **Node.js** (v14 or higher)
- **Python 3** (v3.8 or higher)
- **Make** (for easy commands)
- **GoPro Camera** (HERO9 or newer)
- **Bambu Lab Printer** (with MQTT enabled)

## 🎛️ Available Commands

| Command       | Description              |
| ------------- | ------------------------ |
| `make run`    | Complete setup and start |
| `make start`  | Start application        |
| `make stop`   | Stop application         |
| `make test`   | Test GoPro connection    |
| `make status` | Check application status |
| `make clean`  | Clean up dependencies    |
| `make help`   | Show detailed help       |

## 🌐 Web Interface

Once running, open your browser to:

- **Main Interface**: http://localhost:3000
- **API Endpoints**: http://localhost:3000/api/\*

## 🔧 Configuration

### Printer Setup

1. Enable MQTT on your Bambu Lab printer
2. Note your printer's IP address
3. Configure in the web interface

### GoPro Setup

1. Turn on your GoPro
2. Ensure BLE is enabled
3. The app will auto-discover and connect

## 📁 Project Structure

```
bambu_gopro/
├── Makefile                 # Build and run commands
├── startup.sh              # Interactive startup script
├── timelapse_controller.js # Main JavaScript application
├── goproPythonBridge.js   # JavaScript wrapper for Python
├── gopro_python_bridge.py # Python bridge using GoPro SDK
├── requirements.txt        # Python dependencies
├── package.json           # Node.js dependencies
└── README.md              # This file
```

## 🔍 Troubleshooting

### GoPro Connection Issues

```bash
make test  # Test GoPro connection
```

### Check Application Status

```bash
make status  # Check all components
```

### Clean Restart

```bash
make clean   # Remove all dependencies
make run     # Fresh setup and start
```

### Common Issues

1. **"GoPro not found"**
   - Ensure GoPro is on and BLE is enabled
   - Try restarting the GoPro
   - Check if another app is connected

2. **"Printer not connected"**
   - Verify printer IP address
   - Check MQTT is enabled on printer
   - Ensure network connectivity

3. **"Python dependencies missing"**
   - Run `make setup` to reinstall
   - Check Python 3 is installed

## 🛠️ Development

### Adding New Features

1. Modify `timelapse_controller.js` for UI/logic changes
2. Modify `gopro_python_bridge.py` for GoPro control changes
3. Test with `make test`

### Debugging

```bash
make status    # Check component status
make test      # Test GoPro connection
tail -f *.log  # View logs
```

## 📊 API Endpoints

- `GET /api/ble/scan` - Scan for GoPro devices
- `POST /api/ble/connect` - Connect to GoPro
- `POST /api/test-shutter` - Test photo capture
- `GET /api/printer/status` - Get printer status

## 🔒 Security Notes

- The application runs locally on your network
- No external data transmission
- GoPro connection is BLE-only (no WiFi)
- Printer communication via local MQTT

## 📝 License

This project is for personal use with your own GoPro and Bambu Lab printer.

## 🤝 Support

For issues:

1. Check `make status` for component health
2. Run `make test` to verify GoPro connection
3. Check logs for error messages
4. Ensure all prerequisites are installed

---

**Happy Printing! 📸🖨️**
