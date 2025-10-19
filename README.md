# 🎬 LayerSync

<div align="center">

![LayerSync Logo](https://img.shields.io/badge/LayerSync-Automated%20Timelapse-blue?style=for-the-badge&logo=go-pro&logoColor=white)

**Professional 3D Printing Timelapse Automation**

_Seamlessly sync GoPro camera photos with Bambu Lab printer layer changes_

[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](https://github.com/emirkovacevic/layersync)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node.js-18+-green.svg)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/python-3.8+-blue.svg)](https://python.org/)

[🚀 Quick Start](#-quick-start) • [📖 Documentation](#-documentation) •
[🛠️ Development](#️-development) • [🤝 Contributing](#-contributing)

</div>

---

## ✨ Features

- 🎥 **Automated Timelapse Capture**: Automatically triggers GoPro photos on
  layer changes
- 🔗 **BLE Integration**: Seamless Bluetooth Low Energy connection with GoPro
  cameras
- 📡 **MQTT Communication**: Real-time communication with Bambu Lab printers
- ⚡ **Consistent Timing**: Advanced timing algorithms for perfect photo
  synchronization
- 🎛️ **Web Interface**: Beautiful, responsive web UI for monitoring and control
- 🔧 **Configurable Delays**: Adjustable photo trigger timing for optimal
  results
- 📊 **Real-time Status**: Live monitoring of printer and camera status
- 🛡️ **Error Handling**: Robust error handling and recovery mechanisms
- 📱 **Responsive Design**: Works on desktop, tablet, and mobile devices

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ and **npm**
- **Python** 3.8+ with **pip**
- **GoPro Camera** (Hero 9, 10, 11, 12, or newer)
- **Bambu Lab Printer** (X1, P1P, P1S, A1, or newer)
- **macOS, Linux, or Windows**

### Installation

```bash
# Clone the repository
git clone https://github.com/emirkovacevic/layersync.git
cd layersync

# Install dependencies
make install-dev

# Configure your printer settings
cp config.json.example config.json
# Edit config.json with your printer details

# Start the application
make start
```

Open your browser to `http://localhost:3000` to access the web interface.

## 📁 Project Structure

```
layersync/
├── 📄 timelapse_controller.js    # Main application controller
├── 🐍 gopro_python_bridge.py     # Python bridge for GoPro SDK
├── 🔗 goproPythonBridge.js       # JavaScript wrapper for Python bridge
├── ⚙️ config.json                # Printer configuration
├── 📦 package.json               # Node.js dependencies
├── 🐍 requirements.txt           # Python dependencies
├── 🛠️ Makefile                   # Development commands
├── 📖 README.md                 # This file
├── 🐍 venv/                      # Python virtual environment
└── 📁 node_modules/              # Node.js dependencies
```

## 🔧 Configuration

### Printer Setup

1. **Find your printer's IP address** (usually shown on the printer's screen)
2. **Get your printer's serial number** (found in Bambu Studio or printer
   settings)
3. **Enable MQTT** in Bambu Studio settings
4. **Set an MQTT password** (remember this!)

Edit `config.json`:

```json
{
  "printer_ip": "192.168.1.100",
  "printer_serial": "01S00A123456789",
  "mqtt_password": "your_mqtt_password"
}
```

### GoPro Setup

1. **Enable Bluetooth** on your GoPro
2. **Pair with your computer** (first time only)
3. **Ensure GoPro is in Photo mode**
4. **Keep GoPro powered on** during printing

## 🛠️ Development

### Makefile Commands

LayerSync includes a comprehensive Makefile for development workflows:

```bash
# Show all available commands
make help

# Installation
make install          # Install production dependencies
make install-dev      # Install all dependencies including dev tools
make setup            # Complete development environment setup

# JavaScript Development
make lint             # Run ESLint on JavaScript files
make lint-fix         # Fix ESLint issues automatically
make format           # Format code with Prettier
make format-check     # Check if code is formatted correctly

# Python Development
make python-lint      # Run Python linting tools (flake8, pylint, mypy)
make python-format    # Format Python code (black, isort)

# Application Control
make start            # Start the application
make dev              # Start development server with auto-reload
make stop             # Stop the application (Ctrl+C)

# Quality Assurance
make pre-commit       # Run all pre-commit checks
make quick-check      # Quick fix and format all code

# Cleanup
make clean            # Clean up generated files and dependencies
```

### Development Workflow

```bash
# 1. Set up development environment
make setup

# 2. Start development server
make dev

# 3. Make your changes...

# 4. Run quality checks
make pre-commit

# 5. Quick fix and format
make quick-check
```

### Code Quality Tools

**JavaScript:**

- **ESLint** - Code linting and style enforcement
- **Prettier** - Code formatting
- **VS Code Extensions** - Auto-formatting and linting

**Python:**

- **Black** - Code formatting
- **Flake8** - Linting and style checking
- **Pylint** - Advanced code analysis
- **MyPy** - Type checking
- **isort** - Import sorting

## 📖 Documentation

### API Endpoints

| Endpoint                       | Method | Description                 |
| ------------------------------ | ------ | --------------------------- |
| `/`                            | GET    | Main web interface          |
| `/api/status`                  | GET    | Get application status      |
| `/api/debug`                   | GET    | Get debug information       |
| `/api/scan-devices`            | POST   | Scan for GoPro devices      |
| `/api/connect`                 | POST   | Connect to GoPro            |
| `/api/disconnect`              | POST   | Disconnect from GoPro       |
| `/api/test-shutter`            | POST   | Test GoPro shutter          |
| `/api/reconnect-printer`       | POST   | Reconnect to printer        |
| `/api/test-printer-connection` | POST   | Test printer connection     |
| `/api/request-full-status`     | POST   | Request full printer status |
| `/api/set-photo-delay`         | POST   | Set photo trigger delay     |

### Configuration Options

| Option              | Type   | Default | Description              |
| ------------------- | ------ | ------- | ------------------------ |
| `printer_ip`        | string | -       | Printer IP address       |
| `printer_serial`    | string | -       | Printer serial number    |
| `mqtt_password`     | string | -       | MQTT password            |
| `photoTriggerDelay` | number | 800     | Photo trigger delay (ms) |

### Troubleshooting

**Common Issues:**

1. **"Connection refused: Server unavailable"**
   - Check printer IP address
   - Verify MQTT is enabled
   - Ensure MQTT password is correct

2. **"GoPro connection timeout"**
   - Ensure GoPro is powered on
   - Check Bluetooth is enabled
   - Try pairing again

3. **"Photos not triggering"**
   - Verify timelapse is enabled in Bambu Studio
   - Check GoPro is in Photo mode
   - Adjust photo trigger delay

**Debug Tools:**

- Use the **Debug Info** button in the web interface
- Check the **Live Activity Log** for real-time status
- Use the **Test Connection** buttons to verify connectivity

## 🎯 Usage

### Basic Workflow

1. **Start LayerSync**: `make start`
2. **Open web interface**: `http://localhost:3000`
3. **Connect to GoPro**: Click "Scan" → Select device → "Connect"
4. **Connect to printer**: Click "Reconnect Printer"
5. **Start printing**: Begin your print job
6. **Monitor progress**: Watch the live status updates
7. **Enjoy timelapse**: Photos are automatically captured!

### Advanced Features

**Custom Photo Timing:**

```bash
# Set custom photo delay (0-5000ms)
curl -X POST -H "Content-Type: application/json" \
  -d '{"delay": 1000}' \
  http://localhost:3000/api/set-photo-delay
```

**Manual Photo Trigger:**

- Use the "Test Shutter" button for manual photos
- Perfect for testing camera positioning

**Status Monitoring:**

- Real-time layer count and progress
- Printer state monitoring (IDLE, HEATING, PRINTING, FINISHED)
- GoPro connection status
- MQTT communication status

## 🤝 Contributing

We welcome contributions! Here's how to get started:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes**
4. **Run quality checks**: `make pre-commit`
5. **Commit your changes**: `git commit -m 'Add amazing feature'`
6. **Push to the branch**: `git push origin feature/amazing-feature`
7. **Open a Pull Request**

### Development Guidelines

- Follow the existing code style
- Add tests for new features
- Update documentation as needed
- Use meaningful commit messages
- Run `make pre-commit` before submitting

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file
for details.

## 👤 Author

**Vimurai**

- 🌐 **GitHub**: [@vimurai](https://github.com/Vimurai)
- 📧 **Email**: emir@example.com
- 💼 **LinkedIn**: [emirkovacevic](https://www.linkedin.com/in/emirtech/)

## 🆘 Support

Need help? Here's how to get support:

1. **📖 Check the documentation** above
2. **🔍 Search existing issues** on
   [GitHub](https://github.com/emirkovacevic/layersync/issues)
3. **🐛 Report bugs** with detailed information
4. **💡 Request features** with use cases
5. **📧 Contact the author** for direct support

## ☕️ Support / Buy Me a Coffee

If you find **LayerSync** useful, you can help me by buying me a coffee. Your
support keeps me caffeinated—and keeps this project alive! 🙏💛

<a href="https://www.buymeacoffee.com/emirkovace3" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"
       alt="Buy Me A Coffee"
       style="height: 60px !important; width: 217px !important;" />
</a>

## 🙏 Acknowledgments

- **GoPro** for the excellent SDK and camera hardware
- **Bambu Lab** for innovative 3D printing technology
- **Open source community** for the amazing tools and libraries
- **Contributors** who help improve LayerSync

---

<div align="center">

**Made with ❤️ for the 3D printing community**

[⭐ Star this project](https://github.com/emirkovacevic/layersync) •
[🐛 Report issues](https://github.com/emirkovacevic/layersync/issues) •
[💡 Request features](https://github.com/emirkovacevic/layersync/issues)

</div>
