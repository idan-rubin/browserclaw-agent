# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm

# Install Chrome + display + VNC dependencies. Mirrors the Browser service Dockerfile
# so the VNC/Xvfb stack behaves identically across both sides of the comparison.
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
ENV DISPLAY_WIDTH=1920
ENV DISPLAY_HEIGHT=1080
ENV PORT=5041

WORKDIR /app

COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r requirements.txt

COPY server.py codex_responses_chat.py ./
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

RUN groupadd -r browser && useradd -r -g browser -G audio,video -m browser \
    && chown -R browser:browser /var/log/supervisor /var/run /app

USER browser

EXPOSE 5041
EXPOSE 6080

ENTRYPOINT ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
