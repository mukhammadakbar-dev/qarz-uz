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
# --no-network-family-autoselection: api.telegram.org publishes an AAAA record,
# and on an IPv4-only host Node's happy-eyeballs tries IPv6 first, gives up after
# its 250ms attempt window and surfaces the result as ETIMEDOUT instead of
# falling back — every Telegram call fails while curl on the same host succeeds.
# Turning it off makes Node honour --dns-result-order and dial IPv4 directly.
CMD ["node", "--import", "./src/instrument.js", "--dns-result-order=ipv4first", "--no-network-family-autoselection", "src/index.js"]
