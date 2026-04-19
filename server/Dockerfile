# VoxStudio backend — CUDA 12.1 + Python 3.11
# Target: RunPod A10G / L4 / A100
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# System deps: python, ffmpeg, audio libs
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3.11-venv python3-pip \
        ffmpeg \
        libsndfile1 \
        libsox-fmt-all sox \
        git curl \
        build-essential \
    && ln -sf /usr/bin/python3.11 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy OmniVoice source for editable install (kept inside repo)
COPY ../OmniVoice-master /app/OmniVoice-master

# Python deps in layers (best cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir -e /app/OmniVoice-master

# App code
COPY . /app

# Pre-warm HF cache (optional, skipped by default; enable via BUILD_PREWARM=1)
ARG BUILD_PREWARM=0
RUN if [ "$BUILD_PREWARM" = "1" ]; then \
        python -c "from huggingface_hub import snapshot_download; \
                   snapshot_download('openai/whisper-large-v3-turbo'); \
                   snapshot_download('k2-fsa/OmniVoice')"; \
    fi

ENV DEVICE=cuda \
    USE_FASTER_WHISPER=true \
    FASTER_WHISPER_MODEL=large-v3-turbo \
    HOST=0.0.0.0 \
    PORT=8000 \
    PYTHONPATH=/app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
