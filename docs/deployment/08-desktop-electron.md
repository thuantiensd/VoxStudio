# 08 — Build & Distribute Desktop App (Electron)

> Mục tiêu: build app desktop ([desktop/](../../desktop/)) cho macOS / Windows / Linux, publish lên GitHub Releases để user download + auto-update.

## Trước khi bắt đầu

- API production đã chạy: `https://api.voxstudio.app/health` → 200
- Repo `VoxStudio` đã có trên GitHub (xem [desktop/package.json:113-118](../../desktop/package.json) — publish.owner = `thuantiensd`)
- macOS phải build trên máy macOS (cross-build .dmg không hỗ trợ)
- Windows có thể cross-build từ macOS/Linux nhưng signing thì phải Windows hoặc qua dịch vụ

## Trạng thái hiện tại

Đã có release mẫu:

```
desktop/release/
├── VoxStudio-0.2.1-arm64.dmg      ← macOS Apple Silicon
├── VoxStudio-0.2.1-arm64.dmg.blockmap  ← cho auto-update delta
└── latest-mac.yml                  ← electron-updater metadata
```

Đã thiếu: build x64 (Intel Mac), Windows, Linux. Chưa code-sign nên user mở app sẽ bị Gatekeeper/SmartScreen warn.

## Bước 1 — Cấu hình `VITE_API_URL` cho production build

Tạo `desktop/.env.production`:

```ini
VITE_API_URL=https://api.voxstudio.app
```

Vite sẽ inline biến này vào bundle khi `npm run build`. **Lưu ý:** giá trị này được hardcode vào binary — đổi URL = phải build lại.

> Khuyến nghị: dùng URL stable từ đầu. Nếu chưa có domain, dùng VPS IP nhưng build lại khi có domain.

## Bước 2 — Build cho từng OS

### 2.1 — macOS (.dmg)

```bash
cd desktop

# Cài deps
npm ci

# Build (Vite → Electron-builder)
npm run build:mac

# Output:
# desktop/release/VoxStudio-0.2.1-arm64.dmg     ← Apple Silicon
# desktop/release/latest-mac.yml                ← updater metadata
```

**Build cho cả Intel + Apple Silicon (universal):**

Sửa [desktop/package.json](../../desktop/package.json) section `build.mac.target`:

```json
"target": [
  {
    "target": "dmg",
    "arch": ["arm64", "x64"]
  }
]
```

Rồi `npm run build:mac` — sẽ tạo 2 file `.dmg` (arm64 + x64).

### 2.2 — Windows (.exe NSIS)

Phải có Wine trên macOS hoặc build trên Windows thật.

**Trên macOS:**

```bash
brew install wine-stable
cd desktop
npm run build:win
# Output: desktop/release/VoxStudio Setup 0.2.1.exe
```

**Trên Windows:**

```powershell
cd desktop
npm install
npm run build:win
```

### 2.3 — Linux (AppImage)

```bash
cd desktop
npm run build:linux
# Output: desktop/release/VoxStudio-0.2.1.AppImage
```

## Bước 3 — Code Signing (QUAN TRỌNG cho production)

App chưa sign → user macOS thấy "VoxStudio cannot be opened because the developer cannot be verified", user Windows thấy SmartScreen warn. Sẽ rớt rất nhiều download.

### 3.1 — macOS: Apple Developer ID

**Cần:** Apple Developer Program ($99/năm) → https://developer.apple.com/programs/

1. Tạo cert "Developer ID Application" trong Apple Developer portal
2. Download `.cer`, double-click để add vào Keychain
3. Sửa [desktop/package.json](../../desktop/package.json) `build.mac`:

```json
"mac": {
  "category": "public.app-category.video",
  "icon": "build/icons/icon.icns",
  "target": [{ "target": "dmg", "arch": ["arm64", "x64"] }],
  "hardenedRuntime": true,
  "gatekeeperAssess": false,
  "entitlements": "build/entitlements.mac.plist",
  "entitlementsInherit": "build/entitlements.mac.plist",
  "notarize": {
    "teamId": "YOUR_TEAM_ID"
  }
}
```

4. Tạo file `desktop/build/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyLists/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
</dict>
</plist>
```

5. Notarize cần Apple ID app-specific password:

```bash
export APPLE_ID="your@apple.id"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # https://appleid.apple.com → App-Specific Passwords
export APPLE_TEAM_ID="ABCDE12345"

cd desktop
npm run build:mac
# Sẽ tự động sign + notarize (mất 5-15 phút)
```

### 3.2 — Windows: Code Signing Certificate

