# Release flow — VoxStudio desktop app

Auto-update qua GitHub Releases + `electron-updater`.

## Lần release đầu tiên

```bash
cd desktop

# Tăng version trong package.json (SemVer)
# Ví dụ: 0.1.0 → 0.2.0
npm version minor --no-git-tag-version

# Build mac (hoặc --win / --linux)
npm run build:mac
```

`electron-builder` sẽ tạo trong `desktop/release/`:

- `VoxStudio-0.2.0-universal.dmg` — installer
- `VoxStudio-0.2.0-universal-mac.zip` — dùng cho auto-update
- `latest-mac.yml` — manifest cho updater check version mới

## Upload lên GitHub Releases

Cần tạo **GitHub token** có scope `repo`:

```bash
export GH_TOKEN=ghp_xxxxxxxxxxxxx
```

Rồi build với `--publish always`:

```bash
npm run build:mac -- --publish always
```

Hoặc dùng GitHub CLI manually:

```bash
gh release create v0.2.0 \
  release/VoxStudio-0.2.0-universal.dmg \
  release/VoxStudio-0.2.0-universal-mac.zip \
  release/latest-mac.yml \
  --title "VoxStudio 0.2.0" \
  --notes-file CHANGELOG.md
```

## User nhận update

1. App đang mở version cũ (0.1.0)
2. Sau 8 giây khởi động + mỗi 4h → check `latest-mac.yml` trên GitHub
3. Thấy version mới → download background
4. Download xong → hiện banner "Bản mới 0.2.0 sẵn sàng · Cập nhật ngay"
5. User click → app quit + install + mở lại version mới

## Windows + Linux

Cần build trên đúng OS hoặc qua GitHub Actions (dự án mẫu hay dùng
`electron-builder` action matrix). Chưa tự động hoá — build tay khi cần.

## Troubleshooting

**"No published versions on GitHub"**: Bình thường ở lần chạy đầu. App
lần sau check sẽ thấy.

**macOS notarization**: App chưa signed → Gatekeeper chặn install. Để
sign cần Apple Developer Account ($99/năm). Tạm thời user bypass bằng
**System Settings → Privacy & Security → Open Anyway**.

**Tắt auto-update tạm thời cho dev**: app chỉ check updates khi
`app.isPackaged === true`, tức chỉ khi build production. `npm run dev`
không check → không cần disable.
