#!/usr/bin/env bash
# VoxStudio RunPod 1-click bootstrap.
#
# Usage:
#   1) RunPod Pod settings → Container Start Command → paste:
#         bash -c "curl -sS https://raw.githubusercontent.com/<USER>/VoxStudio/master/scripts/runpod_bootstrap.sh | bash"
#      (hoặc copy script này vào Network Volume rồi `bash /workspace/runpod_bootstrap.sh`)
#
#   2) Required env vars (set trong RunPod Pod settings → Environment Variables):
#         GIT_REPO_URL    — vd https://github.com/<USER>/VoxStudio.git
#         GIT_BRANCH      — branch cần checkout (default: master)
#         HF_TOKEN        — HuggingFace token (cần để pull pyannote)
#         JWT_SECRET      — phải match VPS để verify token
#         DATABASE_URL    — postgresql+asyncpg://... (trỏ về Postgres VPS)
#         (optional) GEMINI_API_KEY, S3_*, SENTRY_DSN, etc.
#
# Logic:
#   • Lần đầu: clone repo, pip install, pre-warm models → ~10 phút
#   • Lần sau: skip clone (đã có), skip install (sentinel file), chạy uvicorn ngay → <30s
#   • Network Volume /workspace giữ: code + HF cache + voices + audio output
#     → Pod restart không mất gì, không phải cài lại.

set -e

WS="/workspace"
REPO_DIR="$WS/VoxStudio"
HF_DIR="$WS/hf_cache"
DEPS_SENTINEL="$WS/.voxstudio_deps_installed"
MODELS_SENTINEL="$WS/.voxstudio_models_warm"

GIT_BRANCH="${GIT_BRANCH:-master}"

echo "═══════════════════════════════════════════════════════"
echo "  VoxStudio RunPod Bootstrap"
echo "  Workspace: $WS"
echo "  Branch: $GIT_BRANCH"
echo "═══════════════════════════════════════════════════════"

# ── 1) System deps (chỉ cài 1 lần per Pod lifecycle) ──────────────
if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "→ Installing ffmpeg + audio libs..."
    apt-get update -qq
    apt-get install -y --no-install-recommends \
        ffmpeg libsndfile1 libsox-fmt-all sox git curl
fi

