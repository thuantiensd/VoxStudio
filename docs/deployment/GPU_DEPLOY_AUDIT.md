# VoxStudio — Audit nhanh & hướng dẫn deploy GPU thực tế

Ngày kiểm tra: 2026-04-29.

## Kết luận nhanh

App hiện có 4 phần:

- `server/`: FastAPI API + DB job queue + GPU worker.
- `web/`: Next.js public web, deploy Vercel.
- `admin/`: Next.js admin dashboard, deploy Vercel.
- `desktop/`: Electron app, build binary riêng, trỏ về API qua `VITE_API_URL`.

Backend đã có flag split mode:

- VPS/API: `WORKER_ENABLED=false`, `DEVICE=cpu`.
- GPU/RunPod: `WORKER_ENABLED=true`, `DEVICE=cuda`.

Điểm cần chú ý: code worker hiện tại chia sẻ file với VPS bằng SSH/SCP qua biến `VPS_FILE_HOST`, không phải S3/DO Spaces trực tiếp. Nếu không cấu hình SSH key + `VPS_FILE_HOST`, các job chạy trên RunPod có thể không đọc được file upload từ VPS hoặc không đẩy được file output về VPS để web tải.

## Kết quả kiểm tra local

- `server`: `python3 -m compileall app` pass.
- `admin`: `npm run build` pass.
- `web`: đã bỏ phụ thuộc `next/font/google` để build không cần fetch Google Fonts. Sau sửa, `npm run build` pass khi chạy ngoài sandbox.

## Kiến trúc deploy khuyến nghị

```
web.voxstudio.app / voxstudio.app  -> Vercel project web/
admin.voxstudio.app                -> Vercel project admin/
api.voxstudio.app                  -> VPS FastAPI API-only
RunPod RTX 3090/A10G/L4            -> FastAPI GPU worker
Postgres                           -> VPS, dùng chung bởi API + worker
File sync                          -> SCP VPS <-> RunPod
```

## 1. VPS: Postgres + API-only

Trên VPS Ubuntu 22.04+:

```bash
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3-pip git curl \
  ffmpeg libsndfile1 libsox-fmt-all sox build-essential nginx certbot python3-certbot-nginx
```

Cài Postgres như `docs/deployment/01-postgres-vps.md`, tạo:

```text
DATABASE_URL=postgresql+asyncpg://voxstudio:<PASSWORD>@127.0.0.1:5432/voxstudio
```

Clone và cài server:

```bash
sudo mkdir -p /opt/voxstudio
sudo chown $USER:$USER /opt/voxstudio
cd /opt/voxstudio
git clone https://github.com/<your-user>/VoxStudio.git .
cd server
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
pip install -e ../OmniVoice-master
```

Tạo `/opt/voxstudio/server/.env`:

```ini
WORKER_ENABLED=false
DEVICE=cpu
DATABASE_URL=postgresql+asyncpg://voxstudio:<PASSWORD>@127.0.0.1:5432/voxstudio
HOST=0.0.0.0
PORT=8000
APP_BASE_URL=https://api.voxstudio.app
JWT_SECRET=<same-secret-as-runpod>
ADMIN_EMAILS=admin@voxstudio.app

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<email>
SMTP_PASS=<gmail-app-password>
SMTP_FROM_NAME=VoxStudio

BANK_NAME=<bank>
BANK_BIN=<bin>
BANK_ACCOUNT_NO=<account>
BANK_ACCOUNT_NAME=<name>
```

Systemd:

```ini
[Unit]
Description=VoxStudio FastAPI API
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/voxstudio/server
EnvironmentFile=/opt/voxstudio/server/.env
ExecStart=/opt/voxstudio/server/.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable voxstudio-api
sudo systemctl start voxstudio-api
curl http://127.0.0.1:8000/health
```

Nginx reverse proxy `api.voxstudio.app` về `127.0.0.1:8000`, `client_max_body_size 500M`, rồi chạy Certbot.

## 2. RunPod: GPU worker

Chọn image:

```text
runpod/pytorch:2.4.0-py3.11-cuda12.1.1-devel-ubuntu22.04
```

Mount network volume vào `/workspace`.

Trong Pod:

