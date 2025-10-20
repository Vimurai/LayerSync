#!/bin/bash
# startup.sh - Simple startup script for Bambu GoPro Timelapse Controller

echo "🎯 Bambu GoPro Timelapse Controller"
echo "=================================="
echo ""

# Check if make is available
if ! command -v make &> /dev/null; then
    echo "❌ Make is not installed. Please install make first."
    echo "   On macOS: xcode-select --install"
    echo "   On Ubuntu: sudo apt-get install make"
    exit 1
fi

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3 first."
    echo "   Visit: https://python.org/"
    exit 1
fi

echo "✅ Prerequisites check passed"
echo ""

# Show help
echo "Available commands:"
echo "  make run     - Install dependencies and start the application"
echo "  make start   - Start the application (assumes setup is done)"
echo "  make test    - Test GoPro connection"
echo "  make status  - Check application status"
echo "  make stop    - Stop the application"
echo "  make clean   - Clean up and remove dependencies"
echo "  make help    - Show detailed help"
echo ""

# Ask user what to do
echo "What would you like to do?"
echo "1) Run complete setup and start (make run)"
echo "2) Just start (make start)"
echo "3) Test GoPro connection (make test)"
echo "4) Check status (make status)"
echo "5) Show help (make help)"
echo ""

read -p "Enter your choice (1-5): " choice

case $choice in
    1)
        echo "🚀 Running complete setup and starting application..."
        make run
        ;;
    2)
        echo "🚀 Starting application..."
        make start
        ;;
    3)
        echo "🧪 Testing GoPro connection..."
        make test
        ;;
    4)
        echo "📊 Checking status..."
        make status
        ;;
    5)
        echo "📖 Showing help..."
        make help
        ;;
    *)
        echo "❌ Invalid choice. Please run the script again."
        exit 1
        ;;
esac
