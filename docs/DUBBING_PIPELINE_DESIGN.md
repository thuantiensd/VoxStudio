# Dubbing Pipeline — Design & Refactor Plan

**Last updated:** 2026-05-19  
**Status:** Phase A + C done. Phase B pending. Phase D smoke tests added.

---

## Pipeline đúng (7 Stage, 18 bước)

```
┌──────────────────────────────────────────────────────────────┐
│ STAGE 1 — PRE-PROCESS                                        │
│   1. Extract audio → original_audio.wav                      │
│   2. Demucs separate → vocals.wav + accompaniment.wav        │
│      (LUÔN chạy, idempotent — đã tách thì skip)              │
├──────────────────────────────────────────────────────────────┤
│ STAGE 2 — SPEECH-TO-TEXT + SPEAKER                           │
│   3. Whisper STT on vocals.wav → segments (text + word ts)   │
│   4. Pyannote diarization → speaker_id per segment           │
│   5. Merge short fragments (same speaker + gap < 1.8s)       │
│   6. Gender detection per speaker (F0-based)                 │
├──────────────────────────────────────────────────────────────┤
│ STAGE 3 — TRANSLATE                                          │
│   7. Build prompt (KINSHIP + SUBJECT INFER + Logic Review)   │
│   8. LLM batch translate (context window 10 lines)           │
│   9. Post-process: name consistency, glossary                │
├──────────────────────────────────────────────────────────────┤
│ STAGE 4 — VOICE MAPPING                                      │
│  10. User pick voices per speaker (UI) hoặc auto theo gender │
│  11. Build map: speaker_id → voice_id                        │
├──────────────────────────────────────────────────────────────┤
│ STAGE 5 — TTS GENERATION                                     │
│  12. Generate TTS audio per segment (Edge / Vox Premium)     │
│      • Base rate 1.05x                                       │
│      • Speedup max 1.25x nếu overflow                        │
│      • KHÔNG slowdown — short audio → silence fill           │
│  13. Smart pause: split batch → chunks per-segment           │
│      → place at segment.start gốc → giữ pause tự nhiên       │
├──────────────────────────────────────────────────────────────┤
│ STAGE 6 — AUDIO MIX                                          │
│  14. Build dubbed_track.wav (place chunks at start gốc)      │
│  15. Final mix (pro_mix duy nhất):                           │
│       output = dubbed_track                                  │
│              + accompaniment × bgm_vol     if keep_bgm       │
│              + vocals × orig_vol           if keep_orig      │
│       + LUFS normalize -16 + true-peak limiter -1dBTP        │
├──────────────────────────────────────────────────────────────┤
│ STAGE 7 — SUBTITLE + EXPORT                                  │
│  16. Generate .srt + .ass                                    │
│  17. ffmpeg mux: video + dubbed_audio                        │
│  18. Burn subtitle (nếu libass có) — graceful fallback       │
└──────────────────────────────────────────────────────────────┘
```

**4 nguyên tắc thiết kế:**

1. **Single source of truth** mỗi setting — 1 toggle = 1 file = 1 path
2. **Idempotent** — chạy lại 1 stage không phá output stage trước
3. **Graceful fallback** — thiếu dependency (libass, GPU) không crash
4. **Linear flow** — không loop, không skip stage tuỳ điều kiện

---

## Settings — Single source of truth

5 params duy nhất (sau Phase A cleanup):

| Param | Type | Default | Mô tả |
|---|---|---|---|
| `keep_accompaniment` | bool | True | Mix BGM/SFX vào output |
| `accompaniment_volume` | float 0-1 | 0.35 | Volume BGM |
| `keep_original_voice` | bool | False | Mix giọng người gốc vào output |
| `original_voice_volume` | float 0-1 | 0.20 | Volume giọng gốc |
| `target_lufs` | float | -16.0 | Loudness target (YouTube=-14, streaming=-16) |

**Đã xóa (Phase A):**
- `keep_original_audio`, `original_audio_volume` (monolithic legacy)
- `enable_ducking`, `duck_level`, `duck_attack`, `duck_release` (legacy ducking)
- `use_pro_mix` (luôn dùng pro_mix giờ)

---

## Audio Mix — Single path

```python
# server/app/services/dubbing_svc.py:export_video
if keep_accomp:
    if not accomp_path.exists():
        # KHÔNG fallback original_audio.wav (tránh kéo giọng gốc)
        skip + log warning
    else:
        # pro_mix với bgm_gain_db dynamic từ user slider
        bgm_gain_db = 20 * log10(accomp_vol)
        full_audio = pro_mix(voice, bgm, sr, bgm_gain_db, target_lufs)
```

**Đã xóa:**
- `_apply_ducking()` legacy envelope ducking
- Branch `enable_ducking` + `use_pro_mix` simple mix
- Fallback `bg_path = accomp_path if exists else orig_audio_path`

---

## Smart Pause Adjustment (Stage 5 bước 13)

Vấn đề: batch TTS combine N segment thành 1 audio → mất pause giữa
segments → audio không sync với scene cut.

