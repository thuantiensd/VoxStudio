# Google OAuth Setup cho VoxStudio

Tạo OAuth 2.0 Client ID miễn phí để user đăng nhập qua Google.

## Bước 1 — Tạo Google Cloud Project

1. Vào https://console.cloud.google.com
2. Đăng nhập bằng tài khoản Google.
3. Góc trên trái chọn dropdown project → **New Project**.
4. Tên: `VoxStudio` (hoặc gì cũng được), **Create**.

## Bước 2 — Enable Google OAuth consent screen

1. Menu trái → **APIs & Services** → **OAuth consent screen**.
2. User Type: **External** → Create.
3. Điền form:
   - **App name**: `VoxStudio`
   - **User support email**: email của bạn
   - **Developer contact email**: email của bạn
4. Save and continue.
5. **Scopes** → Add or Remove Scopes → tick 3 scopes cơ bản:
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `openid`
6. Save and continue.
7. **Test users** → Add users → email bạn đang dùng để test.
   - Giai đoạn test, chỉ email này login được.
   - Sau publish app thì ai cũng login được (cần Google verify).
8. Save and continue.

## Bước 3 — Tạo OAuth Client ID

1. Menu trái → **APIs & Services** → **Credentials**.
2. **+ Create Credentials** → **OAuth client ID**.
3. **Application type**: **Desktop app** ← quan trọng (KHÔNG chọn Web).
4. **Name**: `VoxStudio Desktop`.
5. Create.
6. Popup hiện 2 giá trị:
   - **Client ID**: `1234567890-xxx.apps.googleusercontent.com`
   - **Client Secret**: `GOCSPX-xxxxxx`
7. **Copy cả 2** (nhấn Download JSON để lưu backup).

> Note: Với Desktop app type, Google không bắt redirect URI — VoxStudio
> dùng loopback IP tự động (127.0.0.1:random_port).

## Bước 4 — Cấu hình vào backend

Tạo file `server/.env` (nếu chưa có) và thêm:

```bash
# JWT
JWT_SECRET=change-this-to-a-random-32char-string-please

# Google OAuth
GOOGLE_OAUTH_CLIENT_ID=1234567890-xxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxxxxx
```

**JWT_SECRET** — tự sinh random 32+ ký tự, giữ bí mật. Ví dụ:
```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Sau đó restart backend (`uvicorn app.main:app --reload`).

## Bước 5 — Thêm tài khoản test khác

Nếu muốn cho thêm người test (trước khi publish):

1. Vào **OAuth consent screen** → **Test users**.
2. Add email của người đó.
3. Mỗi project chỉ cho phép 100 test users.

## Publish app (sau khi stable)

Khi sẵn sàng cho public:
1. **OAuth consent screen** → **Publish App**.
2. Google sẽ verify trong 1-6 tuần (cho các scope nhạy cảm, userinfo thì thường không cần verify).

## Troubleshooting

**"Error 403: access_denied"**
→ Email chưa add vào Test users, hoặc app chưa Publish. Thêm email vào Test users.

**"redirect_uri_mismatch"**
→ Chọn sai Application type. Desktop app không có ràng buộc redirect URI. Tạo lại Client ID với đúng type Desktop.

**"invalid_client"**
→ CLIENT_ID sai hoặc secret sai. Check lại `.env`.

**Backend không đọc được env**
→ Cần `python-dotenv` hoặc load env trước khi import app: `source .env && uvicorn ...`
