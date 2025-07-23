#!/bin/bash

echo "🚀 Starting Chrome with debugging enabled..."
echo ""

# Kill any existing Chrome processes
echo "1️⃣ Closing any existing Chrome windows..."
pkill -f "Google Chrome" 2>/dev/null || true
sleep 2

# Create debug directory if it doesn't exist
DEBUG_DIR="$HOME/chrome-debug"
mkdir -p "$DEBUG_DIR"

echo "2️⃣ Starting Chrome with remote debugging..."
echo "   Debug directory: $DEBUG_DIR"
echo "   Debug port: 9222"
echo ""

# Start Chrome with debugging
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$DEBUG_DIR" \
  --disable-web-security \
  --disable-features=VizDisplayCompositor \
  --no-first-run \
  --no-default-browser-check &

echo "3️⃣ Waiting for Chrome to start..."
sleep 3

echo " Chrome is now running with debugging enabled!"
echo ""
echo "Next steps:"
echo "   1. Login to Facebook in the Chrome window that just opened"
echo "   2. Navigate to facebook.com/messages"
echo "   3. Open your specific conversation"
echo "   4. Make sure you can see the messages"
echo "   5. Run: npm start"
echo ""
echo "💡 To check if debugging is working, visit: http://localhost:9222"
