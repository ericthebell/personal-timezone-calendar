#!/bin/bash

# Personal Timezone Calendar - Start Script
# Double-click this file in Finder to start the server

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
PORT=5001
URL="http://localhost:$PORT"

# Track PIDs for cleanup
SERVER_PID=""
TUNNEL_PID=""

# Graceful shutdown handler
cleanup() {
    echo ""
    echo "Shutting down..."
    [ -n "$SERVER_PID" ] && kill $SERVER_PID 2>/dev/null
    [ -n "$TUNNEL_PID" ] && kill $TUNNEL_PID 2>/dev/null
    # Kill any orphaned cloudflared processes
    pkill -f "cloudflared tunnel run personal-calendar" 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

echo "=================================="
echo "Personal Timezone Calendar"
echo "=================================="
echo ""

# Check if server is already running
if lsof -ti:$PORT > /dev/null 2>&1; then
    echo "Server is already running on port $PORT"
    echo "Opening browser..."
    open "$URL"
    echo ""
    echo "To stop the server, double-click stop.command"
    echo ""
    sleep 3
    exit 0
fi

# Check if backend node_modules exists
if [ ! -d "$BACKEND_DIR/node_modules" ]; then
    echo "Installing backend dependencies (first run)..."
    cd "$BACKEND_DIR"
    npm install
    echo ""
fi

# Check if frontend needs to be built or rebuilt
NEED_BUILD=false

if [ ! -d "$FRONTEND_DIR/build" ]; then
    echo "Frontend build directory missing."
    NEED_BUILD=true
elif [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo "Frontend dependencies missing."
    NEED_BUILD=true
else
    # Check if any source file is newer than the build
    # Find the newest file in src/ and compare to build/index.html
    BUILD_TIME=$(stat -f %m "$FRONTEND_DIR/build/index.html" 2>/dev/null || echo 0)
    NEWEST_SRC=$(find "$FRONTEND_DIR/src" -type f -name "*.js" -o -name "*.jsx" -o -name "*.ts" -o -name "*.tsx" -o -name "*.css" 2>/dev/null | xargs stat -f %m 2>/dev/null | sort -rn | head -1)

    if [ -n "$NEWEST_SRC" ] && [ "$NEWEST_SRC" -gt "$BUILD_TIME" ]; then
        echo "Frontend source files changed since last build."
        NEED_BUILD=true
    fi
fi

if [ "$NEED_BUILD" = true ]; then
    echo "Building frontend (takes ~30 seconds)..."
    cd "$FRONTEND_DIR"
    if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
        echo "Installing frontend dependencies..."
        npm install
    fi
    npm run build
    echo ""
fi

# Start the server
echo "Starting server..."
cd "$BACKEND_DIR"
npm start &
SERVER_PID=$!

# Wait for server to be ready
echo "Waiting for server to be ready..."
ATTEMPTS=0
MAX_ATTEMPTS=30
until curl -s "$URL/api/health" > /dev/null 2>&1; do
    sleep 0.5
    ATTEMPTS=$((ATTEMPTS + 1))
    if [ $ATTEMPTS -ge $MAX_ATTEMPTS ]; then
        echo "ERROR: Server failed to start after 15 seconds"
        echo "Check the logs above for errors"
        exit 1
    fi
done

echo ""
echo "✅ Server is running at $URL"

# Start Cloudflare tunnel if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo ""
    echo "⚠️  cloudflared not installed. External access unavailable."
    echo "   To enable external calendar subscriptions:"
    echo "   brew install cloudflared"
    echo ""
else
    echo ""
    echo "Starting Cloudflare tunnel (personal-calendar)..."

    # Set the fixed tunnel URL (using named tunnel with custom domain)
    TUNNEL_URL="https://calendar.ericthebell.com"
    curl -s -X PATCH "http://localhost:$PORT/settings" \
        -H "Content-Type: application/json" \
        -d "{\"baseUrl\": \"$TUNNEL_URL\"}" > /dev/null
    echo "✅ Tunnel URL: $TUNNEL_URL"

    # Start cloudflared using the named tunnel (filtered output for less noise)
    cloudflared tunnel run personal-calendar 2>&1 | while IFS= read -r line; do
        # Only log errors, warnings, and connection registrations
        if [[ "$line" == *"ERR"* ]] || [[ "$line" == *"WRN"* ]] || [[ "$line" == *"Registered tunnel"* ]]; then
            echo "[tunnel] $line"
        fi
    done &
    TUNNEL_PID=$!

    # Give tunnel a moment to connect
    sleep 2
fi

echo "Opening browser..."
open "$URL"

echo ""
echo "=================================="
echo "Server is running (PID: $SERVER_PID)"
if [ -n "$TUNNEL_PID" ]; then
    echo "Tunnel is running (PID: $TUNNEL_PID)"
fi
echo "To stop: double-click stop.command"
echo "Or press Ctrl+C in this window"
echo "=================================="
echo ""

# Wait for the server process (keeps Terminal open with logs)
wait $SERVER_PID
