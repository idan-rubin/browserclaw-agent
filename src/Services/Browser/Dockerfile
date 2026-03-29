# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim

# Install Chrome + display + VNC dependencies
# BuildKit cache mounts keep downloaded packages across builds — ~10s on cache hit vs ~120s cold
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    xvfb \
    x11vnc \
    fluxbox \
    novnc \
    websockify \
    supervisor \
    fonts-liberation \
    fonts-noto-color-emoji \
    && mkdir -p /var/log/supervisor

ENV CHROME_PATH=/usr/bin/chromium
ENV DISPLAY=:99
ENV BROWSER_HEADLESS=false
ENV DISPLAY_WIDTH=1920
ENV DISPLAY_HEIGHT=1080

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Remove devDependencies after build
RUN npm prune --omit=dev

COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh

RUN groupadd -r browser && useradd -r -g browser -G audio,video browser \
    && chown -R browser:browser /var/log/supervisor /var/run /app

USER browser

EXPOSE 5040
EXPOSE 6080

ENTRYPOINT ["/docker-entrypoint.sh"]
