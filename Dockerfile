# Use a base image that supports ARM architecture
FROM arm64v8/node:18-bullseye-slim

# Install necessary packages for Chromium
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    gnupg \
    ca-certificates \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Install Chromium (this will ensure it's compatible with Puppeteer)
RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy the package.json and package-lock.json files to the container
COPY package*.json ./

# Install dependencies (including Puppeteer)
RUN npm install

# Add Puppeteer environment variables to ensure it uses the installed Chromium
ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium"
ENV PUPPETEER_SKIP_DOWNLOAD=true


# Copy the rest of your application files
COPY . .

# Expose the port that your Express app will use (default is 3000)
EXPOSE 3000

# Set up a start command (replace index.mjs with your entry point)
CMD ["node", "index.mjs"]