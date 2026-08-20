FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2

WORKDIR /app
COPY health.mjs system-update.mjs bluemap.mjs observatory.mjs minecraft-stats.mjs server.mjs ./
COPY public ./public

USER node
EXPOSE 3001
CMD ["node", "server.mjs"]