**Cần:** OV (~$200/năm) hoặc EV (~$400/năm) Code Signing cert. Mua từ [Sectigo](https://www.sectigo.com/), [DigiCert](https://www.digicert.com/), [SSL.com](https://www.ssl.com/).

EV cert tốt hơn vì SmartScreen reputation build nhanh hơn.

```bash
# Sau khi mua được file .pfx
export CSC_LINK=/path/to/cert.pfx
export CSC_KEY_PASSWORD=password_của_pfx

cd desktop
npm run build:win
# Sẽ tự động sign
```

### 3.3 — Skip signing (chấp nhận warning ở v1)

Nếu chưa muốn đầu tư cert, để config hiện tại (`identity: null`):
- macOS user phải right-click → Open lần đầu, hoặc `xattr -dr com.apple.quarantine /Applications/VoxStudio.app`
- Windows user phải bấm "More info → Run anyway" trên SmartScreen
- Hướng dẫn này nên ghi rõ trên trang download

## Bước 4 — Publish lên GitHub Releases

[desktop/package.json:113](../../desktop/package.json) đã config publish provider = GitHub. Để upload tự động:

```bash
# Tạo Personal Access Token: https://github.com/settings/tokens
# Scope: repo (read+write)
export GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

cd desktop
npm run build:mac -- --publish=always
# Sẽ:
# 1. Build .dmg
# 2. Tạo draft release v0.2.1 trên GitHub
# 3. Upload .dmg + latest-mac.yml + .blockmap
```

Workflow đầy đủ cho 1 lần release:

```bash
# 1. Bump version trong desktop/package.json
# vd 0.2.1 → 0.2.2

# 2. Commit + tag
git add desktop/package.json
git commit -m "release: desktop v0.2.2"
git tag desktop-v0.2.2
git push origin master --tags

# 3. Build + publish
cd desktop
export GH_TOKEN=ghp_...
export APPLE_ID=...
export APPLE_APP_SPECIFIC_PASSWORD=...
export APPLE_TEAM_ID=...

npm run build:mac -- --publish=always
npm run build:win -- --publish=always       # nếu có Windows
npm run build:linux -- --publish=always     # nếu cần Linux

# 4. Vào https://github.com/thuantiensd/VoxStudio/releases
# 5. Edit draft release → write changelog → Publish
```

## Bước 5 — Auto-update (electron-updater)

App hiện tại đã có [desktop/electron/updater.cjs](../../desktop/electron/updater.cjs) — kiểm tra `latest-mac.yml` mỗi lần app khởi động.

Cách hoạt động:
1. App đang dùng v0.2.1, khởi động
2. updater.cjs fetch `https://github.com/thuantiensd/VoxStudio/releases/latest/download/latest-mac.yml`
3. Đọc `version: 0.2.2` → có update
4. Download `.dmg.blockmap` để biết delta → tải chỉ phần khác (delta update)
5. Notify user "Update available", apply khi user OK

Yêu cầu để auto-update hoạt động:
- Release **PUBLIC** (không phải draft) trên GitHub
- File `latest-mac.yml` / `latest.yml` / `latest-linux.yml` được upload vào release
- App đang chạy phải sign — Gatekeeper từ chối auto-update unsigned bundle
- Server (GitHub) trả CORS đúng — GitHub Releases default OK

Test thủ công:

```bash
# Mở app v0.2.1 → vào DevTools (Cmd+Opt+I trong dev mode)
# Xem console log: "[updater] checking..."
# Nếu thấy "[updater] update available: 0.2.2" → OK
```

## Bước 6 — Trang download trên web

Web app đã có route [web/app/[locale]/download/](../../web/app/[locale]/download/). Cập nhật để link tới latest GitHub release:

```tsx
// web/app/[locale]/download/page.tsx (giả định)
const RELEASES_URL = "https://github.com/thuantiensd/VoxStudio/releases/latest";

// Direct download URLs:
const MAC_ARM64 = `${RELEASES_URL}/download/VoxStudio-${VERSION}-arm64.dmg`;
const MAC_X64   = `${RELEASES_URL}/download/VoxStudio-${VERSION}-x64.dmg`;
const WIN_X64   = `${RELEASES_URL}/download/VoxStudio-Setup-${VERSION}.exe`;
const LINUX     = `${RELEASES_URL}/download/VoxStudio-${VERSION}.AppImage`;
```

Hoặc dynamic (gọi GitHub API):

```js
const res = await fetch("https://api.github.com/repos/thuantiensd/VoxStudio/releases/latest");
const release = await res.json();
const assets = release.assets;
// Match by name pattern → display platform-specific button
```

> Cẩn thận rate limit GitHub API: 60 req/h cho IP unauthenticated. Nếu trang download có traffic cao, cache response 1h ở phía Vercel (Edge Cache).

## Bước 7 — Sentry cho desktop (đã wired)

[desktop/package.json:28-29](../../desktop/package.json) đã có `@sentry/electron` + `@sentry/react`. Để bật:

1. Tạo Sentry project (Electron) → lấy DSN
2. Thêm vào `desktop/.env.production`:

```ini
VITE_API_URL=https://api.voxstudio.app
VITE_SENTRY_DSN=https://xxxx@sentry.io/yyyy
```

3. Verify trong [desktop/electron/sentry-init.cjs](../../desktop/electron/sentry-init.cjs) đọc env var đúng.

## Phụ lục — Build size optimization

App hiện ~150-200MB do bundle Electron + Chromium. Để giảm:

- Bỏ deps không dùng: `npx depcheck` để liệt kê
- Tree-shake Lucide icons: import từng icon `import { Mic } from 'lucide-react'` thay vì `import * as Icons`
- ASAR pack: đã enable mặc định trong electron-builder
- Compression: thêm vào `build`:

```json
"compression": "maximum"
```

## Checklist hoàn thành

- [ ] `desktop/.env.production` set `VITE_API_URL=https://api.voxstudio.app`
- [ ] `npm run build:mac` chạy thành công, có file `.dmg` trong `desktop/release/`
- [ ] Mở `.dmg` trên macOS → cài app → chạy được, login API → OK
- [ ] (Khuyến nghị) Apple Developer ID setup, app sign + notarize
- [ ] (Khuyến nghị) Windows code-signing cert mua, build:win sign OK
- [ ] GitHub Release publish public, có cả `.dmg`, `.exe`, `.AppImage` + 3 file `latest-*.yml`
- [ ] Test auto-update: cài v0.2.1, sau đó publish v0.2.2 → app v0.2.1 nhận notification update
- [ ] Trang `web/download/` cập nhật link tới GitHub Releases
- [ ] Sentry DSN set, test bằng cách trigger error giả → thấy event trên Sentry
