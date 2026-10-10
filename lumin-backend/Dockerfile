FROM python:3.11-slim

WORKDIR /app

# ffmpeg/ffprobe: used by app/video_optimize.py after each video upload.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first, separately from the app code, so editing a
# route or model doesn't bust this layer and trigger a full reinstall.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Invoked via `sh` rather than executed directly, since docker-compose's
# dev volume mount (see docker-compose.yml) replaces this file with the
# host copy at runtime — no guarantee that copy is marked executable.
ENTRYPOINT ["sh", "entrypoint.sh"]
