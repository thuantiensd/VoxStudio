# VoxStudio AI

> Lồng tiếng AI chuyên nghiệp · Local-first · Multi-platform

VoxStudio là bộ công cụ AI dubbing/TTS gồm 4 thành phần kết hợp: desktop app
(Electron), backend GPU server (FastAPI), website public (Next.js), và admin
dashboard (Next.js). Hỗ trợ voice cloning đa ngôn ngữ qua engine Vox Premium.

---

## Architecture

```
                         ┌─────────────────┐
                         │   web (Next.js) │   Public website + checkout
                         │   :3000         │   ─→ payments, auth, marketing
                         └────────┬────────┘
                                  │
                                  ▼
        ┌──────────────────────────────────────────┐
        │   server (FastAPI + Postgres + Redis)    │
        │   :8000 — GPU TTS/STT/dubbing pipeline   │
        └────┬─────────────────────────────┬───────┘
             │                             │
             │ ─→ uses ─→                  │
             ▼                             ▼
   ┌─────────────────────┐    ┌────────────────────────┐
   │ voxstudio-engine    │    │ admin (Next.js)        │
   │ (TTS, voice clone,  │    │ :3001 — manage users,  │
   │  Apache 2.0)        │    │ payments, voices       │
   └─────────────────────┘    └────────────────────────┘

        ┌─────────────────────────────────┐
        │   desktop (Electron + React)    │   User-facing app
        │   ─→ talks to server via API    │   Dubbing studio · TTS · STT
        └─────────────────────────────────┘
```

---

## Components

| Folder | Stack | Port | Purpose |
|---|---|---|---|
| **`desktop/`** | Electron · React · Vite | — | Cross-platform desktop app (Mac/Win/Linux) |
| **`server/`** | FastAPI · SQLAlchemy · Postgres · Redis | 8000 | GPU TTS/STT/dubbing API + worker queue |
| **`web/`** | Next.js · TypeScript · Tailwind | 3000 | Public site, billing, OAuth |
| **`admin/`** | Next.js · TypeScript · Tailwind | 3001 | Internal dashboard for support/ops |
| **`voxstudio-engine/`** | Python · PyTorch · CUDA | — | TTS engine (zero-shot multilingual, 600+ langs) |
| **`docs/`** | Markdown | — | Deployment guides, legal (ToS, Privacy) |

---

## Quick start (dev)

### Prerequisites
- macOS / Linux (Windows partial support)
- Node.js 22+
- Python 3.11+
- (Optional GPU) CUDA 12.1+ for Vox Premium engine

### Backend server
```bash
cd server
cp .env.example .env       # edit DB / API keys
pip install -r requirements.txt
pip install -e ../voxstudio-engine    # local TTS engine
uvicorn app.main:app --reload --port 8000
```

### Desktop app
```bash
cd desktop
npm install
npm run dev                # opens Electron window + Vite at :5174
```

### Web (marketing site)
```bash
cd web
npm install
npm run dev                # http://localhost:3000
```

### Admin dashboard
```bash
cd admin
npm install
npm run dev                # http://localhost:3001
```

Detailed setup per environment: see [`docs/deployment/`](docs/deployment/).

---

## Deployment

| Target | Guide |
|---|---|
| Postgres on VPS | [`docs/deployment/01-postgres-vps.md`](docs/deployment/01-postgres-vps.md) |
| Server CPU-only on VPS | [`docs/deployment/02-server-vps.md`](docs/deployment/02-server-vps.md) |
| Server GPU on RunPod | [`docs/deployment/03-server-runpod.md`](docs/deployment/03-server-runpod.md) |
| Web on Vercel | [`docs/deployment/04-web-vercel.md`](docs/deployment/04-web-vercel.md) |
| Admin on Vercel | [`docs/deployment/05-admin-vercel.md`](docs/deployment/05-admin-vercel.md) |
| Data migration | [`docs/deployment/06-data-migration.md`](docs/deployment/06-data-migration.md) |
| Env checklist | [`docs/deployment/07-env-checklist.md`](docs/deployment/07-env-checklist.md) |
| Desktop Electron build | [`docs/deployment/08-desktop-electron.md`](docs/deployment/08-desktop-electron.md) |

---

## License & legal

- **Source code**: Proprietary — see [`LICENSE`](LICENSE) (EULA)
- **Terms of Service** (user-facing): [`docs/TERMS_OF_SERVICE.md`](docs/TERMS_OF_SERVICE.md)
- **Privacy Policy**: [`docs/PRIVACY_POLICY.md`](docs/PRIVACY_POLICY.md)
- **Third-party**: `voxstudio-engine/` (Apache 2.0), Whisper (MIT), FFmpeg
  (LGPL). See `voxstudio-engine/LICENSE` and `desktop/package.json`.

---

## Status

- ✅ Backend server (FastAPI + GPU worker queue)
- ✅ Desktop Electron app (TTS · Voice Clone · Dubbing Studio · STT)
- ✅ Web + Admin dashboards
- ✅ License key system (proprietary EULA)
- 🚧 In progress: Mac/Win/Linux signed installers, App Store submission

---

Built by **Tiến Thuận** · 2026
