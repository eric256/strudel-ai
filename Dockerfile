FROM node:26-alpine

RUN apk add --no-cache openssl
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server.js prompt.js ./
COPY public ./public
# writable dirs for the non-root user: shared songs + (optional) self-signed certs
RUN mkdir -p /app/data/shares /app/certs && chown -R node:node /app/data /app/certs

ENV NODE_ENV=production \
    PORT=3000 \
    HTTPS_PORT=3443 \
    CERT_DIR=/app/certs \
    DATA_DIR=/app/data

EXPOSE 3000 3443
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
USER node
CMD ["node", "server.js"]
