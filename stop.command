#!/bin/bash

# Personal Timezone Calendar - Stop Script
# Double-click this file in Finder to stop the server

PORT=5001

echo "=================================="
echo "Stopping Personal Timezone Calendar"
echo "=================================="
echo ""

# Find process on port 5000
PID=$(lsof -ti:$PORT 2>/dev/null)

if [ -z "$PID" ]; then
    echo "Server is not running (port $PORT is free)"
    sleep 2
    exit 0
fi

echo "Found server running (PID: $PID)"
echo "Stopping..."

# Send graceful shutdown signal
kill $PID 2>/dev/null

# Wait for it to stop
ATTEMPTS=0
while lsof -ti:$PORT > /dev/null 2>&1; do
    sleep 0.5
    ATTEMPTS=$((ATTEMPTS + 1))
    if [ $ATTEMPTS -ge 10 ]; then
        echo "Server didn't stop gracefully, forcing..."
        kill -9 $PID 2>/dev/null
        break
    fi
done

echo ""
echo "Server stopped."
sleep 2

# Close Terminal window
osascript -e 'tell application "Terminal" to close (every window whose name contains "stop.command")' &
exit 0
