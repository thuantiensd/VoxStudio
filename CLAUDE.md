# Claude Code — VoxStudio guide

Project context for AI agents working in this monorepo.

## What VoxStudio is

Local-first AI dubbing/TTS suite. 4 components in 1 monorepo:

- **`desktop/`** — Electron + React app (user-facing)
- **`server/`** — FastAPI backend with GPU worker queue
- **`web/`** — Next.js marketing site
- **`admin/`** — Next.js internal dashboard
- **`voxstudio-engine/`** — Python TTS engine (Apache 2.0, derived from
  OmniVoice). Imported as Python package `omnivoice` (kept for backward
  compat — DO NOT rename internal imports without full pipeline test).

Each subproject has its own `CLAUDE.md` / `AGENTS.md` for component-specific
guidance — read those first for that area.

## Branding rules (important)

User-facing UI/log strings: **"Vox Premium"** (engine) · **"VoxLocal"** /
**"VoxCloud"** (engine variants). Never expose "OmniVoice" to end users.

Internal code: keep `from omnivoice import X` (Python package name in
`voxstudio-engine/pyproject.toml` is unchanged — Apache 2.0 attribution
preserved). Path constants reference `voxstudio-engine/voices/`.

When adding new logs / errors / API descriptions: use "Vox Premium" or
"VoxStudio engine", never "OmniVoice".

## Conventions

### Language
- **Vietnamese first** for UI strings, error messages, comments. English
  fallback OK in technical areas (logs, API descriptions).
- Code identifiers + module names: English (idiomatic JS/Python).

### Code style
- Don't add comments explaining WHAT the code does (well-named identifiers
  do that). Only add WHY when non-obvious (constraint, workaround, edge
  case).
- Don't write defensive code for impossible cases. Validate at system
  boundaries (user input, external APIs), trust internal calls.
- Prefer editing existing files over creating new ones.
- No `try/except` blocks just to satisfy a linter. Catch only what you can
  actually handle.

### Architecture
- License key system uses **JWT signed by server** + device fingerprint
  binding. Local cache encrypted via `safeStorage`.
- Voices are stored as `.pt` files (PyTorch tensors) in
  `voxstudio-engine/voices/` and `server/voices/`.
- TTS pipeline: text → Vox Premium engine → audio_output → signed URL →
  client download → server cleanup.
- Dubbing pipeline: video → Whisper STT → translate (LLM/Google) → TTS →
  ffmpeg mux.

## Common commands

### Backend
```bash
cd server
uvicorn app.main:app --reload --port 8000        # dev
docker-compose up -d                              # prod
```

### Desktop
```bash
cd desktop
npm run dev                                       # Electron + Vite
npm run vite:build                                # check React syntax
npx eslint src/                                   # lint
```

### Web / Admin
```bash
cd web   # or admin
npm run dev
npm run build
npm run lint
```

### Voice engine (rare — only when modifying TTS internals)
```bash
pip install -e ./voxstudio-engine                 # editable install
python voxstudio-engine/save_voice.py <args>      # save voice ref
```

## Git workflow

- `master` is the default branch
- Commit messages: `type(scope): subject` — types: `feat`, `fix`, `chore`,
  `refactor`, `revert`. Vietnamese subject OK for user-facing changes.
- DO NOT commit:
  - `server/voices/` content (`.pt` files are user data)
  - `server/dubbing_projects/` (1GB+ user content)
  - `server/audio_output/` (cache)
  - `server/voxstudio.db` and backups
  - `.env` files
  - `node_modules/`, `dist/`, `release/`, `__pycache__/`

## Testing

No automated tests yet (pre-MVP). Manual smoke test before commit:
1. Backend: `curl http://localhost:8000/health`
2. Desktop: `npm run vite:build` (catches React syntax errors)
3. Voice engine: `python -c "from omnivoice import OmniVoice"`

## Sensitive areas — be careful

- **License gate** (`desktop/electron/license/`, `server/app/services/license_*`)
  — breaking this locks out paying users. Test offline grace + revoke.
- **Voice cloning** — `.pt` file format binds to specific TTS engine
  version. Schema change requires migration.
- **Dubbing pipeline** — long-running GPU jobs in `server/app/worker/`.
  State machine: pending → running → done/error. Don't add new states
  without updating UI.
- **Pricing / billing** — check `server/app/services/billing_*` AND
  `web/components/pricing/*` together. Inconsistency = lost revenue.

## Out of scope

- Don't add tests proactively unless asked — pre-MVP, focus on shipping.
- Don't refactor working code unless the task requires it.
- Don't add new dependencies without strong justification — bundle size
  matters for desktop installer.
- Don't touch `voxstudio-engine/` source unless absolutely necessary —
  upstream is Apache 2.0 OmniVoice; we want to stay close to upstream for
  easy updates.

---

Maintained by Tiến Thuận. Last updated: 2026-05-05.
