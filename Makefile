# Makefile for Bambu GoPro Timelapse Controller
# Run: make help to see all available commands

.PHONY: help install setup run start stop clean test status

# Default target
help:
	@echo "🎯 Bambu GoPro Timelapse Controller"
	@echo ""
	@echo "Available commands:"
	@echo "  make install    - Install Node.js dependencies"
	@echo "  make setup      - Setup Python virtual environment and dependencies"
	@echo "  make run        - Run the complete application (setup + start)"
	@echo "  make start      - Start the application (assumes setup is done)"
	@echo "  make stop       - Stop the application"
	@echo "  make test       - Test GoPro connection"
	@echo "  make status     - Check application status"
	@echo "  make clean      - Clean up virtual environment and logs"
	@echo "  make help       - Show this help message"
	@echo ""
	@echo "Quick start: make run"

# Install Node.js dependencies
install:
	@echo "📦 Installing Node.js dependencies..."
	npm install
	@echo "✅ Node.js dependencies installed"

# Setup Python virtual environment and dependencies
setup:
	@echo "🐍 Setting up Python environment..."
	@if [ ! -d "venv" ]; then \
		echo "Creating Python virtual environment..."; \
		python3 -m venv venv; \
	fi
	@echo "Installing Python dependencies..."
	@source venv/bin/activate && pip install -r requirements.txt
	@echo "✅ Python environment setup complete"

# Run the complete application (setup + start)
run: install setup start

# Start the application
start:
	@echo "🚀 Starting Bambu GoPro Timelapse Controller..."
	@echo "📱 Web UI: http://localhost:3000"
	@echo "📸 GoPro: BLE connection via Python bridge"
	@echo "🖨️  Printer: MQTT connection"
	@echo ""
	@echo "Press Ctrl+C to stop"
	@echo ""
	# Ensure no stale processes or ports are left from previous runs
	@pgrep -f "node timelapse_controller.js" >/dev/null 2>&1 && pkill -TERM -f "node timelapse_controller.js" >/dev/null 2>&1 || true
	@pgrep -f "python.*gopro_python_bridge.py" >/dev/null 2>&1 && pkill -TERM -f "python.*gopro_python_bridge.py" >/dev/null 2>&1 || true
	@lsof -ti:3000 2>/dev/null | xargs -I {} kill -TERM {} 2>/dev/null || true
	node timelapse_controller.js

# Stop the application (kill any running processes)
stop:
	@echo "🛑 Stopping application..."
	@pgrep -f "node timelapse_controller.js" >/dev/null 2>&1 && pkill -TERM -f "node timelapse_controller.js" >/dev/null 2>&1 || true
	@pgrep -f "python.*gopro_python_bridge.py" >/dev/null 2>&1 && pkill -TERM -f "python.*gopro_python_bridge.py" >/dev/null 2>&1 || true
	@lsof -ti:3000 2>/dev/null | xargs -I {} kill -TERM {} 2>/dev/null || true
	@echo "✅ Application stopped"

# Test GoPro connection
test:
	@echo "🧪 Testing GoPro connection..."
	@source venv/bin/activate && python -c "\
import asyncio; \
from gopro_python_bridge import GoProBridge; \
async def test(): \
    bridge = GoProBridge(); \
    result = await bridge.handle_command({'command': 'connect'}); \
    print('Connect:', result); \
    if result['success']: \
        status = await bridge.handle_command({'command': 'status'}); \
        print('Status:', status); \
        photo = await bridge.handle_command({'command': 'take_photo'}); \
        print('Photo:', photo); \
        await bridge.handle_command({'command': 'disconnect'}); \
    else: \
        print('❌ Connection failed'); \
asyncio.run(test())"

# Check application status
status:
	@echo "📊 Application Status:"
	@echo ""
	@echo "Node.js processes:"
	@ps aux 2>/dev/null | grep "node timelapse_controller.js" | grep -v grep || echo "  ❌ Not running"
	@echo ""
	@echo "Python processes:"
	@ps aux 2>/dev/null | grep "python.*gopro_python_bridge.py" | grep -v grep || echo "  ❌ Not running"
	@echo ""
	@echo "Web server:"
	@curl -s http://localhost:3000 > /dev/null 2>&1 && echo "  ✅ Running on http://localhost:3000" || echo "  ❌ Not accessible"
	@echo ""
	@echo "Python environment:"
	@if [ -d "venv" ]; then echo "  ✅ Virtual environment exists"; else echo "  ❌ Virtual environment missing"; fi
	@echo ""
	@echo "Dependencies:"
	@if [ -d "node_modules" ]; then echo "  ✅ Node.js dependencies installed"; else echo "  ❌ Node.js dependencies missing"; fi
	@if [ -f "venv/bin/python" ]; then echo "  ✅ Python dependencies installed"; else echo "  ❌ Python dependencies missing"; fi

# Clean up virtual environment and logs
clean:
	@echo "🧹 Cleaning up..."
	@make stop
	@rm -rf venv
	@rm -rf node_modules
	@rm -f package-lock.json
	@rm -f *.log
	@echo "✅ Cleanup complete"

# Development targets
dev-install: install setup
	@echo "🔧 Development environment ready"
	@echo "Run 'make start' to start the application"

# Production targets
prod-install: install setup
	@echo "🏭 Production environment ready"
	@echo "Run 'make start' to start the application"

# Docker targets (if needed in future)
docker-build:
	@echo "🐳 Building Docker image..."
	@echo "Docker support not implemented yet"

# Backup targets
backup:
	@echo "💾 Creating backup..."
	@tar -czf backup-$(shell date +%Y%m%d-%H%M%S).tar.gz \
		--exclude=venv \
		--exclude=node_modules \
		--exclude=*.log \
		--exclude=backup-*.tar.gz \
		.
	@echo "✅ Backup created"

# Restore from backup
restore:
	@echo "📥 Available backups:"
	@ls -la backup-*.tar.gz 2>/dev/null || echo "No backups found"
	@echo "Usage: make restore BACKUP=backup-YYYYMMDD-HHMMSS.tar.gz"

# Show logs
logs:
	@echo "📋 Recent logs:"
	@tail -f *.log 2>/dev/null || echo "No log files found"

# Update dependencies
update:
	@echo "🔄 Updating dependencies..."
	@npm update
	@source venv/bin/activate && pip install --upgrade -r requirements.txt
	@echo "✅ Dependencies updated"
