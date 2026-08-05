FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
# Dev dependencies are required here: vite is the build tool.
RUN npm ci

COPY . .

# Vite inlines VITE_* variables into the bundle at BUILD time — they are not
# read from the environment at runtime. So the API URL has to be a build arg,
# and this image is specific to the environment it was built for.
#
# Default is a same-origin relative path, which is what the nginx config below
# is set up for: the browser calls /api on the site's own host and nginx
# forwards it to the backend. Override only when the API lives elsewhere:
#   docker build --build-arg VITE_API_BASE_URL=https://api.example.uz .
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build


FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 8080 rather than 80: binding it needs no privileged port, so this container
# can be run as a non-root user. TLS is terminated by the edge in front.
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/index.html || exit 1
