FROM python:3.11-slim

WORKDIR /app

# ffmpeg/ffprobe: used by app/video_optimize.py after each video upload.
# tesseract-ocr (English): reads the words and numbers on screen to tell look-alike recordings apart (scan_fp.confirm_recording);
# without it that check falls back to comparing pictures only.
# fonts-dejavu-core: the font for the mark burned into downloaded videos (app/watermark.py).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first, separately from the app code, so editing a
# route or model doesn't bust this layer and trigger a full reinstall.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Optional speech check for scans (app/scan_speech.py): a small speech recogniser compares what is SAID in a recording
# with the original, to tell two reviews filmed in one room apart. The "tiny" model (~75 MB) is baked into the image so
# nothing is downloaded at run time. If this step fails the build still succeeds and the check simply stays off.
# Set SCAN_SPEECH=0 to switch it off, or delete this block to keep the image small.
COPY requirements-speech.txt .
RUN (pip install --no-cache-dir -r requirements-speech.txt \
     && python -c "from faster_whisper import WhisperModel; WhisperModel('tiny', device='cpu', compute_type='int8')") \
    || echo "speech check not installed"

COPY . .

EXPOSE 8000

# Invoked via `sh` rather than executed directly, since docker-compose's
# dev volume mount (see docker-compose.yml) replaces this file with the
# host copy at runtime — no guarantee that copy is marked executable.
ENTRYPOINT ["sh", "entrypoint.sh"]
