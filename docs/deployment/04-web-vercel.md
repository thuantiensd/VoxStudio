# 04 — Deploy `web/` lên Vercel

> Mục tiêu: deploy app marketing/auth/billing (`web/`) lên Vercel, trỏ về API ở `https://api.voxstudio.app`.

## Trước khi bắt đầu

- [02-server-vps.md](./02-server-vps.md) đã xong, `https://api.voxstudio.app/health` → 200
- Repo VoxStudio đã push lên GitHub (Vercel pull từ GitHub)
- Có domain (vd `voxstudio.app`) — nếu chưa, dùng URL `*.vercel.app` mặc định

## Bước 1 — Import repo vào Vercel

1. https://vercel.com/new → **Import Git Repository**
2. Chọn repo `VoxStudio`
3. **Project Name**: `voxstudio-web`
4. **Framework Preset**: Next.js (auto-detect)
5. **Root Directory**: bấm **Edit** → chọn `web` (RẤT QUAN TRỌNG — vì repo có 3 app: web/admin/desktop)
6. **Build & Output Settings**: giữ mặc định
   - Build Command: `next build`
   - Output Directory: `.next`
   - Install Command: `npm install`
7. **Node.js Version**: 20.x (mặc định) — Next.js 16 yêu cầu Node 20+

## Bước 2 — Set Environment Variables

Vercel → project `voxstudio-web` → **Settings → Environment Variables**:

| Name | Value | Environment |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.voxstudio.app` | Production, Preview, Development |

> **Lưu ý:** Tất cả env vars của `web/` đều prefix `NEXT_PUBLIC_*` (xem [web/lib/](../../web/lib/)). Không có server-side secret.

Nếu chưa có domain `api.voxstudio.app`, tạm dùng IP VPS:

```
NEXT_PUBLIC_API_URL=http://<VPS_IP>:8000
```

> Nhưng browser sẽ block mixed content (HTTPS Vercel → HTTP API). Phải dùng HTTPS cho API → setup Nginx + Certbot ở bước [02-server-vps.md](./02-server-vps.md#bước-7--reverse-proxy--https-nginx--certbot).

## Bước 3 — Deploy

Bấm **Deploy**. Build mất ~2-3 phút.

Sau khi xong, Vercel cấp URL: `https://voxstudio-web-<random>.vercel.app`

Test:
- Mở URL → trang chủ load OK
- Mở console: không có error CORS (CORS đã set `allow_origins=["*"]` ở [server/app/main.py](../../server/app/main.py))
- Click **Sign in** → submit form → nếu trả token thì OK; nếu lỗi `Failed to fetch` → kiểm tra `NEXT_PUBLIC_API_URL`

## Bước 4 — Add custom domain

1. Vercel → project → **Settings → Domains**
2. Thêm `voxstudio.app` + `www.voxstudio.app`
3. Vercel hiện DNS records cần set:
   - `A` `@` → `76.76.21.21` (Vercel IP)
   - `CNAME` `www` → `cname.vercel-dns.com`
4. Vào DNS provider (Cloudflare/Namecheap/...) thêm records
5. Đợi DNS propagate (5-30 phút)
6. Vercel auto cấp SSL Let's Encrypt → HTTPS sẵn

## Bước 5 — Verify production

```bash
# 1. Trang chủ load
curl -I https://voxstudio.app
# → HTTP/2 200

# 2. Static assets có CDN cache
curl -I https://voxstudio.app/_next/static/...
# → cache-control: public,max-age=31536000

# 3. API call từ browser
# Mở https://voxstudio.app/sign-in → DevTools Network → submit form
# → request đi tới https://api.voxstudio.app/api/v1/auth/login
# → response 200 + token
```

## Bước 6 — Setup auto-preview cho PR (tùy chọn)

Vercel mặc định build preview cho mỗi git branch + pull request. Để tắt preview cho branch không cần:

- **Settings → Git → Production Branch**: `master`
- **Settings → Git → Ignored Build Step**: thêm script bỏ qua nếu không touch `web/`:

```bash
# vercel.json hoặc settings UI
git diff HEAD^ HEAD --quiet -- web/ || exit 1
```

## Troubleshooting

### Lỗi: "Failed to fetch" khi sign-in

- Browser console → check request URL → đúng `https://api.voxstudio.app` không?
- Test trực tiếp: `curl https://api.voxstudio.app/api/v1/auth/login -X POST ...` → có ra 200 không?
- Nếu API trả 200 nhưng browser fail → có thể là CORS. Check response header có `access-control-allow-origin` không.

### Lỗi: "Mixed Content blocked"

API đang dùng HTTP nhưng web HTTPS. Phải:
- Setup Nginx + SSL trên VPS ([02-server-vps.md#bước-7](./02-server-vps.md#bước-7--reverse-proxy--https-nginx--certbot)), HOẶC
- Dùng URL HTTPS RunPod trực tiếp: `https://<pod-id>-8000.proxy.runpod.net` (chỉ work với all-in-one mode)

### Lỗi: i18n route không hoạt động

`web/middleware.ts` handle i18n routing. Vercel hỗ trợ middleware natively, không cần config gì thêm. Nếu fail: check log build → có dòng `Compiled middleware` không.

### Build fail: "Cannot find module 'next'"

`Root Directory` đang sai. Phải = `web` (không phải `/` hoặc `web/`).

## Checklist hoàn thành

- [ ] Project `voxstudio-web` deploy thành công, URL `*.vercel.app` mở được
- [ ] `NEXT_PUBLIC_API_URL` set đúng (đã check ở Settings)
- [ ] Custom domain `voxstudio.app` trỏ về Vercel, HTTPS hoạt động
- [ ] Test sign-in từ browser thành công, token lưu vào localStorage
- [ ] DevTools Network tab: API call tới `api.voxstudio.app` không bị CORS

→ Tiếp theo: [05-admin-vercel.md](./05-admin-vercel.md)
