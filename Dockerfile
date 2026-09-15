# ---- build ----
FROM node:22-alpine AS builder
WORKDIR /app

# Deps first so a source-only change does not reinstall them.
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN yarn build

# ---- runtime ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# tini reaps zombies and forwards SIGTERM so the bot's shutdown hook runs.
RUN apk add --no-cache tini

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean

COPY --from=builder /app/dist ./dist

USER node

# No EXPOSE: the bot dials out to Discord, Gemini and portal-penny, it serves nothing.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
