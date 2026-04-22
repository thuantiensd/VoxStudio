# Google OAuth Brand Verification — Checklist VoxStudio

Làm theo thứ tự dưới để Google approve thương hiệu + cho phép user bên ngoài đăng nhập (không giới hạn 100 test users).

---

## Tình trạng hiện tại

- [x] OAuth Client ID đã tạo (Desktop app type)
- [x] Client ID + Secret lưu trong `server/.env` (gitignored)
- [x] Privacy Policy viết xong (`docs/PRIVACY_POLICY.md` + `website/privacy.html`)
- [x] Terms of Service viết xong (`docs/TERMS_OF_SERVICE.md` + `website/terms.html`)
- [x] Landing page (`website/index.html`)
- [x] Logo SVG (`website/logo.svg`)
- [ ] Deploy `website/` lên hosting công khai
- [ ] Paste 3 URL (Home / Privacy / Terms) vào OAuth consent screen
- [ ] Google verify (nếu scope sensitive — với `openid/email/profile` thì thường bỏ qua)

---

## Bước 1 — Deploy `website/` lên GitHub Pages (miễn phí)

```bash
cd /Users/tienthuan/Desktop/VoxStudio

# Tạo branch gh-pages chứa website/
git subtree push --prefix website origin gh-pages
```

Hoặc dễ hơn:

1. Push repo (đã làm).
2. Vào https://github.com/thuantiensd/VoxStudio/settings/pages
3. Source: **Deploy from a branch**
4. Branch: **master**, folder: **/website**
5. Save.
6. Chờ 1–2 phút, URL sẽ là:

```
https://thuantiensd.github.io/VoxStudio/          ← Homepage
https://thuantiensd.github.io/VoxStudio/privacy.html
https://thuantiensd.github.io/VoxStudio/terms.html
```

Test mở 3 URL trên trên trình duyệt → phải load đẹp.

---

## Bước 2 — Cập nhật OAuth Consent Screen

1. Vào https://console.cloud.google.com
2. Chọn project **VoxStudio**.
3. Menu ☰ → **APIs & Services** → **OAuth consent screen**.
4. **Edit app** → điền đầy đủ:

### App information

| Field | Giá trị |
|---|---|
| **App name** | `VoxStudio` |
| **User support email** | email của bạn |
| **App logo** | Upload `website/logo.svg` (convert sang PNG 256×256 nếu Google đòi — có thể dùng https://cloudconvert.com) |

### App domain

| Field | Giá trị |
|---|---|
| **Application home page** | `https://thuantiensd.github.io/VoxStudio/` |
| **Application privacy policy link** | `https://thuantiensd.github.io/VoxStudio/privacy.html` |
| **Application terms of service link** | `https://thuantiensd.github.io/VoxStudio/terms.html` |

### Authorized domains

Add:
- `github.io`

### Developer contact info

Email của bạn.

Save + Continue.

### Scopes

Phải có (không thêm gì thừa):
- `.../auth/userinfo.email`
- `.../auth/userinfo.profile`
- `openid`

3 scopes này là **non-sensitive** → **KHÔNG cần Google verify**.

### Test users

Add email bạn đang test (+ team nếu có, tối đa 100).

---

## Bước 3 — Publish App

Sau khi điền đủ:

1. Back to **OAuth consent screen**.
2. Nhấn **PUBLISH APP** → xác nhận.
3. Publishing status chuyển từ `Testing` → `In production`.

Với 3 scopes non-sensitive, **không cần chờ Google verify** — user bất kỳ login được ngay.

---

## Bước 4 — (Tuỳ chọn) Verify brand để tránh "unverified app" warning

Nếu sau publish, user vẫn thấy cảnh báo "This app isn't verified":

1. Trong OAuth consent screen, scroll xuống **Verification center**.
2. **Prepare for verification**.
3. Upload:
   - Link demo video (screen record 2–3 phút dùng app).
   - Giải thích vì sao app cần `userinfo.email` + `profile` (để tạo account).
4. Submit.
5. Google review trong **2–10 ngày làm việc**.

Vì app chỉ dùng scopes cơ bản → thường được approve nhanh (1–3 ngày).

---

## Bước 5 — Cập nhật app metadata

Sau khi verify xong, cập nhật `desktop/package.json`:

```json
{
  "productName": "VoxStudio",
  "version": "1.0.0",
  "description": "VoxStudio — AI Video Dubbing, TTS, Voice Clone, STT, Translation",
  "author": {
    "name": "VoxStudio",
    "email": "hello@voxstudio.app",
    "url": "https://thuantiensd.github.io/VoxStudio/"
  },
  "homepage": "https://thuantiensd.github.io/VoxStudio/",
  "repository": {
    "type": "git",
    "url": "https://github.com/thuantiensd/VoxStudio.git"
  }
}
```

---

## Checklist hoàn tất

- [ ] Deploy website/ lên GitHub Pages, kiểm tra 3 URL load được
- [ ] Điền đủ OAuth consent screen (logo, home, privacy, terms)
- [ ] Scopes đúng 3 cái non-sensitive
- [ ] Publish App → status `In production`
- [ ] (Tuỳ chọn) Submit verification để bỏ warning "unverified"

Sau khi xong, user bất kỳ (không phải Test users) có thể Google Sign-In
vào VoxStudio.

---

## Troubleshooting

**"Access blocked: This app's request is invalid"**
→ OAuth consent screen chưa điền đủ bắt buộc (home/privacy/logo). Back và hoàn thiện.

**"This app is blocked"**
→ App vẫn trong status Testing nhưng email không có trong Test users. Add email hoặc Publish app.

**"redirect_uri_mismatch"**
→ Chọn sai Application type khi tạo Client ID. Desktop app không có ràng buộc redirect_uri, tạo lại Client ID nếu nhầm.

**Logo upload fail**
→ Google đòi PNG/JPG, kích thước 120×120 đến 1024×1024. Convert SVG → PNG qua cloudconvert.com.

**Verification bị từ chối**
→ Google cần demo video rõ ràng + giải thích cụ thể scope dùng vào đâu. Làm lại theo feedback.
