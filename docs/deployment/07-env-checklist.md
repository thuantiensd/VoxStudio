# 07 — Master Env Vars Checklist

> Bảng tham chiếu tất cả env vars cần thiết cho 4 môi trường deploy. Dùng để cross-check khi setup.

## Bảng master

| Env Var | Web (Vercel) | Admin (Vercel) | Desktop (Electron) | Server VPS | Server RunPod | Mô tả |
|---|:---:|:---:|:---:|:---:|:---:|---|
| **`NEXT_PUBLIC_API_URL`** | ✅ | ✅ | — | — | — | URL public API (`https://api.voxstudio.app`) |
| **`VITE_API_URL`** | — | — | ✅ | — | — | URL API cho desktop, **inline vào binary khi build** |
| **`VITE_SENTRY_DSN`** | — | — | (opt) | — | — | Sentry DSN cho desktop crash report |
| **`GH_TOKEN`** | — | — | ✅ (CI) | — | — | GitHub PAT để publish release qua `electron-builder --publish` |
| **`APPLE_ID`** | — | — | ✅ (build) | — | — | Apple ID để notarize macOS .dmg |
| **`APPLE_APP_SPECIFIC_PASSWORD`** | — | — | ✅ (build) | — | — | App-specific password từ appleid.apple.com |
| **`APPLE_TEAM_ID`** | — | — | ✅ (build) | — | — | Team ID từ Apple Developer portal |
| **`CSC_LINK`** | — | — | ✅ (build win) | — | — | Path file `.pfx` Windows code signing cert |
| **`CSC_KEY_PASSWORD`** | — | — | ✅ (build win) | — | — | Password của file `.pfx` |
| **`DATABASE_URL`** | — | — | — | ✅ | ✅ | `postgresql+asyncpg://voxstudio:PASS@VPS_IP:5432/voxstudio` |
| **`WORKER_ENABLED`** | — | — | — | `false` | `true` | VPS API-only, RunPod chạy worker |
| **`DEVICE`** | — | — | — | `cpu` | `cuda` | Backend inference device |
| **`JWT_SECRET`** | — | — | — | ✅ | ✅ | 32+ chars random, **PHẢI GIỐNG NHAU** giữa VPS và RunPod |
| **`HOST`** | — | — | — | `0.0.0.0` | `0.0.0.0` | Bind interface |
| **`PORT`** | — | — | — | `8000` | `8000` | HTTP port |
| **`APP_BASE_URL`** | — | — | — | ✅ | ✅ | URL public (cho link verify email): `https://api.voxstudio.app` |
| **`ADMIN_EMAILS`** | — | — | — | ✅ | — | Comma-separated, auto promote thành admin khi startup |
| **`SMTP_HOST`** | — | — | — | ✅ | (✓) | Gmail: `smtp.gmail.com` |
| **`SMTP_PORT`** | — | — | — | ✅ | (✓) | `587` |
| **`SMTP_USER`** | — | — | — | ✅ | (✓) | Gmail address |
| **`SMTP_PASS`** | — | — | — | ✅ | (✓) | 16-char Gmail App Password |
| **`SMTP_FROM_NAME`** | — | — | — | ✅ | (✓) | `VoxStudio` |
| **`BANK_NAME`** | — | — | — | ✅ | — | `Techcombank` |
| **`BANK_BIN`** | — | — | — | ✅ | — | `970407` (Techcombank), xem [vietqr.io](https://www.vietqr.io/danh-sach-api/danh-sach-ngan-hang/) |
| **`BANK_ACCOUNT_NO`** | — | — | — | ✅ | — | Số tài khoản |
| **`BANK_ACCOUNT_NAME`** | — | — | — | ✅ | — | `NGUYEN VAN A` (chữ HOA, không dấu) |
| **`HF_TOKEN`** | — | — | — | — | ✅ | Token HuggingFace, cần để pull pyannote (gated) |
| **`HF_HOME`** | — | — | — | — | `/workspace/hf_cache` | Path Network Volume |
| **`USE_FASTER_WHISPER`** | — | — | — | — | `true` | Faster-whisper thay vì OpenAI Whisper |
| **`FASTER_WHISPER_MODEL`** | — | — | — | — | `large-v3-turbo` | Model size |
| **`TTS_MODEL`** | — | — | — | — | `k2-fsa/OmniVoice` | TTS model HF repo |
| **`WHISPER_MODEL`** | — | — | — | — | `openai/whisper-large-v3-turbo` | STT model |
| **`LLM_MODEL`** | — | — | — | — | `Qwen/Qwen2.5-7B-Instruct` | Local LLM (optional) |
| **`GEMINI_API_KEY`** | — | — | — | — | ✅ | Gemini API key cho translation |
| **`DUBBING_PROJECTS_DIR`** | — | — | — | — | `/workspace/dubbing_projects` | Path file dubbing |
| **`VOICES_DIR`** | — | — | — | — | `/workspace/voices` | Path voice clones |
| **`AUDIO_OUTPUT_DIR`** | — | — | — | — | `/workspace/audio_output` | Path TTS output |
| **`S3_ENDPOINT`** | — | — | — | ✅ | ✅ | DO Spaces endpoint: `https://sgp1.digitaloceanspaces.com` |
| **`S3_BUCKET`** | — | — | — | ✅ | ✅ | `voxstudio-files` |
| **`S3_ACCESS_KEY`** | — | — | — | ✅ | ✅ | DO Spaces key |
| **`S3_SECRET_KEY`** | — | — | — | ✅ | ✅ | DO Spaces secret |
| **`S3_REGION`** | — | — | — | ✅ | ✅ | `sgp1` |
| **`SENTRY_DSN`** | — | — | (opt) | (opt) | (opt) | Error tracking, optional (xem `VITE_SENTRY_DSN` cho desktop) |
| **`SENTRY_ENV`** | — | — | — | (opt) | (opt) | `production` |
| **`SENTRY_RELEASE`** | — | — | — | (opt) | (opt) | `voxstudio-server@0.1.0` |

**Chú thích:**
- ✅ = bắt buộc
- — = không cần
- (✓) = optional (chỉ khi RunPod cần gửi email — hiện chỉ VPS gửi)
- (opt) = optional

## Template `.env` cho từng môi trường

### VPS DigitalOcean — `/opt/voxstudio/server/.env`

```ini
# Mode
WORKER_ENABLED=false
DEVICE=cpu

# DB (chính VPS này)
DATABASE_URL=postgresql+asyncpg://voxstudio:CHANGE_ME@127.0.0.1:5432/voxstudio

# HTTP
HOST=0.0.0.0
PORT=8000
APP_BASE_URL=https://api.voxstudio.app

# Auth (sync với RunPod)
JWT_SECRET=CHANGE_ME_32_CHARS_BASE64
ADMIN_EMAILS=admin@voxstudio.app

# SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=admin@voxstudio.app
SMTP_PASS=CHANGE_ME_16_CHARS
SMTP_FROM_NAME=VoxStudio

# Bank
BANK_NAME=Techcombank
BANK_BIN=970407
BANK_ACCOUNT_NO=19034291530012
BANK_ACCOUNT_NAME=NGUYEN VAN A

# DO Spaces
S3_ENDPOINT=https://sgp1.digitaloceanspaces.com
S3_BUCKET=voxstudio-files
S3_ACCESS_KEY=CHANGE_ME
S3_SECRET_KEY=CHANGE_ME
S3_REGION=sgp1

# Optional
# SENTRY_DSN=
# SENTRY_ENV=production
```

### RunPod 3090 — `/workspace/VoxStudio/server/.env`

```ini
# Mode
WORKER_ENABLED=true
DEVICE=cuda

# DB (trỏ về VPS)
DATABASE_URL=postgresql+asyncpg://voxstudio:CHANGE_ME@<VPS_PUBLIC_IP>:5432/voxstudio

# HTTP (worker không expose nhưng FastAPI cần)
HOST=0.0.0.0
PORT=8000

# Auth (PHẢI GIỐNG VPS!)
JWT_SECRET=SAME_AS_VPS

# Models
USE_FASTER_WHISPER=true
FASTER_WHISPER_MODEL=large-v3-turbo
TTS_MODEL=k2-fsa/OmniVoice
WHISPER_MODEL=openai/whisper-large-v3-turbo
HF_HOME=/workspace/hf_cache
HF_TOKEN=hf_CHANGE_ME

# LLM (optional)
GEMINI_API_KEY=CHANGE_ME
LLM_MODEL=Qwen/Qwen2.5-7B-Instruct

# Storage paths (Network Volume)
DUBBING_PROJECTS_DIR=/workspace/dubbing_projects
VOICES_DIR=/workspace/voices
AUDIO_OUTPUT_DIR=/workspace/audio_output

# DO Spaces (sync với VPS)
S3_ENDPOINT=https://sgp1.digitaloceanspaces.com
S3_BUCKET=voxstudio-files
S3_ACCESS_KEY=CHANGE_ME
S3_SECRET_KEY=CHANGE_ME
S3_REGION=sgp1

# Optional
# SENTRY_DSN=
```

### Vercel — `voxstudio-web` & `voxstudio-admin`

Set trong Vercel UI (Settings → Environment Variables):

```
NEXT_PUBLIC_API_URL=https://api.voxstudio.app
```

Đó là TẤT CẢ. Web/admin không cần secret nào khác — auth qua API.

### Desktop — `desktop/.env.production`

Vite inline biến `VITE_*` vào binary khi build:

```ini
VITE_API_URL=https://api.voxstudio.app
VITE_SENTRY_DSN=https://xxxx@sentry.io/yyyy   # optional
```

Build-time secrets (KHÔNG vào file `.env`, set ở shell trước khi `npm run build:mac`):

```bash
# GitHub publish
export GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# macOS notarization
export APPLE_ID=your@apple.id
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
export APPLE_TEAM_ID=ABCDE12345

# Windows code signing
export CSC_LINK=/path/to/cert.pfx
export CSC_KEY_PASSWORD=cert_password
```

## Sinh secret an toàn

```bash
# JWT_SECRET (32 byte base64)
openssl rand -base64 32

# DB password
openssl rand -base64 24 | tr -d '/+='

# DO Spaces — không tự sinh, tạo qua DO dashboard
```

## Cross-check trước khi go-live

Trước khi cho user thật vào, chạy script verify:

```bash
# Trên VPS
cd /opt/voxstudio/server
source .env
echo "=== VPS env check ==="
echo "WORKER_ENABLED: $WORKER_ENABLED (phải là 'false')"
echo "DEVICE: $DEVICE (phải là 'cpu')"
echo "DATABASE_URL set: $([ -n "$DATABASE_URL" ] && echo YES || echo NO)"
echo "JWT_SECRET length: ${#JWT_SECRET}"
echo "SMTP_PASS set: $([ -n "$SMTP_PASS" ] && echo YES || echo NO)"
echo "BANK_BIN: $BANK_BIN"
```

```bash
# Trên RunPod
cd /workspace/VoxStudio/server
source <(grep -v '^#' .env | sed 's/^/export /')
echo "=== RunPod env check ==="
echo "WORKER_ENABLED: $WORKER_ENABLED (phải là 'true')"
echo "DEVICE: $DEVICE (phải là 'cuda')"
echo "JWT_SECRET length: ${#JWT_SECRET} (phải = VPS)"
nvidia-smi  # phải thấy 3090
```

## Checklist hoàn thành

- [ ] VPS `.env` đầy đủ env bắt buộc, `WORKER_ENABLED=false`, `DEVICE=cpu`
- [ ] RunPod `.env` đầy đủ, `WORKER_ENABLED=true`, `DEVICE=cuda`
- [ ] `JWT_SECRET` GIỐNG NHAU giữa VPS và RunPod
- [ ] `DATABASE_URL` cùng trỏ về 1 Postgres VPS
- [ ] DO Spaces credentials set ở cả 2 server
- [ ] Vercel web + admin: set `NEXT_PUBLIC_API_URL=https://api.voxstudio.app`
- [ ] `.env` files **KHÔNG commit lên Git** (kiểm tra `.gitignore`)
- [ ] Secrets đã backup vào 1Password / password manager
