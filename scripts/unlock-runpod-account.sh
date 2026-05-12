#!/bin/bash
# Unlock duythuandn114@gmail.com trên RunPod server.
#
# Cách lấy JWT:
#   1. Mở web app, đăng nhập với duythuandn114@gmail.com
#   2. DevTools → Application → localStorage → copy giá trị key "voxstudio:web:token"
#   3. Chạy:  TOKEN="<paste>" ./scripts/unlock-runpod-account.sh
#
# Hoặc set inline:
#   TOKEN=eyJhbGciOi... ./scripts/unlock-runpod-account.sh

set -e
API="${API:-https://wvtkqsfb1n241e-8000.proxy.runpod.net}"

if [[ -z "$TOKEN" ]]; then
  echo "❌ Thiếu TOKEN. Xem hướng dẫn trong file này (top comment)."
  exit 1
fi

echo "→ Verify identity..."
ME=$(curl -sf -H "Authorization: Bearer $TOKEN" "$API/api/v1/auth/me")
USER_ID=$(echo "$ME" | python3 -c "import json,sys; print(json.load(sys.stdin)['user']['id'])")
EMAIL=$(echo "$ME"  | python3 -c "import json,sys; print(json.load(sys.stdin)['user']['email'])")
ROLE=$(echo "$ME"   | python3 -c "import json,sys; print(json.load(sys.stdin)['user']['role'])")
echo "   user_id=$USER_ID  email=$EMAIL  role=$ROLE"

if [[ "$ROLE" != "admin" ]]; then
  echo "❌ Tài khoản không phải admin → không thể gọi /admin/* endpoint."
  exit 1
fi

echo "→ Patch plan 'premium' về unlimited..."
curl -sf -X PUT "$API/api/v1/admin/plans/premium" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "limits": {
      "concurrent_jobs": -1,
      "daily_jobs": -1,
      "daily_downloads": -1,
      "dubbing_min_month": -1,
      "stt_min_month": -1,
      "tts_chars_month": -1,
      "tts_max_chars_request": -1,
      "voice_clone_max": -1,
      "project_max": -1
    },
    "price_usd": 9901
  }' > /dev/null
echo "   ✅ premium plan limits → unlimited"

echo "→ Upgrade user $USER_ID sang plan 'premium'..."
curl -sf -X PATCH "$API/api/v1/admin/users/$USER_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"plan": "premium", "is_banned": false, "role": "admin"}' > /dev/null
echo "   ✅ user nâng cấp xong"

echo ""
echo "🎉 DONE. Reload web để FE đọc lại plan mới."
echo "   Lưu ý: credit_balance không có API admin → nếu TTS server-side (không BYOK) bị chặn"
echo "   credits, phải SSH vào RunPod chạy sqlite3."
