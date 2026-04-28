# 02 — Deploy FastAPI HTTP API lên VPS DigitalOcean

> Mục tiêu: chạy FastAPI ở **API-only mode** trên VPS (không có GPU, không chạy worker). VPS này chỉ phục vụ HTTP request từ web/admin: auth, billing, upload file, queue job vào DB.

## Trước khi bắt đầu

- [01-postgres-vps.md](./01-postgres-vps.md) đã xong, có `DATABASE_URL`
- VPS Ubuntu 22.04+, đã SSH vào root được
- DO Spaces bucket đã tạo (xem [Phụ lục — DO Spaces](#phụ-lục--cài-do-spaces) cuối bài)

## Bước 1 — Code change: thêm `WORKER_ENABLED` flag

Hiện tại [server/app/main.py:67](../../server/app/main.py:67) gọi `start_worker()` không điều kiện. Thêm flag để VPS tắt worker (chỉ chạy HTTP API).

**Sửa file [server/app/main.py](../../server/app/main.py)**, đoạn `lifespan`:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting VoxStudio Server...")
    logger.info("Device: %s | Dtype: %s", DEVICE, DTYPE)
    await init_db()
    await run_migrations()

    # Worker — bật/tắt theo env. VPS API-only: WORKER_ENABLED=false.
    # RunPod GPU: WORKER_ENABLED=true (mặc định).
    import os
    worker_enabled = os.getenv("WORKER_ENABLED", "true").lower() != "false"
    if worker_enabled:
        from app.worker.gpu_worker import start_worker, stop_worker
        start_worker()
        gpu.load_all()
    else:
        logger.info("[lifespan] worker disabled (WORKER_ENABLED=false) — API-only mode")

    # Background TTL cleanup … (giữ nguyên)
    ...

    yield
    logger.info("Shutting down.")
    cleanup_task.cancel()
    if worker_enabled:
        stop_worker()
```

Commit + push code lên Git để VPS pull về.

## Bước 2 — Cài Python 3.11 + ffmpeg trên VPS

VPS không cần CUDA, chỉ cần Python + ffmpeg + libsndfile (cho upload audio).

```bash
ssh root@<VPS_IP>

sudo apt update
sudo apt install -y python3.11 python3.11-venv python3-pip \
    ffmpeg libsndfile1 libsox-fmt-all sox \
    git curl build-essential

python3.11 --version  # 3.11.x
```

## Bước 3 — Clone repo + cài deps

```bash
sudo mkdir -p /opt/voxstudio
sudo chown $USER:$USER /opt/voxstudio
cd /opt/voxstudio

git clone https://github.com/<your-username>/VoxStudio.git .
# Hoặc upload code qua scp/rsync nếu repo private

cd /opt/voxstudio/server
python3.11 -m venv .venv
source .venv/bin/activate

pip install --upgrade pip
pip install -r requirements.txt

# Cài OmniVoice (editable) — vẫn cần để import module, dù không dùng GPU
pip install -e ../OmniVoice-master
```

> **Lưu ý:** Một số deps GPU (`bitsandbytes`, `pyannote.audio`) sẽ cài thành công trên CPU nhưng KHÔNG load model. Đó là OK — VPS không gọi tới chúng vì worker disabled.

## Bước 4 — Tạo file `.env` cho VPS

```bash
nano /opt/voxstudio/server/.env
```

Nội dung:

```ini
# === DB (từ bước 01) ===
DATABASE_URL=postgresql+asyncpg://voxstudio:<PASSWORD>@127.0.0.1:5432/voxstudio

# === Mode ===
WORKER_ENABLED=false      # ⚠️ QUAN TRỌNG: VPS không chạy worker
DEVICE=cpu

# === HTTP ===
HOST=0.0.0.0
PORT=8000
APP_BASE_URL=https://api.voxstudio.app   # hoặc http://<VPS_IP>:8000

# === Auth ===
JWT_SECRET=<openssl rand -base64 32>

# === SMTP (gửi email verify) ===
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=<16-char Gmail App Password>
SMTP_FROM_NAME=VoxStudio

# === Bank info (VietQR) ===
BANK_NAME=Techcombank
BANK_BIN=970407
BANK_ACCOUNT_NO=19034291530012
BANK_ACCOUNT_NAME=NGUYEN VAN A

# === DO Spaces (file storage chia sẻ với RunPod) ===
S3_ENDPOINT=https://sgp1.digitaloceanspaces.com
S3_BUCKET=voxstudio-files
S3_ACCESS_KEY=<DO_SPACES_KEY>
S3_SECRET_KEY=<DO_SPACES_SECRET>
S3_REGION=sgp1

# === Optional ===
# GEMINI_API_KEY=  (chỉ dùng nếu translation cần — worker mới cần thật, VPS không bắt buộc)
# SENTRY_DSN=
# SENTRY_ENV=production
```

Quan trọng:
- `WORKER_ENABLED=false` — VPS chỉ làm HTTP API
- `DEVICE=cpu` — tránh code thử init CUDA và crash
- Full danh sách env vars: xem [07-env-checklist.md](./07-env-checklist.md)

## Bước 5 — Test chạy thủ công

```bash
cd /opt/voxstudio/server
source .venv/bin/activate

python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Mở terminal khác:

```bash
curl http://localhost:8000/health
# → {"status": "loading", "device": "cpu", ...}
# Status có thể "loading" vì gpu.load_all() bị skip — nhưng API vẫn serve được.
```

Test endpoint không-GPU:

```bash
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123"}'
# → 200 + token (nếu DB setup đúng)
```

Stop bằng `Ctrl+C`. Nếu OK → setup systemd ở bước tiếp.

## Bước 6 — Setup systemd (auto-start, auto-restart)

```bash
sudo tee /etc/systemd/system/voxstudio-api.service >/dev/null <<'EOF'
[Unit]
Description=VoxStudio FastAPI (HTTP API mode)
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/voxstudio/server
EnvironmentFile=/opt/voxstudio/server/.env
ExecStart=/opt/voxstudio/server/.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable voxstudio-api
sudo systemctl start voxstudio-api
sudo systemctl status voxstudio-api  # active (running)

# Xem log realtime
sudo journalctl -u voxstudio-api -f
```

> Log nên có dòng: `[lifespan] worker disabled (WORKER_ENABLED=false) — API-only mode`

## Bước 7 — Reverse proxy + HTTPS (Nginx + Certbot)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

# Trỏ DNS api.voxstudio.app → VPS_IP TRƯỚC khi chạy certbot

sudo tee /etc/nginx/sites-available/voxstudio-api >/dev/null <<'EOF'
server {
    listen 80;
    server_name api.voxstudio.app;

    client_max_body_size 500M;   # cho upload video dubbing

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE cho /jobs/<id>/events
        proxy_buffering off;
        proxy_read_timeout 24h;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/voxstudio-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Lấy SSL Let's Encrypt
sudo certbot --nginx -d api.voxstudio.app
```

Test: `curl https://api.voxstudio.app/health` → 200.

## Bước 8 — Firewall

```bash
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP (cho certbot renew)
sudo ufw allow 443/tcp    # HTTPS
sudo ufw allow 5432/tcp   # Postgres (cho RunPod kết nối)
sudo ufw enable
sudo ufw status
```

## Phụ lục — Cài DO Spaces

DO Spaces là S3-compatible storage, $5/tháng cho 250GB.

1. Vào DigitalOcean → **Spaces** → **Create Space**
2. Region: `sgp1` (Singapore — gần VN nhất)
3. Tên: `voxstudio-files`
4. **Settings → Access Keys → Generate New Key** → lưu `Access Key` + `Secret`
5. Test upload bằng `s3cmd` hoặc `aws-cli`:

```bash
sudo apt install -y s3cmd
s3cmd --configure
# Endpoint: sgp1.digitaloceanspaces.com
# DNS-style: %(bucket)s.sgp1.digitaloceanspaces.com
# Access Key + Secret từ bước 4

s3cmd ls s3://voxstudio-files/   # OK
s3cmd put /etc/hostname s3://voxstudio-files/test.txt
s3cmd del s3://voxstudio-files/test.txt
```

> **Quan trọng:** code FastAPI hiện tại đang lưu file local (`server/dubbing_projects/`). Để chia sẻ giữa VPS ↔ RunPod, có 2 cách:
> 1. **rsync mỗi job** — VPS upload file lên Spaces khi job tạo, RunPod download khi pick up. Cần code change.
> 2. **NFS/sshfs mount** — phức tạp, không khuyến nghị.
>
> Phần code change này KHÔNG nằm trong scope tài liệu deploy. Trước mắt, có thể chạy **all-on-RunPod** (xem [03-server-runpod.md](./03-server-runpod.md#alt-all-in-one)) để bỏ qua vấn đề shared storage.

## Checklist hoàn thành

- [ ] Đã sửa `server/app/main.py` thêm flag `WORKER_ENABLED`
- [ ] `systemctl status voxstudio-api` → active (running)
- [ ] Log có dòng `worker disabled — API-only mode`
- [ ] `curl https://api.voxstudio.app/health` → 200
- [ ] `curl https://api.voxstudio.app/api/v1/plans` → trả list plans (sau khi migrate ở bước 06)
- [ ] DO Spaces bucket tạo xong, test upload OK
- [ ] DNS `api.voxstudio.app` đã trỏ về VPS IP

→ Tiếp theo: [03-server-runpod.md](./03-server-runpod.md)
