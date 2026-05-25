FROM node:20-slim

# Install system dependencies: python3, pip, and ffmpeg
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp and AES-128 HLS support used by yt-dlp's native downloader.
RUN pip3 install --break-system-packages yt-dlp pycryptodomex

# Set working directory inside the container
WORKDIR /app

# Copy package descriptors and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy remaining code files
COPY . .

# Setup persistent volume mount folders
RUN mkdir -p /data/downloads /data/sessions

# Configure runtime environment variables
ENV NODE_ENV=production
ENV PORT=7860

# Expose port for Hugging Face Spaces (default 7860)
EXPOSE 7860

# Run Express application
CMD ["node", "index.js"]
