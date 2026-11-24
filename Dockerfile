# syntax=docker/dockerfile:1

# ---- build: compile the TypeScript, then keep only the production dependencies
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev


# ---- pmd: the Java linter, downloaded from its GitHub release and checked against the published digest
FROM debian:bookworm-slim AS pmd
# Keep this version in step with the one CI installs (.github/workflows/ci.yml).
ARG PMD_VERSION=7.29.0
ARG PMD_SHA256=d27177c185b837fa57f097e482d1253468aa035379c5eb2671fa0a279109b179
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip \
 && curl -fsSL -o /tmp/pmd.zip "https://github.com/pmd/pmd/releases/download/pmd_releases/${PMD_VERSION}/pmd-dist-${PMD_VERSION}-bin.zip" \
 && echo "${PMD_SHA256}  /tmp/pmd.zip" | sha256sum -c - \
 && unzip -q /tmp/pmd.zip -d /opt \
 && mv "/opt/pmd-bin-${PMD_VERSION}" /opt/pmd


# ---- runtime: Node, the compiled code, Ruff, and PMD with a Java runtime, running as a normal user
FROM node:22-bookworm-slim

# Ruff is one static binary, so it is copied from its official image: no Python is installed.
# Keep this version in step with the one CI installs (.github/workflows/ci.yml).
COPY --from=ghcr.io/astral-sh/ruff:0.17.0 /ruff /usr/local/bin/ruff

# PMD needs Java. The runtime is copied from the official Eclipse Temurin image instead of installed.
COPY --from=eclipse-temurin:21-jre /opt/java/openjdk /opt/java/openjdk
COPY --from=pmd /opt/pmd /opt/pmd

ENV NODE_ENV=production \
    PORT=4000 \
    RUFF_BIN=/usr/local/bin/ruff \
    JAVA_HOME=/opt/java/openjdk \
    PATH=/opt/java/openjdk/bin:$PATH \
    PMD_BIN=/opt/pmd/bin/pmd \
    LOG_TO_FILE=false \
    LOG_FORMAT=json

WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 4000

# Ready means Ruff and PMD run and, when the LLM is on, Ollama has the model (see GET /ready).
# 15 s: the PMD check starts Java.
HEALTHCHECK --interval=30s --timeout=15s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `node` is started directly (not through npm) so it receives SIGTERM and can finish running reviews.
CMD ["node", "dist/server.js"]