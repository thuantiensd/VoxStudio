# 05 — Deploy `admin/` lên Vercel

> Mục tiêu: deploy admin dashboard (`admin/`) lên Vercel ở subdomain riêng `admin.voxstudio.app`.

## Trước khi bắt đầu

- [02-server-vps.md](./02-server-vps.md) đã xong, API chạy trên `https://api.voxstudio.app`
- Có user admin trong DB (xem [06-data-migration.md](./06-data-migration.md#tạo-admin-user))

## Bước 1 — Import repo vào Vercel (project thứ 2)

Cùng repo nhưng project riêng:

1. https://vercel.com/new → **Import Git Repository** → chọn `VoxStudio`
2. **Project Name**: `voxstudio-admin`
3. **Framework Preset**: Next.js
4. **Root Directory**: `admin` (RẤT QUAN TRỌNG)
5. Build Command, Install Command: mặc định
6. Node.js Version: 20.x

## Bước 2 — Set Environment Variables

| Name | Value | Environment |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.voxstudio.app` | All |

Giống `web/` — admin cũng chỉ là client-side gọi API.

## Bước 3 — Deploy

Bấm **Deploy**. Build ~2 phút.

Test URL: `https://voxstudio-admin-<random>.vercel.app/login`

Đăng nhập bằng admin user (sẽ tạo ở [06-data-migration.md](./06-data-migration.md#tạo-admin-user)):
- Email: admin@voxstudio.app
- Password: <set ở bước migration>

Nếu login OK → redirect về `/` → thấy dashboard.

## Bước 4 — Custom domain `admin.voxstudio.app`

1. Vercel → project `voxstudio-admin` → **Settings → Domains**
2. Thêm `admin.voxstudio.app`
3. Vercel hiện DNS:
   - `CNAME` `admin` → `cname.vercel-dns.com`
4. Set DNS ở provider, đợi propagate
5. Vercel tự cấp SSL

## Bước 5 — Bảo mật admin route

Admin dashboard có dữ liệu nhạy cảm (users, payments, audit log) — cần thêm lớp bảo vệ ngoài JWT.

### Option A: Vercel Password Protection (đơn giản nhất, $20/tháng Pro)

1. **Settings → Deployment Protection → Password Protection** → bật
2. Set password cố định
3. Mỗi lần truy cập `admin.voxstudio.app` Vercel hỏi password trước khi load app

### Option B: IP whitelist qua Cloudflare (free)

Đặt domain qua Cloudflare proxy, dùng Cloudflare Access:

1. Cloudflare Dashboard → Zero Trust → Access → Applications
2. Add application → Self-hosted → `admin.voxstudio.app`
3. Policy: chỉ cho phép email list cụ thể (`you@example.com`) hoặc IP cụ thể
4. Free 50 users đầu

### Option C: chỉ JWT auth (không khuyến nghị production)

Nếu chỉ dùng JWT (mặc định của code):
- Bất kỳ ai biết URL đều thấy form login
- Brute force/credential stuffing có thể tấn công
- → Tối thiểu phải có rate limit ở FastAPI ([server/app/auth/rate_limit.py](../../server/app/auth/rate_limit.py))

**Khuyến nghị: Option B (Cloudflare Access)** — free và mạnh.

## Bước 6 — Verify production

```bash
# 1. Trang login load
curl -I https://admin.voxstudio.app/login
# → 200 (hoặc 302 redirect tới Cloudflare Access nếu đã bật)

# 2. Login flow
# Mở browser → admin.voxstudio.app/login
# Nhập admin credentials
# Redirect về /
# Sidebar có: Users, Payments, Plans, Jobs, Audit, Voices, Flags, Health
```

Test các trang:
- `/users` — list users từ API
- `/payments` — list payments
- `/health` — gọi `/health` của server, hiện status

Nếu trang load nhưng dữ liệu rỗng → API có thể trả 401. Kiểm tra:
- localStorage có `voxstudio-admin:token` không
- Network tab: request tới `api.voxstudio.app/api/v1/admin/...` có header `Authorization: Bearer <token>` không
- Server log: có log auth pass không, có error 401 không

## Troubleshooting

### Lỗi: redirect loop về `/login`

User không phải admin (`is_admin=false` trong DB). Set lại:

```sql
-- Trên VPS:
sudo -u postgres psql voxstudio -c \
  "UPDATE users SET is_admin=true WHERE email='admin@voxstudio.app';"
```

### Lỗi: "Network Error" khi gọi API

CORS preflight có thể fail. Kiểm tra:

```bash
curl -X OPTIONS https://api.voxstudio.app/api/v1/admin/stats \
  -H "Origin: https://admin.voxstudio.app" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization" \
  -i
```

Phải có header `access-control-allow-origin: *` trong response.

Nếu thiếu → kiểm tra Nginx proxy có strip header CORS không. Sửa [02-server-vps.md](./02-server-vps.md#bước-7--reverse-proxy--https-nginx--certbot) thêm:

```nginx
proxy_pass_header Access-Control-Allow-Origin;
proxy_pass_header Access-Control-Allow-Methods;
proxy_pass_header Access-Control-Allow-Headers;
```

## Checklist hoàn thành

- [ ] Project `voxstudio-admin` deploy thành công
- [ ] Custom domain `admin.voxstudio.app` hoạt động, HTTPS OK
- [ ] Login admin thành công, redirect về `/`
- [ ] Sidebar liệt kê đủ menu (Users, Payments, Plans, Jobs, ...)
- [ ] Mở `/users` thấy list users từ DB
- [ ] Đã bật Cloudflare Access HOẶC Vercel Password Protection
- [ ] Rate limit auth login đã enable trên server

→ Tiếp theo: [06-data-migration.md](./06-data-migration.md)
