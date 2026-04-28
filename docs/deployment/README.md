# VoxStudio — Hướng dẫn Deploy Production

Tài liệu hướng dẫn triển khai VoxStudio lên môi trường thật, tối ưu cho **1 người tự deploy**.

## Kiến trúc đề xuất

```
   ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
   │ Browser            │  │ Browser (admin)    │  │ Desktop App        │
   │ voxstudio.app      │  │ admin.voxstudio.app│  │ (.dmg/.exe/AppImg) │
   └─────────┬──────────┘  └─────────┬──────────┘  └─────────┬──────────┘
             │                       │                        │
             │                       │                        │ VITE_API_URL
   ┌─────────▼──────────┐  ┌─────────▼──────────┐  ┌─────────▼──────────┐
   │ Vercel (web/)      │  │ Vercel (admin/)    │  │ GitHub Releases    │
   │  Next.js 16        │  │  Next.js 15        │  │  (desktop/)        │
   └─────────┬──────────┘  └─────────┬──────────┘  │  electron-updater  │
             │                       │              └────────────────────┘
             │ NEXT_PUBLIC_API_URL   │                        ▲
             └───────────┬───────────┘                        │
                         │ HTTPS                              │ HTTPS
                         │                                    │
              ┌──────────▼────────────────────────────────────┴──────┐
              │  DigitalOcean VPS — api.voxstudio.app                │
              │  ─────────────────────────────────────────────       │
              │  • FastAPI (HTTP API only)                           │
              │  • Postgres 16                                       │
              │  • DEVICE=cpu, WORKER_ENABLED=false                  │
              └──────────┬───────────────────────────────────────────┘
                         │ SHARED Postgres (DATABASE_URL)
                         │ + SHARED files (DO Spaces)
              ┌──────────▼─────────────┐
              │  RunPod 3090 Pod       │
              │  ───────────────────   │
              │  • FastAPI worker      │
              │  • DEVICE=cuda         │
              │  • WORKER_ENABLED=true │
              │  • Network Volume 50GB │
              └────────────────────────┘
```

## Phân chia trách nhiệm

| Component | Nơi deploy | Vai trò |
|---|---|---|
| `web/` (Next.js 16) | **Vercel** | Marketing, sign-in/up, pricing, checkout, account, download |
| `admin/` (Next.js 15) | **Vercel** | Admin dashboard (users/payments/jobs/...) |
| `desktop/` (Electron) | **GitHub Releases** | App `.dmg`/`.exe`/`.AppImage` cho user tải về, auto-update |
| `server/` API mode | **DigitalOcean VPS** | HTTP API: auth, billing, upload, queue jobs vào DB |
| `server/` worker mode | **RunPod 3090** | Chỉ chạy GPU model: Whisper, OmniVoice, diarize |
| **Postgres 16** | **DigitalOcean VPS** | DB chung — VPS + RunPod cùng trỏ vào |
| File storage | **DO Spaces** (S3) | `dubbing_projects/`, `voices/` chia sẻ giữa VPS ↔ RunPod |

## Chi phí ước tính

| Dịch vụ | Plan | Giá/tháng |
|---|---|---|
| Vercel (Hobby) | Web + Admin | $0 (Free) |
| GitHub Releases | Desktop binary hosting | $0 (Free, public repo) |
| DigitalOcean Droplet | 2 vCPU / 4GB | $24 |
| DigitalOcean Spaces | 250GB + CDN | $5 |
| RunPod RTX 3090 | Pod always-on (~$0.34/h) | ~$245 |
| RunPod RTX 3090 (alt) | On-demand 8h/ngày | ~$82 |
| **TỔNG (always-on)** | | **~$274/tháng** |
| **TỔNG (on-demand)** | | **~$111/tháng** |
| Apple Developer (yearly) | Code-sign macOS app | $99/năm (~$8/tháng) |
| Windows Code Sign Cert | OV cert (yearly) | ~$200/năm (~$17/tháng) |

> Tip: Dùng RunPod **on-demand** trong giai đoạn đầu (start/stop khi cần). Khi có user trả tiền đều, switch sang always-on để tránh cold start 60-90s.

## Thứ tự deploy (LÀM THEO ĐÚNG THỨ TỰ)

1. **[01-postgres-vps.md](./01-postgres-vps.md)** — Setup Postgres trên VPS DigitalOcean, tạo `DATABASE_URL`
2. **[02-server-vps.md](./02-server-vps.md)** — Deploy FastAPI HTTP API lên VPS (CPU mode, không worker)
3. **[03-server-runpod.md](./03-server-runpod.md)** — Deploy FastAPI worker lên RunPod 3090 (GPU mode)
4. **[04-web-vercel.md](./04-web-vercel.md)** — Deploy `web/` lên Vercel
5. **[05-admin-vercel.md](./05-admin-vercel.md)** — Deploy `admin/` lên Vercel
6. **[06-data-migration.md](./06-data-migration.md)** — Migrate SQLite local → Postgres + seed plans + tạo admin user
7. **[07-env-checklist.md](./07-env-checklist.md)** — Bảng env vars master, dùng để cross-check
8. **[08-desktop-electron.md](./08-desktop-electron.md)** — Build & publish app desktop (Electron) lên GitHub Releases (làm sau cùng, khi backend đã ổn)

## Code change cần thiết (1 lần)

Để tách FastAPI thành 2 mode (API-only trên VPS, worker-only trên RunPod), cần thêm 2 env flag trong `server/app/main.py`:

```python
# Trong async def lifespan(app: FastAPI):
import os
worker_enabled = os.getenv("WORKER_ENABLED", "true").lower() != "false"
if worker_enabled:
    from app.worker.gpu_worker import start_worker, stop_worker
    start_worker()
    gpu.load_all()
else:
    logger.info("[lifespan] worker disabled — API-only mode")
```

Chi tiết xem [03-server-runpod.md](./03-server-runpod.md#code-change).

## Giả định trong tài liệu này

Tôi đã giả định những điều sau — bạn confirm hoặc đổi nếu khác:

- Domain: `voxstudio.app` (web), `admin.voxstudio.app`, `api.voxstudio.app`. Nếu chưa có domain, dùng URL mặc định của Vercel + IP VPS.
- VPS đã có sẵn (Ubuntu 22.04+), bạn có quyền root SSH.
- RunPod account đã verify thanh toán.
- File storage shared dùng **DO Spaces** (S3-compatible) — đơn giản nhất với DO ecosystem.
- Bỏ qua Redis/Valkey ở v1 (worker dùng DB polling, không cần Redis).
- Postgres self-hosted trên VPS (không dùng Managed DB để tiết kiệm $15/tháng).

## Checklist tổng

- [ ] Postgres 16 chạy trên VPS, lấy được `DATABASE_URL`
- [ ] FastAPI HTTP API chạy trên VPS, healthcheck `/health` trả 200
- [ ] FastAPI worker chạy trên RunPod, log có dòng `[worker] started`
- [ ] DO Spaces bucket tạo xong, VPS + RunPod đều rsync/upload được
- [ ] Web deploy Vercel, mở được trang chủ
- [ ] Admin deploy Vercel, login admin được
- [ ] Tạo job dubbing test → VPS nhận upload → RunPod pick up → trả kết quả
- [ ] Desktop app build `.dmg` thành công, cài + login được
- [ ] Desktop app publish lên GitHub Releases, auto-update test OK
