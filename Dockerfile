# syntax=docker/dockerfile:1

# ---- build: compile the TypeScript, then keep only the production dependencies
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev


# ---- runtime: Node, the compiled code and Ruff, running as a normal user
FROM node:22-bookworm-slim

# Ruff is one static binary, so it is copied from its official image: no Python is installed.
# Keep this version in step with the one CI installs (.github/workflows/ci.yml).
COPY --from=ghcr.io/astral-sh/ruff:0.17.0 /ruff /usr/local/bin/ruff

ENV NODE_ENV=production \
    PORT=4000 \
    RUFF_BIN=/usr/local/bin/ruff \
    LOG_TO_FILE=false \
    LOG_FORMAT=json

WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 4000

# Ready means Ruff runs and, when the LLM is on, Ollama has the model (see GET /ready).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `node` is started directly (not through npm) so it receives SIGTERM and can finish running reviews.
CMD ["node", "dist/server.js"]