# Debian, not Alpine: @resvg/resvg-js ships a native binary and the installed
# build is linux-x64-gnu (glibc). On musl npm would need the -musl variant, and
# a mismatch only surfaces at runtime when the first receipt is rendered.
FROM node:22-bookworm-slim AS deps

WORKDIR /app

# Copy manifests alone first, so the dependency layer is only rebuilt when they
# change — not on every source edit.
COPY package.json package-lock.json ./

# `npm ci` installs exactly the lockfile, and --omit=dev keeps pg-mem and the
# linter out of the runtime image.
RUN npm ci --omit=dev


FROM node:22-bookworm-slim AS runtime

# Fail fast and loudly on bad config, and pick the production log format.
ENV NODE_ENV=production

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# `node` (uid 1000) ships with the image. Running as root would let a code
# execution bug modify the application's own files.
USER node

EXPOSE 4000

# Liveness only: /health deliberately does not touch Postgres, because
# restarting the API cannot fix a down database. Readiness (/health/ready) is
# the load balancer's business, not the container runtime's.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so node is PID 1 and receives SIGTERM directly — server.js already
# handles it and drains in-flight requests.
CMD ["node", "--dns-result-order=ipv4first", "src/server.js"]
