#!/usr/bin/env bash
# Pre-warm tất cả AI model về /workspace/hf_cache (persistent volume).
#
# Sau khi chạy 1 lần, mọi pod restart sẽ:
#   • KHÔNG re-download model (lưu trên Network Volume)
#   • Server start nhanh hơn (model load thẳng từ disk local)
#   • Dub job đầu tiên không phải đợi download
#
# Tổng dung lượng ~15-25 GB (~17 GB với Qwen, ~14 GB không Qwen).
# Lần đầu mất 15-30 phút tuỳ tốc độ mạng + license.
# Idempotent — chạy lại bỏ qua model đã tải.
#
# Usage:
#   /workspace/VoxStudio/scripts/pod_prewarm_models.sh           # essentials
#   /workspace/VoxStudio/scripts/pod_prewarm_models.sh --with-qwen  # +Qwen 7B
#
# Required env:
#   HF_TOKEN — HuggingFace token cho pyannote (gated model)
#   Lấy tại: https://huggingface.co/settings/tokens
#   Accept license: https://hf.co/pyannote/speaker-diarization-3.1

set -e

WS="/workspace"
HF_DIR="$WS/hf_cache"
TORCH_DIR="$WS/torch_cache"
VENV="$WS/.venv"

WITH_QWEN=0
for arg in "$@"; do
    case "$arg" in
        --with-qwen) WITH_QWEN=1 ;;
        -h|--help)
            grep '^#' "$0" | sed 's/^# //' | sed 's/^#//'
            exit 0 ;;
    esac
done

# Đọc HF_TOKEN từ env hoặc .env
if [ -z "$HF_TOKEN" ]; then
    if [ -f "$WS/VoxStudio/server/.env" ]; then
        HF_TOKEN=$(grep "^HF_TOKEN=" "$WS/VoxStudio/server/.env" | cut -d= -f2-)
    fi
fi

if [ -z "$HF_TOKEN" ]; then
    echo "✗ HF_TOKEN chưa set. Pyannote diarization là gated model — cần token."
    echo "  1. Lấy token: https://huggingface.co/settings/tokens"
    echo "  2. Accept license: https://hf.co/pyannote/speaker-diarization-3.1"
    echo "  3. Chạy: HF_TOKEN=hf_xxx $0"
    exit 1
fi

export HF_TOKEN
export HF_HOME="$HF_DIR"
export HUGGINGFACE_HUB_CACHE="$HF_DIR/hub"
export TRANSFORMERS_CACHE="$HF_DIR"
export TORCH_HOME="$TORCH_DIR"
mkdir -p "$HF_DIR" "$HUGGINGFACE_HUB_CACHE" "$TORCH_DIR"

source "$VENV/bin/activate"

echo "═══════════════════════════════════════════════════════"
echo "  Pre-warm models → $HF_DIR"
echo "  Token: ${HF_TOKEN:0:8}..."
echo "  With Qwen LLM: $([ $WITH_QWEN -eq 1 ] && echo YES || echo no)"
echo "═══════════════════════════════════════════════════════"

# ── Disk space check trước khi download ──
AVAILABLE_GB=$(df -BG "$WS" | awk 'NR==2 {gsub("G",""); print $4}')
NEEDED_GB=20
[ $WITH_QWEN -eq 1 ] && NEEDED_GB=35
if [ "$AVAILABLE_GB" -lt "$NEEDED_GB" ]; then
    echo "⚠ Còn ${AVAILABLE_GB}GB trên /workspace, cần ${NEEDED_GB}GB."
    echo "  Xoá bớt file hoặc nâng volume size."
    read -p "  Tiếp tục anyway? (y/N): " confirm
    [ "$confirm" != "y" ] && exit 1
fi

# ── PART 1: HuggingFace models ──
python - <<PY
import os, sys
token = os.environ.get('HF_TOKEN')

from huggingface_hub import snapshot_download

essentials = [
    # STT — transformers format + CTranslate2 (faster-whisper)
    ('openai/whisper-large-v3-turbo',                 'Whisper transformers ~3GB'),
    ('Systran/faster-whisper-large-v3-turbo',         'Whisper CT2 format ~1.5GB'),

    # TTS — engine chính
    ('k2-fsa/OmniVoice',                              'Vox Premium TTS ~8GB'),

    # Speaker diarization (gated — cần HF_TOKEN + accept license)
    ('pyannote/speaker-diarization-3.1',              'Diarization pipeline ~50MB'),
    ('pyannote/segmentation-3.0',                     'Required by diarization ~5MB'),
    ('pyannote/embedding',                            'Speaker embedding ~17MB'),
    ('pyannote/wespeaker-voxceleb-resnet34-LM',       'WeSpeaker resnet ~25MB'),

    # WhisperX alignment cho Vietnamese (lựa chọn high-quality dub)
    ('nguyenvulebinh/wav2vec2-base-vietnamese-250h',  'WAV2VEC2 VN alignment ~360MB'),

    # WhisperX alignment cho English (fallback common)
    ('jonatasgrosman/wav2vec2-large-xlsr-53-english', 'WAV2VEC2 EN alignment ~1.2GB'),
]

failed = []
for repo, desc in essentials:
    print(f'→ {repo}  ({desc})')
    try:
        snapshot_download(repo, token=token)
        print(f'  ✓ done')
    except Exception as e:
        print(f'  ⚠ fail: {str(e)[:200]}')
        failed.append(repo)

if failed:
    print()
    print(f'⚠ {len(failed)} model fail: {failed}')
    print('  Đa số do chưa accept license hoặc HF_TOKEN không có quyền.')
    print('  Visit URL của model, click "Agree and access" rồi rerun.')
PY

# Optional: Qwen LLM cho polish path (local fallback)
if [ $WITH_QWEN -eq 1 ]; then
    python - <<'PY'
import os
from huggingface_hub import snapshot_download
print()
print('→ Qwen/Qwen2.5-7B-Instruct  (LLM polish ~14GB)')
try:
    snapshot_download('Qwen/Qwen2.5-7B-Instruct', token=os.environ.get('HF_TOKEN'))
    print('  ✓ done')
except Exception as e:
    print(f'  ⚠ fail: {str(e)[:200]}')
PY
fi

# ── PART 2: torch.hub models (Silero VAD) ──
python - <<'PY'
import os, torch

print()
print('→ Silero VAD (~5MB)')
try:
    torch.hub.load('snakers4/silero-vad', 'silero_vad',
                    force_reload=False, trust_repo=True)
    print('  ✓ done')
except Exception as e:
    print(f'  ⚠ fail: {str(e)[:200]}')
PY

# ── PART 3: Demucs (vocal separator) ──
python - <<'PY'
print()
print('→ Demucs htdemucs (vocal separator ~1GB)')
try:
    import demucs.pretrained
    demucs.pretrained.get_model('htdemucs')
    print('  ✓ done')
except Exception as e:
    print(f'  ⚠ fail: {str(e)[:200]}')
PY

# ── PART 4: Tóm tắt ──
echo
echo '═══ Pre-warm xong. Dung lượng:'
du -sh "$HF_DIR" "$TORCH_DIR" 2>/dev/null
echo "═══════════════════════════════════════════════════════"
echo "  ✓ Done. Pod restart sau này KHÔNG phải tải lại model."
echo ""
echo "  Verify env trong pod_start.sh đã export:"
echo "    HF_HOME=$HF_HOME"
echo "    HUGGINGFACE_HUB_CACHE=$HUGGINGFACE_HUB_CACHE"
echo "    TORCH_HOME=$TORCH_HOME"
echo "═══════════════════════════════════════════════════════"
