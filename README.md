# LayerSync

**LayerSync** is an automated timelapse capture system that synchronizes GoPro
camera photos with Bambu Lab 3D printer layer changes. It provides seamless
integration between your printer and camera for professional-quality timelapse
videos.

## 🚀 Quick Start

```bash
# Install dependencies
npm install
pip install -r requirements.txt

# Start the application
npm start
```

Open your browser to `http://localhost:3000` to access the web interface.

## 📁 Project Structure

```
layersync/
├── src/                    # Source code
│   ├── controllers/        # Main application controllers
│   ├── services/          # Business logic services
│   ├── utils/             # Utility functions
│   └── views/             # HTML templates and UI
├── python/                # Python bridge for GoPro
├── config/                # Configuration files
├── docs/                  # Documentation
├── scripts/               # Startup and utility scripts
└── index.js               # Main entry point
```

## 🔧 Configuration

1. **Printer Setup**: Configure your Bambu Lab printer's IP address, serial
   number, and MQTT password
2. **GoPro Connection**: Connect your GoPro camera via Bluetooth
3. **Timelapse Settings**: Enable timelapse in Bambu Studio

## 📖 Documentation

- [Full Documentation](docs/README.md)
- [Changelog](docs/CHANGELOG.md)
- [API Reference](docs/API.md)

## 🛠️ Development

```bash
# Install development dependencies
npm install

# Run in development mode
npm run dev

# Lint code
npm run lint

# Format code
npm run format
```

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 👤 Author

**Emir Kovacevic**

- GitHub: [@emirkovacevic](https://github.com/emirkovacevic)
- Email: emir@example.com

## 🆘 Support

For issues and questions:

1. Check the [troubleshooting guide](docs/README.md#troubleshooting)
2. Use the built-in diagnostic tools
3. Open an issue on [GitHub](https://github.com/emirkovacevic/layersync/issues)
4. Contact the author for direct support