Fix: `_split_batch_into_segment_chunks()` split batch_audio thành
chunks proportional theo char count, place mỗi chunk tại `seg.start`
gốc. Gap giữa chunks → silence tự nhiên (match original speaker pause).

---

## LLM Prompt Architecture

**Đã fix overlap 3 nguồn** (Phase 5):

```
TOPIC_HINT layer:
  - character_registry_block (chars list + SELF-REFERENCE rules)

ANCHOR layer (system prompt):
  - KINSHIP_HARD_RULES_VN (ADDRESSEE rules: 妈→con, 爸→con, ...)
  - SUBJECT_INFERENCE_RULES_VN (topic continuity, possessive inference)
  - audio_gender_hints (metadata only)

USER prompt:
  - Per-segment: [SPEAKER_XX:gender, max N chars] {text}
  - Context window: 10 lines trước (continuity)
```

**Logic Review (BƯỚC 4):**
1. Coherence — flow tự nhiên, Q→A match
2. Subject/Object check — verify subject từ context, không bịa
3. Character name consistency
4. Pronoun consistency
5. Register lock — cổ trang vs modern không pha
6. Action: phát hiện slip → SỬA NGAY trong output

---

## Speed Range

```
SPEED_TOLERANCE = 0.05
MAX_SPEED_FACTOR = 1.25      # speedup max (atempo + Edge rate)
MIN_SPEED_FACTOR = 0.90      # slowdown max (Vox Premium only)
MAX_EDGE_SPEED = 1.25
MIN_EDGE_SPEED = 1.0         # Edge re-gen KHÔNG slowdown
OVERFLOW_GRACE = 1.20        # cho phép overflow 20% trước hard-trim

Emotion caps:
  angry/argument   → 1.30
  whisper/sad      → 1.15
  happy/excited    → 1.22
  neutral/default  → 1.25
```

**Edge TTS baseline 1.05x** — bù cho VN voice natural rate hơi chậm.

**KHÔNG slowdown** — short audio → silence fill (tự nhiên hơn muddy).

---

## Face Detection — Opt-in

**Default OFF** (Phase C). User bật bằng env:

```bash
export VOX_ENABLE_FACE_SPEAKER=true
```

Lý do default off:
- Tốn 2-3 phút/video (mediapipe + insightface inference)
- Đôi khi gây voice swap khi face mờ
- Audio-only pipeline (pyannote) đủ cho hầu hết case

Bật khi: phim có nhân vật on-screen rõ, user có thời gian chờ.

---

## TODO — Phase B (Split file)

`dubbing_svc.py` hiện 6200 dòng. Plan split:

```
server/app/services/dubbing/
  ├── __init__.py          # Public API (re-export)
  ├── pipeline.py          # Orchestrator run_dubbing_pipeline
  ├── stt.py               # Whisper + diarize + merge segments
  ├── translate.py         # LLM translate orchestration
  ├── tts.py               # TTS batch + smart pause
  ├── audio_mix.py         # pro_mix wrapper + final mix
  ├── export.py            # ffmpeg mux + subtitle
  ├── meta.py              # Project meta IO
  ├── timing.py            # Speed constants + atempo helpers
  └── segment_ops.py       # merge, split, snap helpers
```

**Risk:** import cycles, hidden coupling. Cần test sau split.

**Mitigation:** keep `dubbing_svc.py` as facade re-exporting from submodules.

**Effort:** 15-20h. Skip cho MVP, làm sau khi có user paid.

---

## TODO — Phase D (Web split)

`web/app/[locale]/account/page.tsx` hiện **470KB**. Plan split:

```
web/app/[locale]/
  ├── account/page.tsx         # ~10KB (chỉ account info)
  └── studio/                   # MỚI — dubbing studio route
      ├── page.tsx              # ~30KB orchestrate
      └── components/
          ├── ProjectList.tsx
          ├── DubbingControls.tsx
          ├── SegmentEditor.tsx
          ├── VoiceMapper.tsx
          ├── ExportPanel.tsx
          └── ... (15-20 components)
```

**Effort:** 15-20h. Defer cho MVP.

---

## Smoke Tests

```bash
cd server
.venv/bin/python -m pytest tests/test_refactor_phase_a.py -v
```

**15 tests cover:**
- Phase A: ExportOptions schema, export_video signature, `_apply_ducking` removed
- Speed range: MAX/MIN constants, emotion caps
- Merge SHORT FRAGMENT: short fragment merge + different speakers separate
- Smart pause chunks: per-segment split
- LLM prompts: KINSHIP + SUBJECT INFERENCE constants + injection
- Face detection: opt-in default
- Registry block: no ADDRESSEE rules duplication

**Run sau mỗi fix:** `pytest tests/test_refactor_phase_a.py` (~4s).

---

## Branches

| Branch | Mô tả |
|---|---|
| `master` | Production (Phase 12 đầy đủ, chưa merge fixes) |
| `refactor-phase-a` | **Current** — Phase A + C cleanup, smoke tests |
| `fix-audio-mix` | Ancestor — 10 fix commits (audio + LLM + timing) |
| `backup-current-20260517-1705` | Snapshot master trước refactor |

**Sau khi user verify refactor-phase-a:** merge → master, delete branches cũ.
