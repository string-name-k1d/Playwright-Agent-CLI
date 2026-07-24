FROM mcr.microsoft.com/playwright:v1.61.0-noble

# Ensure DNS works during build
# RUN echo "nameserver 8.8.8.8" > /etc/resolv.conf

WORKDIR /workspace/agent

COPY package*.json ./
RUN npm install
RUN npm install -g @playwright/cli@latest opencode-ai@latest

RUN playwright-cli install
RUN playwright-cli install --skills

COPY src/ ./src/
COPY tsconfig.json ./

RUN npm run build

CMD ["node", "dist/index.js"]
