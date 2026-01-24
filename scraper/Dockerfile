ARG BUILD_FROM=node:20-bookworm-slim
FROM ${BUILD_FROM}

ENV LANG C.UTF-8

# Install Chromium and helper packages for Puppeteer plus jq for option parsing
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    jq \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy the package.json and package-lock.json files to the container
COPY package*.json ./

# Install dependencies (including Puppeteer)
RUN npm install --omit=dev

# Add Puppeteer environment variables to ensure it uses the installed Chromium
ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium"
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV SCRIPTS_DIR="/config/scripts"
ENV PORT=3000


# Copy the rest of your application files
COPY . .

# Copy the Home Assistant startup script
COPY run.sh /run.sh
RUN chmod a+x /run.sh

# Expose the port that your Express app will use (default is 3000)
EXPOSE 3000

# Set up a start command (replace index.mjs with your entry point)
CMD ["/run.sh"]
