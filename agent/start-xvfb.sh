#!/bin/bash
set -e

# Clear stale lock files if container restarted abruptly
rm -f /tmp/.X99-lock

# Kill any stale websockify processes from previous runs
fuser -k 6080/tcp 2>/dev/null || true
fuser -k 5900/tcp 2>/dev/null || true

# Start dbus for Chrome/Chromium (required for headed mode in containers)
echo "Starting dbus..."
service dbus start 2>/dev/null || true

echo "Starting Xvfb on display :99..."
Xvfb :99 -screen 0 1280x1024x24 &>/tmp/xvfb.log &
XVFB_PID=$!

# Wait until Xvfb server is actually listening on display :99
echo "Waiting for Xvfb display socket..."
while [ ! -e /tmp/.X11-unix/X99 ]; do
    sleep 0.2
done
echo "Xvfb started successfully."

echo "Starting x11vnc..."
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 &>/tmp/x11vnc.log &
VNC_PID=$!

echo "Starting noVNC (websockify)..."
websockify --web /usr/share/novnc 6080 localhost:5900 &>/tmp/websockify.log &
NOVNC_PID=$!
sleep 1

echo "=========================================================="
echo "  noVNC GUI is ready at http://localhost:6080/vnc.html"
echo "=========================================================="

# Graceful cleanup when stopping container
cleanup() {
  echo "Shutting down display services..."
  kill $NOVNC_PID $VNC_PID $XVFB_PID 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# If arguments were passed to the script, execute them as a command
if [ "$#" -gt 0 ]; then
  exec "$@"
else
  tail -f /dev/null
fi
