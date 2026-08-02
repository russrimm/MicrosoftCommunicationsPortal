# Pinned to the Node 24 major line on Alpine; bump deliberately. Note this
# tag floats at the minor/patch level (mutable) — for byte-for-byte
# reproducible builds, pin FROM to an immutable digest instead, e.g.
# `node:24-alpine@sha256:<digest>` (see
# https://docs.docker.com/build/building/best-practices/#pin-base-image-versions).
FROM node:24-alpine

ENV NODE_ENV=production
# 0.0.0.0 here is scoped to the container's network namespace; actual exposure
# is controlled by how the port is published (-p 127.0.0.1:3000:3000 vs
# -p 3000:3000) or by the platform ingress (App Service / ACA). Only expose
# this container publicly behind an authenticated reverse proxy.
ENV HOST=0.0.0.0
# IMPORTANT: When deploying outside Azure App Service (which uses Easy Auth),
# you MUST set AUTH_MODE explicitly and supply matching credentials.
#
#   AUTH_MODE=easyauth           — App Service Easy Auth (auto-inferred there)
#   AUTH_MODE=reverse-proxy      — requires API_AUTH_TOKEN set to a strong secret
#   AUTH_MODE=none-loopback-only — only when HOST=127.0.0.1/::1 (local dev)
#
# The server refuses to start if AUTH_MODE is unset, HOST is non-loopback, and
# WEBSITE_INSTANCE_ID is not present. Additionally, binding to a non-loopback
# HOST requires ALLOW_REMOTE_BIND=true (defense in depth against accidents).
# ENV AUTH_MODE=reverse-proxy
# ENV API_AUTH_TOKEN=change-me-to-a-long-random-secret
# ENV ALLOW_REMOTE_BIND=true

RUN mkdir -p /app && chown node:node /app
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
# --ignore-scripts blocks arbitrary install/postinstall scripts from prod
# dependencies (supply-chain hardening; see
# https://docs.npmjs.com/cli/v10/commands/npm-ci#ignore-scripts). Safe here:
# the only production dependency (dotenv) ships no install scripts.
RUN npm ci --omit=dev --ignore-scripts

COPY --chown=node:node . .

USER node

EXPOSE 3000

HEALTHCHECK --interval=2s --timeout=2s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/readyz || exit 1

CMD ["node", "server.js"]
