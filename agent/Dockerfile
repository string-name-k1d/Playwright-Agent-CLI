FROM mcr.microsoft.com/playwright:v1.61.0-noble

# Install Xvfb, x11vnc, noVNC, websockify for headed browser support in guided browsing
RUN apt-get update && apt-get install -y \
    xvfb \
    x11vnc \
    wget \
    unzip \
    novnc \
    websockify \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/agent

COPY package*.json ./
RUN npm install
RUN npm install -g @playwright/cli@latest opencode-ai@latest

RUN playwright-cli install
RUN playwright-cli install --skills

COPY src/ ./src/
COPY tsconfig.json ./

RUN npm run build

# Start Xvfb on display :99, x11vnc on port 5900, noVNC on port 6080
ENV DISPLAY=:99
ENV NOVNC_PORT=6080
ENV VNC_PORT=5900

# Copy startup script
COPY start-xvfb.sh /usr/local/bin/start-xvfb.sh
RUN chmod +x /usr/local/bin/start-xvfb.sh

CMD ["/usr/local/bin/start-xvfb.sh"]
