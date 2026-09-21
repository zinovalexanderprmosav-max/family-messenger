# syntax=docker/dockerfile:1.7
FROM node:22.16.0-alpine AS build
WORKDIR /app
COPY package.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/android-shell/package.json apps/android-shell/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN npm install --no-audit --no-fund
COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm run build -w apps/web

FROM node:22.16.0-alpine AS runtime
COPY --from=caddy:2.10.2-alpine /usr/bin/caddy /usr/bin/caddy
RUN apk add --no-cache libcap \
    && setcap -r /usr/bin/caddy \
    && apk del libcap
WORKDIR /app
COPY --from=build /app /app
COPY Render.Caddyfile /etc/caddy/Caddyfile
ENV NODE_ENV=production
ENV APP_VERSION=0.3.8-rc1
ENV HOST=0.0.0.0
EXPOSE 10000
CMD ["sh","-c","PORT=8787 npm run start -w apps/server & exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"]
