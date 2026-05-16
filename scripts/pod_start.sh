#!/usr/bin/env bash
# VoxStudio pod 1-command startup.
#
# Setup 1 lần đầu (sau khi bootstrap xong):
#   ln -sf /workspace/VoxStudio/scripts/pod_start.sh /workspace/start.sh
#
# Từ đó về sau, mỗi lần pod restart hoặc cần redeploy:
#   /workspace/start.sh
#
# Script làm các bước (tất cả idempotent — chạy lại nhiều lần OK):
#   1. cd repo
#   2. git pull master (skip nếu --no-pull)
#   3. Nếu requirements.txt đổi → pip install (track hash)
#   4. Kill uvicorn cũ
#   5. Start uvicorn mới ở background với auto-restart loop
#   6. Tail log 10 dòng cuối để confirm chạy

set -e

WS="/workspace"
REPO="$WS/VoxStudio"
VENV="$WS/.venv"
LOG="$WS/voxstudio.log"
REQ_HASH_FILE="$WS/.requirements_hash"

# ── Cache directories trên persistent /workspace ──
# Mọi HF model + torch hub + faster-whisper sẽ load từ /workspace/hf_cache
# thay vì re-download từ HuggingFace mỗi lần pod khởi động.
# Bắt buộc export TRƯỚC khi uvicorn fork — child process kế thừa env.
export HF_HOME="$WS/hf_cache"
export HUGGINGFACE_HUB_CACHE="$WS/hf_cache/hub"
export TRANSFORMERS_CACHE="$WS/hf_cache"
export TORCH_HOME="$WS/torch_cache"
mkdir -p "$HF_HOME" "$HUGGINGFACE_HUB_CACHE" "$TORCH_HOME"

NO_PULL=0
for arg in "$@"; do
    case "$arg" in
        --no-pull) NO_PULL=1 ;;
    esac
done

echo "═══════════════════════════════════════════════════════"
echo "  VoxStudio Pod Start  ($(date '+%Y-%m-%d %H:%M:%S'))"
echo "═══════════════════════════════════════════════════════"

# ── 0. System deps — ffmpeg + fonts CJK (cần cho subtitle multi-lang) ──
# Pod restart đôi khi mất system packages (container disk reset).
NEED_INSTALL=()
command -v ffprobe >/dev/null 2>&1 || NEED_INSTALL+=(ffmpeg libsndfile1 libsox-fmt-all sox)

# Fonts — Noto CJK cho Korean/Japanese/Chinese, Noto Sans general cho Latin/VN/Thai/etc
# Subtitle render sẽ ra □□□ cho Hangul/Hiragana/Han nếu thiếu Noto CJK.
if ! fc-list 2>/dev/null | grep -qi "noto sans cjk"; then
    NEED_INSTALL+=(fonts-noto-cjk fonts-noto fonts-noto-extra)
fi

if [ ${#NEED_INSTALL[@]} -gt 0 ]; then
    echo "→ System packages missing: ${NEED_INSTALL[*]}"
    apt-get update -qq
    apt-get install -y --no-install-recommends "${NEED_INSTALL[@]}"
    # Refresh fontconfig cache để libass thấy font mới ngay
    fc-cache -f 2>/dev/null || true
    echo "  ✓ System deps ready"
fi

# ── 1. Activate venv ──────────────────────────────────────────────
if [ ! -f "$VENV/bin/activate" ]; then
    echo "✗ Venv chưa có ($VENV). Chạy scripts/runpod_bootstrap.sh trước."
    exit 1
fi
source "$VENV/bin/activate"

# ── 2. Git pull (skip nếu --no-pull) ──────────────────────────────
cd "$REPO"
if [ "$NO_PULL" = "0" ]; then
    echo "→ git pull..."
    git pull --ff-only origin master || echo "  ⚠ pull fail, dùng version hiện tại"
fi

# ── 3. Pip install nếu requirements.txt đổi ───────────────────────
# Strategy "only-if-needed": pip CHỈ install/upgrade package mới hoặc
# có pin version cao hơn installed — KHÔNG re-resolve toàn bộ dep tree.
# Tránh "resolution-too-deep" khi resolver search hàng trăm version
# combinations (vd kiwisolver, numba, llvmlite, opentelemetry).
NEW_HASH=$(sha256sum "$REPO/server/requirements.txt" | cut -d' ' -f1)
OLD_HASH=$(cat "$REQ_HASH_FILE" 2>/dev/null || echo "")
if [ "$NEW_HASH" != "$OLD_HASH" ]; then
    echo "→ requirements.txt đổi → pip install (only-if-needed)..."
    cd "$REPO/server"
    if pip install --no-cache-dir --upgrade-strategy only-if-needed -r requirements.txt; then
        echo "$NEW_HASH" > "$REQ_HASH_FILE"
        echo "  ✓ Deps updated"
    else
        echo "  ⚠ pip install fail — dùng deps hiện tại, KHÔNG update hash"
        echo "  (server vẫn start được nếu deps cốt lõi đã có sẵn)"
    fi
else
    echo "→ requirements.txt OK (skip pip install)"
fi

# ── 4. Kill uvicorn cũ + clear cache batch (resume cũ vô nghĩa) ───
echo "→ Stopping old uvicorn..."
pkill -f "uvicorn app.main:app" 2>/dev/null || true
sleep 2

# ── 5. Start uvicorn ──────────────────────────────────────────────
cd "$REPO/server"
echo "→ Starting uvicorn :8000 (log → $LOG)..."

# Auto-restart wrapper — nếu uvicorn crash, restart sau 5s
nohup bash -c "
    while true; do
        python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 2>&1 | tee -a '$LOG'
        echo \"[\$(date)] uvicorn exited, restart in 5s...\" | tee -a '$LOG'
        sleep 5
    done
" > /dev/null 2>&1 &

echo "  ✓ Server bg PID: $!"
sleep 3

# ── 6. Confirm chạy ───────────────────────────────────────────────
if pgrep -f "uvicorn app.main:app" >/dev/null; then
    echo "═══════════════════════════════════════════════════════"
    echo "  ✓ Server LIVE on :8000"
    echo "  Log: tail -f $LOG"
    echo "  Stop: pkill -f uvicorn"
    echo "═══════════════════════════════════════════════════════"
else
    echo "✗ Server không khởi động. Check $LOG:"
    tail -20 "$LOG"
    exit 1
fi
