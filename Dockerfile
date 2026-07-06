FROM node:20-alpine

ENV NODE_ENV=production
# 0.0.0.0 here is scoped to the container's network namespace; actual exposure
# is controlled by how the port is published (-p 127.0.0.1:3000:3000 vs
# -p 3000:3000) or by the platform ingress (App Service / ACA). Only expose
# this container publicly behind an authenticated reverse proxy.
ENV HOST=0.0.0.0
ENV ALLOW_REMOTE_BIND=true

RUN mkdir -p /app && chown node:node /app
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node . .

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/healthz || exit 1

CMD ["node", "server.js"]
