#!/usr/bin/env bash
# Chạy build_voice_previews.py cho TỪNG voice riêng — mỗi voice 1 Python subprocess.
# Mục đích: bypass MPS allocator fragmentation. Mỗi subprocess exit → MPS
# wired memory release sạch → voice sau load fresh không bị OOM tích lũy.
#
# Trade-off: mỗi voice load lại model ~30s → total ~12-15 phút cho 12 voices.
# Đổi lại: không cần đóng apps, không cần restart Mac, không OOM.
#
# Usage:
#   chmod +x scripts/build_voice_previews_isolated.sh
#   ./scripts/build_voice_previews_isolated.sh
#   ./scripts/build_voice_previews_isolated.sh --redo   # overwrite preview cũ

set -e

cd "$(dirname "$0")/.."

VOICES=(
    nu_mai_anh
    nu_bao_chau
    nu_hong_hanh
    nu_thu_lan
    nu_co_ba
    nu_thao_vy
    nam_hoang_phuc
    nam_tuan_khang
    nam_quoc_bao
    nam_duc_trong
    nam_bac_tu
    nam_minh_duc
)

EXTRA_ARGS="$@"
TOTAL=${#VOICES[@]}
SUCCESS=0
FAIL=0

echo "Building $TOTAL voice previews — mỗi voice 1 subprocess riêng để tránh MPS OOM."
echo "Tổng thời gian dự kiến: ~12-15 phút (load model ~30s × $TOTAL voices)."
echo ""

for i in "${!VOICES[@]}"; do
    voice="${VOICES[$i]}"
    n=$((i+1))
    echo "═══════════════════════════════════════════════════════"
    echo "  [$n/$TOTAL] $voice"
    echo "═══════════════════════════════════════════════════════"

    if python scripts/build_voice_previews.py --voices "$voice" $EXTRA_ARGS; then
        SUCCESS=$((SUCCESS+1))
    else
        FAIL=$((FAIL+1))
        echo "  ⚠ $voice: subprocess thất bại — tiếp tục voice kế tiếp"
    fi
    echo ""
done

echo "═══════════════════════════════════════════════════════"
echo "  ✓ Done. Success: $SUCCESS / $TOTAL · Fail: $FAIL"
echo "  Preview files: voxstudio-engine/voices/<slug>_preview.wav"
echo "═══════════════════════════════════════════════════════"
