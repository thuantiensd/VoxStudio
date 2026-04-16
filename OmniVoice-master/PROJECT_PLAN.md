# OmniVoice Studio — MVP Plan

## Mục tiêu
App TTS + STT thương mại chạy trên Mac/Win, model chạy trên server GPU.

---

## Kiến trúc

```
Desktop App (Electron)  ←→  Server API (FastAPI)  ←→  GPU (1 con)
     Mac/Win                   localhost:8000           Whisper + OmniVoice
```

- Dev: chạy local trên M1 Pro 16GB ($0)
- Production: 1 GPU 24GB (Vast.ai/RunPod ~$200-300/tháng)

---

## PHASE 1: Server API ← LÀM TRƯỚC

### 1.1 Project setup
- [ ] Tạo project structure (FastAPI)
- [ ] Config (device auto-detect: CUDA/MPS/CPU)
- [ ] Docker setup (dev + prod)

### 1.2 Whisper Service (STT)
- [ ] POST /api/v1/transcribe — upload audio → text
- [ ] POST /api/v1/detect-language — detect ngôn ngữ
- [ ] Hỗ trợ: wav, mp3, flac
- [ ] Trả về: text + segments (timestamps)

### 1.3 TTS Service (OmniVoice)
- [ ] POST /api/v1/tts/generate — text + voice_id → audio
- [ ] POST /api/v1/tts/generate-stream — streaming audio (WebSocket)
- [ ] GET /api/v1/voices — danh sách voices đã lưu
- [ ] POST /api/v1/voices/clone — upload audio → tạo voice mới
- [ ] DELETE /api/v1/voices/{id} — xoá voice
- [ ] GET /api/v1/voices/{id}/preview — nghe thử voice

### 1.4 GPU Manager
- [ ] Load Whisper + OmniVoice chung 1 GPU
- [ ] Thread-safe (lock khi inference)
- [ ] Auto-detect device (CUDA/MPS/CPU)

### 1.5 Auth & User
- [ ] POST /api/v1/auth/register
- [ ] POST /api/v1/auth/login → JWT token
- [ ] API key cho mỗi user
- [ ] Rate limit

### 1.6 Database
- [ ] Dev: SQLite (không cần Docker)
- [ ] Prod: PostgreSQL
- [ ] Tables: users, voices, history, usage

### 1.7 Storage
- [ ] Dev: local filesystem (voices/, audio/)
- [ ] Prod: S3-compatible (MinIO hoặc AWS S3)

---

## PHASE 2: Desktop App

### 2.1 Project setup
- [ ] Electron + React + TypeScript + TailwindCSS
- [ ] electron-builder (Mac .dmg, Win .exe)
- [ ] Auto-update (electron-updater)

### 2.2 Màn hình TTS (chính)
- [ ] Chọn voice từ thư viện
- [ ] Nhập text → Generate → Play/Download
- [ ] Settings: speed, steps, denoise
- [ ] Export: WAV, MP3
- [ ] Hiển thị waveform

### 2.3 Màn hình Voice Clone
- [ ] Upload audio / ghi âm trực tiếp
- [ ] Whisper tự nhận dạng → hiện Reference Text
- [ ] Preview voice → Save với tên + tags
- [ ] Step-by-step UI (upload → transcribe → preview → save)

### 2.4 Màn hình Voice Library
- [ ] Grid view: avatar + tên + ngôn ngữ
- [ ] Filter: nam/nữ, ngôn ngữ, tags
- [ ] Search
- [ ] Preview voice
- [ ] Delete/Edit voice
- [ ] Preset voices (sẵn vài giọng mặc định)

### 2.5 Màn hình Batch TTS
- [ ] Import file (.txt, .csv, .srt)
- [ ] Nhập nhiều dòng text
- [ ] Chọn 1 voice → generate all
- [ ] Progress bar cho từng dòng
- [ ] Download all (.zip)

### 2.6 Màn hình History
- [ ] Danh sách audio đã tạo (theo ngày)
- [ ] Play / Download / Re-generate / Delete
- [ ] Search + filter

### 2.7 Màn hình Settings
- [ ] Account info + API key
- [ ] Audio settings (format, sample rate, speed)
- [ ] Server URL + connection status
- [ ] Theme (dark/light)
- [ ] Language (VI/EN)

### 2.8 Audio Player Bar
- [ ] Luôn hiện ở dưới cùng
- [ ] Play/Pause, seek, volume
- [ ] Export button

---

## PHASE 3: Deploy Production

- [ ] Thuê GPU server (Vast.ai hoặc RunPod)
- [ ] Deploy server + Dockerfile
- [ ] Domain + SSL (nginx)
- [ ] Database: PostgreSQL
- [ ] Storage: S3
- [ ] Monitoring + logging

---

## PHASE 4: Mở rộng (sau khi có user)

- [ ] Video Dubbing (tách audio + dịch + TTS + ghép video)
- [ ] Thêm Qwen2.5-Omni (chatbot, dịch thuật, tạo script)
- [ ] Audiobook creator
- [ ] Podcast generator
- [ ] Voice chat realtime
- [ ] Auto subtitle
- [ ] Thanh toán (Stripe)
- [ ] Multi-GPU scale

---

## Tech Stack

| Phần       | Công nghệ                              |
|------------|----------------------------------------|
| Server     | Python, FastAPI, SQLAlchemy, Celery     |
| AI Models  | Whisper (STT), OmniVoice (TTS)         |
| Database   | SQLite (dev) / PostgreSQL (prod)       |
| Cache      | Redis                                   |
| Storage    | Local (dev) / S3 (prod)                |
| Desktop    | Electron, React, TypeScript, Tailwind  |
| Build      | electron-builder (Mac .dmg, Win .exe)  |
| Deploy     | Docker, nginx, Vast.ai/RunPod          |

---

## Chi phí

| Giai đoạn | Chi phí/tháng        |
|-----------|---------------------|
| Dev       | $0 (local M1 Pro)   |
| Test GPU  | ~$10-20 (vài giờ)   |
| Production| ~$200-300 (24/7 GPU)|

---

## Thứ tự ưu tiên

1. ✅ Server API (Whisper + OmniVoice)
2. ✅ Desktop App (Electron)
3. ✅ Deploy lên GPU cloud
4. 🔜 Video Dubbing + thêm AI features
