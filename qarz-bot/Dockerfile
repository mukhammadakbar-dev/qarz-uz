FROM node:22-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev


FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

USER node

# Only bound in webhook mode (USE_WEBHOOK=true); long polling opens no port.
EXPOSE 3001

# No HEALTHCHECK: in the default long-polling mode the bot listens on nothing,
# so there is no endpoint to probe. Liveness comes from the process exiting —
# index.js calls process.exit(1) when polling stops with an error, and the
# restart policy takes it from there.

# --import loads Sentry before any application module. With no SENTRY_DSN set,
# instrument.js does nothing.
CMD ["node", "--import", "./src/instrument.js", "--dns-result-order=ipv4first", "src/index.js"]
