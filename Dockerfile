# syntax=docker/dockerfile:1

FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# Install only runtime dependencies. The lockfile is required for reproducible
# builds and `npm ci` fails if it is out of sync with package.json.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

EXPOSE 3000
USER node

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "app.js"]
