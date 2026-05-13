#!/usr/bin/env bash
# Pre-warm tất cả HF + torch.hub model về /workspace/hf_cache.
#
# Chạy 1 lần trên pod để tải toàn bộ AI model cần cho dub (Whisper +
# OmniVoice + pyannote + Demucs + Silero VAD). Sau đó dub không cần
# download bất kỳ thứ gì → start dub gần như tức thì.
#
# Tổng ~15GB, lần đầu mất 15-25 phút tuỳ tốc độ mạng.
# Idempotent — chạy lại bỏ qua model đã tải.
#
# Usage:
#   /workspace/VoxStudio/scripts/pod_prewarm_models.sh
#
# Required env:
#   HF_TOKEN — HuggingFace token (cần để pull pyannote private)

set -e

WS="/workspace"
HF_DIR="$WS/hf_cache"
VENV="$WS/.venv"

if [ -z "$HF_TOKEN" ]; then
    # Đọc từ .env nếu có
    if [ -f "$WS/VoxStudio/server/.env" ]; then
        HF_TOKEN=$(grep "^HF_TOKEN=" "$WS/VoxStudio/server/.env" | cut -d= -f2-)
    fi
fi

if [ -z "$HF_TOKEN" ]; then
    echo "✗ HF_TOKEN chưa set. Pyannote model là private — cần token."
    echo "  Lấy tại: https://huggingface.co/settings/tokens"
    echo "  Chạy: HF_TOKEN=hf_xxx ./scripts/pod_prewarm_models.sh"
    exit 1
fi

export HF_TOKEN
export HF_HOME="$HF_DIR"
export TRANSFORMERS_CACHE="$HF_DIR"
mkdir -p "$HF_DIR"

source "$VENV/bin/activate"

echo "═══════════════════════════════════════════════════════"
echo "  Pre-warm models → $HF_DIR"
echo "  Token: ${HF_TOKEN:0:8}..."
echo "═══════════════════════════════════════════════════════"

python - <<'PY'
import os, sys
token = os.environ.get('HF_TOKEN')

from huggingface_hub import snapshot_download

models = [
    ('openai/whisper-large-v3-turbo',                'STT Whisper turbo ~3GB'),
    ('k2-fsa/OmniVoice',                              'TTS OmniVoice ~8GB'),
    ('pyannote/speaker-diarization-3.1',              'Diarization pipeline ~50MB'),
    ('pyannote/segmentation-3.0',                     'Required by diarization ~5MB'),
    ('pyannote/embedding',                            'Speaker embedding ~17MB'),
    ('pyannote/wespeaker-voxceleb-resnet34-LM',       'WeSpeaker resnet ~25MB'),
]
for repo, desc in models:
    print(f'→ {repo}  ({desc})')
    try:
        snapshot_download(repo, token=token)
        print(f'  ✓ done')
    except Exception as e:
        print(f'  ⚠ fail: {e}')

print()
print('→ Demucs htdemucs (vocal separator ~1GB)')
try:
    import demucs.pretrained
    demucs.pretrained.get_model('htdemucs')
    print('  ✓ done')
except Exception as e:
    print(f'  ⚠ fail: {e}')

print()
print('→ Silero VAD (~5MB)')
try:
    import torch
    torch.hub.load('snakers4/silero-vad', 'silero_vad',
                    force_reload=False, trust_repo=True)
    print('  ✓ done')
except Exception as e:
    print(f'  ⚠ fail: {e}')

print()
print(f'═══ Pre-warm xong. Cache size:')
PY

du -sh "$HF_DIR" 2>/dev/null || echo "(không đo được dung lượng)"
echo "═══════════════════════════════════════════════════════"
echo "  ✓ Done. Dub lần tới sẽ KHÔNG phải tải model."
echo "═══════════════════════════════════════════════════════"
