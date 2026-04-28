# 03 — Deploy GPU Worker lên RunPod 3090

> Mục tiêu: chạy FastAPI ở **worker-only mode** trên RunPod 3090. Pod chỉ poll DB của VPS, pick job pending, chạy GPU model (Whisper/OmniVoice/diarize), trả kết quả.

## Trước khi bắt đầu

- [01-postgres-vps.md](./01-postgres-vps.md) đã xong, có `DATABASE_URL` (trỏ về VPS IP)
- [02-server-vps.md](./02-server-vps.md) đã xong, code đã có flag `WORKER_ENABLED`
- RunPod account đã verify thanh toán
- Đã có DO Spaces bucket (xem [02-server-vps.md](./02-server-vps.md#phụ-lục--cài-do-spaces))

## Bước 1 — Tạo Network Volume (persistent storage)

> **Tại sao:** Pod RunPod là ephemeral — Pod stop/restart sẽ MẤT hết file local. Network Volume là disk persistent, mount vào Pod, không mất khi restart.

1. RunPod dashboard → **Storage** → **+ New Network Volume**
2. Tên: `voxstudio-vol`
3. Datacenter: chọn cùng region với GPU 3090 bạn định thuê (vd `EU-RO-1`)
4. Size: **50 GB** (đủ cho HF cache 20GB + dubbing projects 30GB)
5. Tạo xong → ghi nhớ tên volume

## Bước 2 — Deploy Pod RTX 3090

1. **Pods → Deploy** → chọn **RTX 3090** (24GB VRAM, $0.34/h)
2. **Network Volume**: chọn `voxstudio-vol` đã tạo, mount path `/workspace`
3. **Container Image**: dùng template official:
   - `runpod/pytorch:2.4.0-py3.11-cuda12.1.1-devel-ubuntu22.04`
   - Hoặc nếu có Dockerfile riêng đã push lên Docker Hub: dùng image đó
4. **Container Disk**: 20 GB (cho OS + Python deps, không cần lớn)
5. **Expose HTTP Ports**: 8000 (chỉ để debug, không expose ra internet thật vì worker không cần API)
6. **Expose TCP Ports**: 22 (SSH)
7. **Environment Variables**: bấm "Add Environment Variables" — set hết vars ở bước 4
8. Bấm **Deploy On-Demand** (rẻ hơn Spot, ổn định hơn)

> **Tip pricing:** Spot Pod rẻ hơn ~30% nhưng có thể bị evict bất cứ lúc nào → mất job đang chạy. On-Demand đắt hơn nhưng ổn định.

## Bước 3 — SSH vào Pod + setup

```bash
# Từ dashboard, copy SSH command (vd):
ssh root@<pod-id>.proxy.runpod.net -p <port> -i ~/.ssh/id_ed25519

# Vào trong Pod:
cd /workspace
git clone https://github.com/<your-username>/VoxStudio.git
cd VoxStudio/server

# Cài deps (image runpod/pytorch đã có Python 3.11 + CUDA)
pip install -r requirements.txt
pip install -e ../OmniVoice-master

# Cài ffmpeg + audio libs nếu image base chưa có
apt update && apt install -y ffmpeg libsndfile1 libsox-fmt-all sox
```

## Bước 4 — Tạo `.env` cho RunPod

```bash
cat > /workspace/VoxStudio/server/.env <<'EOF'
# === DB (trỏ về VPS Postgres) ===
DATABASE_URL=postgresql+asyncpg://voxstudio:<PASSWORD>@<VPS_PUBLIC_IP>:5432/voxstudio

# === Mode ===
WORKER_ENABLED=true        # ⚠️ QUAN TRỌNG: RunPod chạy worker
DEVICE=cuda

# === Models ===
USE_FASTER_WHISPER=true
FASTER_WHISPER_MODEL=large-v3-turbo
TTS_MODEL=k2-fsa/OmniVoice
WHISPER_MODEL=openai/whisper-large-v3-turbo

# === HF cache (dùng Network Volume để persist) ===
HF_HOME=/workspace/hf_cache
TRANSFORMERS_CACHE=/workspace/hf_cache
HF_TOKEN=<huggingface_token>   # cần để pull pyannote (gated model)

# === HTTP (worker mode không expose, nhưng FastAPI vẫn cần PORT) ===
HOST=0.0.0.0
PORT=8000

# === Auth (giống VPS — JWT_SECRET phải KHỚP để verify token) ===
JWT_SECRET=<SAME_AS_VPS>

# === Storage path (trên Network Volume) ===
DUBBING_PROJECTS_DIR=/workspace/dubbing_projects
VOICES_DIR=/workspace/voices
AUDIO_OUTPUT_DIR=/workspace/audio_output

# === Optional: LLM translation ===
GEMINI_API_KEY=<key>
LLM_MODEL=Qwen/Qwen2.5-7B-Instruct

# === DO Spaces (để rsync file giữa VPS ↔ RunPod) ===
S3_ENDPOINT=https://sgp1.digitaloceanspaces.com
S3_BUCKET=voxstudio-files
S3_ACCESS_KEY=<DO_SPACES_KEY>
S3_SECRET_KEY=<DO_SPACES_SECRET>
S3_REGION=sgp1

# === Sentry (optional) ===
# SENTRY_DSN=
EOF
```

> ⚠️ `JWT_SECRET` PHẢI giống VPS — nếu khác, token user tạo ở VPS sẽ không verify được ở RunPod (mặc dù worker không verify token, để dự phòng).

## Bước 5 — Pre-warm models (lần đầu — mất 10-15 phút)

Tải model về Network Volume để Pod restart không phải tải lại.

```bash
mkdir -p /workspace/hf_cache /workspace/dubbing_projects /workspace/voices /workspace/audio_output

cd /workspace/VoxStudio/server
source <(grep -v '^#' .env | sed 's/^/export /')

python -c "
from huggingface_hub import snapshot_download
snapshot_download('openai/whisper-large-v3-turbo')
snapshot_download('k2-fsa/OmniVoice')
print('✓ Models cached')
"
```

> Pyannote diarization model là gated — cần `HF_TOKEN` đã accept license tại https://huggingface.co/pyannote/speaker-diarization-3.1.

## Bước 6 — Whitelist RunPod IP về Postgres VPS

Lấy public IP của Pod:

```bash
curl -s ifconfig.me
# → 1.2.3.4
```

Sửa whitelist trên VPS:

```bash
# Trên VPS:
sudo nano /etc/postgresql/16/main/pg_hba.conf
# Đổi dòng "0.0.0.0/0" thành IP RunPod cụ thể:
# host    voxstudio    voxstudio    1.2.3.4/32    scram-sha-256
sudo systemctl reload postgresql
```

> RunPod IP **có thể đổi khi restart Pod**. Nếu thường xuyên restart, có thể giữ `0.0.0.0/0` + dùng password mạnh, hoặc setup VPN/Tailscale (nâng cao).

## Bước 7 — Test worker chạy thủ công

```bash
cd /workspace/VoxStudio/server
source .venv/bin/activate 2>/dev/null || true   # nếu dùng venv
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Log mong đợi:

```
Starting VoxStudio Server...
Device: cuda | Dtype: ...
[migrations] OK
[worker] registered handler: dubbing
[worker] registered handler: tts
[worker] registered handler: transcribe
[worker] started
[gpu] loading whisper-large-v3-turbo...
[gpu] loading OmniVoice...
[gpu] ✓ ready
```

Trên VPS, tạo job test (cần user + token có sẵn):

```bash
# Trên VPS hoặc máy local có token:
curl -X POST https://api.voxstudio.app/api/v1/transcribe \
  -H "Authorization: Bearer <TOKEN>" \
  -F "file=@/path/to/audio.mp3"
# → trả job_id
```

Trên RunPod log nên thấy:

```
[worker] picked <job_id> kind=transcribe user=1
[worker] ✓ job <job_id> (transcribe)
```

## Bước 8 — Auto-start khi Pod khởi động

RunPod Pod re-run command mỗi lần start. Set **Container Start Command** trong Pod settings:

```bash
cd /workspace/VoxStudio/server && \
  source <(grep -v '^#' .env | sed 's/^/export /') && \
  python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 2>&1 | tee /workspace/worker.log
```

Hoặc setup supervisord để auto-restart khi crash:

```bash
apt install -y supervisor
cat > /etc/supervisor/conf.d/voxstudio-worker.conf <<'EOF'
[program:voxstudio-worker]
command=/usr/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
directory=/workspace/VoxStudio/server
environment=PATH="/workspace/VoxStudio/server/.venv/bin:%(ENV_PATH)s"
autorestart=true
stderr_logfile=/workspace/worker.err.log
stdout_logfile=/workspace/worker.out.log
EOF
supervisorctl reread
supervisorctl update
supervisorctl start voxstudio-worker
```

<a id="alt-all-in-one"></a>
## Alt: All-in-one (nếu chưa muốn split CPU/GPU)

Nếu chưa setup được file sharing VPS↔RunPod, **bỏ qua VPS** và chạy **mọi thứ trên RunPod** (đơn giản hơn, không cần code change shared storage):

1. Bỏ qua [02-server-vps.md](./02-server-vps.md), chỉ giữ Postgres trên VPS
2. RunPod `.env`: set `WORKER_ENABLED=true` (mặc định) — FastAPI chạy cả HTTP API + worker
3. Mở port 8000 trên RunPod (HTTP Service) → URL: `https://<pod-id>-8000.proxy.runpod.net`
4. Web/Admin Vercel set `NEXT_PUBLIC_API_URL=https://<pod-id>-8000.proxy.runpod.net`
5. CORS: code đã `allow_origins=["*"]` nên OK

Nhược điểm: Pod 3090 phải always-on → tốn $245/tháng. Lợi: zero code change.

## <a id="code-change"></a>Tóm tắt code change cần làm

Chỉ 1 file: [server/app/main.py](../../server/app/main.py)

```diff
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting VoxStudio Server...")
    logger.info("Device: %s | Dtype: %s", DEVICE, DTYPE)
    await init_db()
    await run_migrations()
-   from app.worker.gpu_worker import start_worker, stop_worker
-   start_worker()
-   gpu.load_all()
+   import os
+   worker_enabled = os.getenv("WORKER_ENABLED", "true").lower() != "false"
+   if worker_enabled:
+       from app.worker.gpu_worker import start_worker, stop_worker
+       start_worker()
+       gpu.load_all()
+   else:
+       logger.info("[lifespan] worker disabled — API-only mode")

    ...

    yield
    logger.info("Shutting down.")
    cleanup_task.cancel()
-   stop_worker()
+   if worker_enabled:
+       stop_worker()
```

## Checklist hoàn thành

- [ ] Network Volume `voxstudio-vol` (50GB) tạo xong
- [ ] Pod RTX 3090 deploy xong, mount Volume vào `/workspace`
- [ ] SSH vào Pod được, repo cloned vào `/workspace/VoxStudio`
- [ ] Models pre-warm xong: `ls /workspace/hf_cache/hub/` → có whisper-large-v3-turbo, OmniVoice
- [ ] Postgres VPS đã whitelist RunPod IP
- [ ] Worker log có dòng `[worker] started` + `[gpu] ✓ ready`
- [ ] Tạo job test → worker pick up → trả kết quả OK
- [ ] Supervisord/start-command auto-restart khi crash

→ Tiếp theo: [04-web-vercel.md](./04-web-vercel.md)
