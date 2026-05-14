#!/usr/bin/env bash
# Full deps recovery — khôi phục stack Python về trạng thái ai-cũng-work.
#
# Khi nào dùng:
#   - Server crash với ImportError / ModuleNotFoundError
#   - pip cài lung tung làm vỡ deps
#   - Sau khi --force-reinstall 1 lib làm cascade conflict
#
# Stack đích (đã test work với OmniVoice + pyannote + Whisper):
#   - torch 2.8.0 + torchvision 0.23.0 + torchaudio 2.8.0 (cu128)
#   - transformers 5.3+ (có HiggsAudioV2TokenizerModel cho OmniVoice)
#   - pyannote.audio 4.x (có AudioDecoder bug nhưng pipeline fallback OK)
#   - tokenizers >= 0.21
#
# Usage:
#   /workspace/VoxStudio/scripts/pod_recover.sh

set -e

echo "═══════════════════════════════════════════════════════"
echo "  VoxStudio Pod Recovery — full deps reinstall"
echo "═══════════════════════════════════════════════════════"

source /workspace/.venv/bin/activate

echo "→ Step 1/4: torch stack (cu128) — ~2 phút..."
pip install --force-reinstall --no-cache-dir \
  --index-url https://download.pytorch.org/whl/cu128 \
  'torch==2.8.0' 'torchvision==0.23.0' 'torchaudio==2.8.0'

echo "→ Step 2/4: transformers + pyannote — ~2 phút..."
pip install --force-reinstall --no-cache-dir \
  'transformers>=5.3,<6' 'tokenizers>=0.21' \
  'pyannote.audio' 'huggingface_hub>=0.25'

echo "→ Step 3/4: verify imports..."
python -c "from omnivoice import OmniVoiceGenerationConfig; print('  ✓ OmniVoice OK')"
python -c "from transformers import pipeline; print('  ✓ transformers.pipeline OK')"
python -c "from pyannote.audio import Pipeline; print('  ✓ pyannote.audio OK')"
python -c "import torch; print('  ✓ torch', torch.__version__, 'CUDA:', torch.cuda.is_available())"

echo "→ Step 4/4: restart server..."
pkill -f uvicorn 2>/dev/null || true
sleep 2
/workspace/start.sh

echo "═══════════════════════════════════════════════════════"
echo "  ✓ Recovery done. Server live."
echo "═══════════════════════════════════════════════════════"
