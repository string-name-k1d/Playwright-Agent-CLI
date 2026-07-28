#!/bin/bash

# Start Xvfb
Xvfb :99 -screen 0 1280x1024x24 &>/tmp/xvfb.log &
XVFB_PID=$!
sleep 2

# Start x11vnc (no password, shared display)
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 &>/tmp/x11vnc.log &
VNC_PID=$!
sleep 1

# Start noVNC web client via websockify
websockify --web /usr/share/novnc 6080 localhost:5900 &>/tmp/websockify.log &
NOVNC_PID=$!
sleep 2

echo "Xvfb PID: $XVFB_PID, x11vnc PID: $VNC_PID, websockify PID: $NOVNC_PID"
echo "websockify log:"
cat /tmp/websockify.log
echo ""
echo "============================================="
echo "  Open http://localhost:6080/vnc.html"
echo "  to see the guided browsing session."
echo "============================================="

# Keep container running
tail -f /dev/null
