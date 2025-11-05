# Minimal production image for MiroTalk WebRTC MVP
FROM node:22-alpine

# Set working directory
WORKDIR /app

ENV NODE_ENV=production

# Copy dependency manifest
COPY package.json ./

# Install runtime dependencies
RUN npm install --omit=dev --silent \
    && npm cache clean --force \
    && rm -rf /tmp/* /var/tmp/* /usr/share/doc/*

# Copy application code
COPY app ./app
COPY public ./public

# Expose port (optional; for documentation)
EXPOSE 3000

# Start server
CMD ["npm", "start"]