```bash
apt update
apt install -y git curl ffmpeg libsndfile1 libsox-fmt-all sox build-essential openssh-client
cd /workspace
git clone https://github.com/<your-user>/VoxStudio.git
cd VoxStudio/server
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
pip install -e ../OmniVoice-master
```

Tạo `/workspace/VoxStudio/server/.env`:

```ini
WORKER_ENABLED=true
DEVICE=cuda
DATABASE_URL=postgresql+asyncpg://voxstudio:<PASSWORD>@<VPS_PUBLIC_IP>:5432/voxstudio
JWT_SECRET=<same-secret-as-vps>
HOST=0.0.0.0
PORT=8000

USE_FASTER_WHISPER=true
FASTER_WHISPER_MODEL=large-v3-turbo
WHISPER_MODEL=openai/whisper-large-v3-turbo
TTS_MODEL=k2-fsa/OmniVoice
HF_HOME=/workspace/hf_cache
TRANSFORMERS_CACHE=/workspace/hf_cache
HF_TOKEN=<hf-token-if-using-pyannote>
DIARIZE_BACKEND=resemblyzer

DUBBING_PROJECTS_DIR=/workspace/dubbing_projects
VOICES_DIR=/workspace/voices
AUDIO_OUTPUT_DIR=/workspace/audio_output

VPS_FILE_HOST=root@<VPS_PUBLIC_IP>
```

Thiết lập SSH để RunPod đọc/ghi file trên VPS:

```bash
ssh-keygen -t ed25519 -f /root/.ssh/id_ed25519 -N ""
cat /root/.ssh/id_ed25519.pub
```

Copy public key trên vào VPS:

```bash
mkdir -p /root/.ssh
nano /root/.ssh/authorized_keys
chmod 700 /root/.ssh
chmod 600 /root/.ssh/authorized_keys
```

Test từ RunPod:

```bash
ssh -o StrictHostKeyChecking=no -i /root/.ssh/id_ed25519 root@<VPS_PUBLIC_IP> "echo ok"
```

Mở Postgres trên VPS cho IP RunPod trong `pg_hba.conf`, rồi reload Postgres.

Chạy worker:

```bash
cd /workspace/VoxStudio/server
source .venv/bin/activate
set -a
source .env
set +a
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Log cần thấy:

```text
Device: cuda | Worker: enabled
[worker] started
[gpu] ...
```

## 3. Web và Admin

Deploy 2 project Vercel riêng:

- Project `voxstudio-web`, root directory `web`.
- Project `voxstudio-admin`, root directory `admin`.

Env cho cả 2:

```ini
NEXT_PUBLIC_API_URL=https://api.voxstudio.app
```

Admin nên đặt sau Cloudflare Access hoặc Vercel Deployment Protection.

## 4. Smoke test bắt buộc

```bash
curl https://api.voxstudio.app/health
```

Kỳ vọng VPS:

```json
{"status":"ok","device":"cpu","mode":"api-only"}
```

Test login/register từ web, login admin từ admin web.

Test GPU:

1. Upload file và gọi STT/TTS/dubbing từ app.
2. Trên RunPod log phải có `[worker] picked ...`.
3. Job trong DB chuyển `pending -> running -> done`.
4. File output tải được từ `https://api.voxstudio.app/...`.

## Rủi ro còn lại trước production lớn

- SSE realtime giữa VPS và RunPod hiện dùng in-memory event bus, nên progress stream qua VPS không nhận event trực tiếp từ worker ở RunPod. Endpoint sync vẫn có thể hoàn tất nhờ polling DB, nhưng auto-dub SSE có nguy cơ chỉ đứng ở trạng thái queued/running. Nên chuyển SSE sang polling DB hoặc dùng Redis pub/sub nếu muốn realtime chuẩn.
- File sharing đang dùng SCP. Chạy được cho v1, nhưng khi nhiều job/video lớn nên chuyển sang S3/DO Spaces thật sự hoặc mount shared storage ổn định.
- `server/docker-compose.yml` còn thiên về single-node GPU và có `REDIS_URL`, `STRIPE_SECRET_KEY`, `CLERK_SECRET_KEY` không thấy code hiện tại dùng trực tiếp. Deploy theo systemd/RunPod ở trên sẽ sát code hơn.