# ── 2) Clone repo (lần đầu) hoặc pull (lần sau) ──────────────────
# Inject GITHUB_PAT vào URL nếu repo private. Format:
#   https://github.com/...  →  https://<PAT>@github.com/...
_inject_pat() {
    local url="$1"
    if [ -n "$GITHUB_PAT" ] && [[ "$url" == https://github.com/* ]]; then
        echo "${url/https:\/\/github.com\//https:\/\/${GITHUB_PAT}@github.com\/}"
    else
        echo "$url"
    fi
}

if [ ! -d "$REPO_DIR/.git" ]; then
    if [ -z "$GIT_REPO_URL" ]; then
        echo "✗ GIT_REPO_URL chưa set. Set env var rồi chạy lại."
        exit 1
    fi
    AUTH_URL=$(_inject_pat "$GIT_REPO_URL")
    echo "→ Cloning repo → $REPO_DIR (lần đầu, 1-2 phút)..."
    git clone --branch "$GIT_BRANCH" --depth 1 "$AUTH_URL" "$REPO_DIR"
else
    echo "→ Repo exists, pulling latest..."
    cd "$REPO_DIR"
    # Update remote URL với PAT (idempotent — chạy lại nhiều lần OK)
    if [ -n "$GITHUB_PAT" ]; then
        CURR_URL=$(git remote get-url origin)
        AUTH_URL=$(_inject_pat "$CURR_URL")
        [ "$CURR_URL" != "$AUTH_URL" ] && git remote set-url origin "$AUTH_URL"
    fi
    git pull --ff-only origin "$GIT_BRANCH" || echo "  ⚠ pull fail, dùng version hiện tại"
fi

cd "$REPO_DIR/server"

# ── 3) Python deps trong venv ON Network Volume ──────────────────
# Cài vào /workspace/.venv để persist qua pod destroy. Container disk
# bị xoá khi destroy → deps trong system Python sẽ mất; venv ở
# Network Volume → deps an toàn forever.
VENV_DIR="$WS/.venv"
if [ ! -f "$VENV_DIR/bin/activate" ] || [ "$1" = "--reinstall" ]; then
    echo "→ Creating venv at $VENV_DIR + installing deps (5-10 phút lần đầu)..."
    python -m venv "$VENV_DIR"
    source "$VENV_DIR/bin/activate"
    pip install --no-cache-dir --upgrade pip
    pip install --no-cache-dir -r requirements.txt
    pip install --no-cache-dir -e ../voxstudio-engine
    touch "$DEPS_SENTINEL"
    echo "  ✓ Venv ready (persistent forever via Network Volume)"
else
    echo "→ Venv exists at $VENV_DIR (skip install)."
    source "$VENV_DIR/bin/activate"
fi

# ── 4) Generate .env từ env vars Pod (auth/DB/etc) ───────────────
mkdir -p "$WS/dubbing_projects" "$WS/voices" "$WS/audio_output" "$HF_DIR"

# DATABASE_URL: nếu user chưa set (no VPS Postgres) → bỏ qua, backend
# fallback sang SQLite file. VOX_DB_PATH set ở env Pod sẽ lưu .db vào
# Network Volume, persistent qua restart.
DB_LINE=""
if [ -n "$DATABASE_URL" ]; then
    DB_LINE="DATABASE_URL=${DATABASE_URL}"
fi
DB_PATH_LINE=""
if [ -n "$VOX_DB_PATH" ]; then
    DB_PATH_LINE="VOX_DB_PATH=${VOX_DB_PATH}"
fi

cat > "$REPO_DIR/server/.env" <<EOF
$DB_LINE
$DB_PATH_LINE
WORKER_ENABLED=true
DEVICE=cuda

USE_FASTER_WHISPER=true
FASTER_WHISPER_MODEL=large-v3-turbo
TTS_MODEL=k2-fsa/OmniVoice
WHISPER_MODEL=openai/whisper-large-v3-turbo

HF_HOME=$HF_DIR
TRANSFORMERS_CACHE=$HF_DIR
HF_TOKEN=${HF_TOKEN}

HOST=0.0.0.0
PORT=8000
JWT_SECRET=${JWT_SECRET}

DUBBING_PROJECTS_DIR=$WS/dubbing_projects
VOICES_DIR=$WS/voices
AUDIO_OUTPUT_DIR=$WS/audio_output

GEMINI_API_KEY=${GEMINI_API_KEY:-}
LLM_MODEL=${LLM_MODEL:-Qwen/Qwen2.5-7B-Instruct}

S3_ENDPOINT=${S3_ENDPOINT:-}
S3_BUCKET=${S3_BUCKET:-}
S3_ACCESS_KEY=${S3_ACCESS_KEY:-}
S3_SECRET_KEY=${S3_SECRET_KEY:-}
S3_REGION=${S3_REGION:-}

SENTRY_DSN=${SENTRY_DSN:-}
EOF
echo "  ✓ .env generated"

# ── 5) Pre-warm models (lần đầu — tải Whisper + OmniVoice) ───────
export HF_HOME="$HF_DIR"
export TRANSFORMERS_CACHE="$HF_DIR"
if [ -n "$HF_TOKEN" ]; then export HF_TOKEN="$HF_TOKEN"; fi

if [ ! -f "$MODELS_SENTINEL" ]; then
    echo "→ Pre-warming HF models (15-20 phút lần đầu, lưu Network Volume forever)..."
    python -c "
from huggingface_hub import snapshot_download
import os
token = os.environ.get('HF_TOKEN')

# STT + TTS chính (cần auth HF token cho pyannote)
models = [
    'openai/whisper-large-v3-turbo',   # ~3GB — STT
    'k2-fsa/OmniVoice',                 # ~8GB — TTS premium
    'pyannote/speaker-diarization-3.1', # ~50MB — diarization
    'pyannote/segmentation-3.0',        # ~5MB — required by diarization-3.1
    'pyannote/embedding',               # ~17MB — speaker embedding
    'pyannote/wespeaker-voxceleb-resnet34-LM',  # ~25MB — used by 3.1
]
for repo in models:
    try:
        print(f'→ {repo}...')
        snapshot_download(repo, token=token)
        print(f'  ✓ {repo} cached')
    except Exception as e:
        print(f'  ⚠ {repo} fail: {e} (sẽ retry khi dùng lần đầu)')
print('✓ All HF models cached to', os.environ.get('HF_HOME'))
" && touch "$MODELS_SENTINEL"

    # Demucs (vocal separator) + Silero VAD — tự pull qua torch.hub khi
    # gọi lần đầu. Pre-warm bằng cách trigger 1 lần với dummy audio.
    echo "→ Pre-warming Demucs + Silero VAD (~2GB, 3-5 phút)..."
    python -c "
try:
    import demucs.pretrained
    demucs.pretrained.get_model('htdemucs')
    print('  ✓ Demucs htdemucs cached')
except Exception as e:
    print(f'  ⚠ Demucs fail: {e} (sẽ retry khi dùng lần đầu)')

try:
    import torch
    torch.hub.load(
        repo_or_dir='snakers4/silero-vad',
        model='silero_vad', force_reload=False, trust_repo=True,
    )
    print('  ✓ Silero VAD cached')
except Exception as e:
    print(f'  ⚠ Silero VAD fail: {e} (sẽ retry khi dùng lần đầu)')
" || echo "  ⚠ Some background models failed — sẽ tự load khi dùng"
else
    echo "→ Models OK (sentinel exists)."
fi

# ── 6) Start uvicorn — auto-restart on crash via while loop ──────
echo "═══════════════════════════════════════════════════════"
echo "  Starting uvicorn :8000 ..."
echo "═══════════════════════════════════════════════════════"
cd "$REPO_DIR/server"
while true; do
    python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 2>&1 | tee -a "$WS/voxstudio.log"
    echo "[$(date)] uvicorn exited, restart in 5s..."
    sleep 5
done
