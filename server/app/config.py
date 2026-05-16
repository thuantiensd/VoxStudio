"""Application settings — auto-detect device, paths, model config."""

import os
from pathlib import Path

import torch


def _best_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


# Paths — cho phép env override để VPS ↔ Pod cùng dùng path mirror nhau
BASE_DIR = Path(__file__).resolve().parent.parent  # server/
VOICES_DIR = Path(os.getenv("VOICES_DIR") or BASE_DIR / "voices")
AUDIO_OUTPUT_DIR = Path(os.getenv("AUDIO_OUTPUT_DIR") or BASE_DIR / "audio_output")
DUBBING_DIR = Path(os.getenv("DUBBING_PROJECTS_DIR") or BASE_DIR / "dubbing_projects")
# Cache video tải từ URL (TikTok/YouTube/…) chờ user tải về máy. TTL ngắn —
# cleanup định kỳ giống audio_output. Tách dir để không lẫn với output TTS.
VIDEO_CACHE_DIR = Path(os.getenv("VIDEO_CACHE_DIR") or BASE_DIR / "video_cache")

VOICES_DIR.mkdir(parents=True, exist_ok=True)
AUDIO_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
DUBBING_DIR.mkdir(parents=True, exist_ok=True)
VIDEO_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Device
DEVICE = os.getenv("DEVICE", _best_device())
IS_CUDA = DEVICE.startswith("cuda")
DTYPE = torch.float16 if IS_CUDA else torch.float32

# Models
TTS_MODEL = os.getenv("TTS_MODEL", "k2-fsa/OmniVoice")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "openai/whisper-large-v3-turbo")

# Faster-Whisper (CTranslate2 — 10-20x faster, lower VRAM)
FASTER_WHISPER_MODEL = os.getenv("FASTER_WHISPER_MODEL", "large-v3-turbo")
USE_FASTER_WHISPER = os.getenv("USE_FASTER_WHISPER", "true").lower() == "true"

# WhisperX (opt-in) — adds word-level alignment + pyannote diarization on top
# of faster-whisper. ~2x slower trên CPU nhưng subtitle/timing chính xác hơn
# rõ rệt. Cần `pip install whisperx` + (optional) HF_TOKEN cho diarize.
USE_WHISPERX = os.getenv("USE_WHISPERX", "false").lower() == "true"

# Generation defaults (lower steps = faster on MPS/CPU)
DEV_MODE = not IS_CUDA
TTS_DEFAULT_STEPS = 8 if DEV_MODE else 32
TTS_DEFAULT_GUIDANCE = 2.0

# LLM for translation
LLM_MODEL = os.getenv("LLM_MODEL", "Qwen/Qwen2.5-7B-Instruct")

# Gemini API for context-aware translation
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Server
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

# Worker mode — split deploy: VPS chạy WORKER_ENABLED=false (API-only, không
# load model, RAM thấp), RunPod chạy WORKER_ENABLED=true (process GPU job).
WORKER_ENABLED = os.getenv("WORKER_ENABLED", "true").lower() != "false"

# ── Storage backend ────────────────────────────────────────────
# "local" = filesystem (dev); "r2" = Cloudflare R2 (production).
# Khi r2: cần đầy đủ R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY
# + R2_BUCKET_PUBLIC + R2_BUCKET_PRIVATE; thiếu sẽ raise lỗi ở runtime call.
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").lower()

R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET_PUBLIC = os.getenv("R2_BUCKET_PUBLIC", "voxstudio-public")
R2_BUCKET_PRIVATE = os.getenv("R2_BUCKET_PRIVATE", "voxstudio-private")
# Public URL prefix — pub-xxx.r2.dev hoặc files.voxstudio.vn (custom domain).
# Bắt buộc set khi STORAGE_BACKEND=r2 để build URL audio output trả về client.
R2_PUBLIC_URL = os.getenv("R2_PUBLIC_URL", "").rstrip("/")
# Endpoint S3-compatible — auto build từ ACCOUNT_ID nếu không override.
R2_ENDPOINT_URL = os.getenv(
    "R2_ENDPOINT_URL",
    f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com" if R2_ACCOUNT_ID else "",
)


# ═══════════════════════════════════════════════════════════════════════
# DUB THRESHOLDS — gom toàn bộ ngưỡng quyết định speaker/character/face/LLM
# vào 1 chỗ (Phase 1 refactor audit report fix MAJ-7, MAJ-8).
#
# Phase 1: CHỈ gom literal numbers từ code → constants. KHÔNG đổi giá trị.
# Nếu giá trị code khác spec, giữ giá trị code + cờ trong báo cáo phase.
# Phase 5-7 sẽ tune lại giá trị theo spec audio-first character-based.
#
# Naming convention:
#   FACE_*       — face tracking + visual speaker
#   FUSION_*     — multi-modal fusion audio + face
#   GENDER_*     — gender detection per character
#   OWNERSHIP_*  — segment ownership (audio embedding match character)
#   LLM_*        — LLM cross-validate (gender + speaker reassign)
#   COSINE_*     — cosine similarity (clustering raw speakers)
#   ACTIVE_*     — active speaker detection (face mouth movement + audio sync)
#   AUDIO_*      — audio-only signal strength
#   EMBEDDING_*  — speaker embedding extraction
# ═══════════════════════════════════════════════════════════════════════

# === Face tracking + visual ===
# IoU bbox matching giữa các frames trong CÙNG shot (face_speaker_svc).
FACE_IOU_TRACK_MIN = 0.30
# Cosine similarity giữa face embeddings để re-id CÙNG nhân vật qua các shot
# (face_speaker_svc._reidentify_tracks).
# NOTE: Face re-identification dùng insightface w600k_r50 embedding space —
# KHÔNG so sánh trực tiếp được với speaker COSINE_MERGE_* thresholds
# (speaker embedding space khác model: resemblyzer/wespeaker). Giữ riêng.
FACE_REID_COSINE_MIN = 0.45
# Face confidence tối thiểu để USE (apply face_id vào segment HOẶC face thắng
# trong fusion). Dùng ở 2 chỗ: face_speaker_svc.apply_face_speakers_to_segments,
# multimodal_speaker_svc.fuse_speakers. ⚠️ MISMATCH spec: spec yêu cầu
# ACTIVE_SPEAKER_STRONG=0.80 cho face thắng, code đang 0.60.
FACE_USE_MIN_CONFIDENCE = 0.60
# Face CNN gender confidence để override audio gender per segment
# (face_speaker_svc.apply_face_speakers_to_segments).
FACE_GENDER_OVERRIDE_MIN = 0.65

# === Fusion (audio + face cross-match) ===
# Số segment cùng chứa (audio_speaker, face_cluster) tối thiểu để match
# (multimodal_speaker_svc._cross_match_audio_face).
AUDIO_FACE_COOCCURRENCE_MIN = 2

# === Voice mapping (gender → slot) ===
# Gender confidence tối thiểu để strict slot match (voice_mapping.build_speaker_voice_map).
# ⚠️ MISMATCH spec: spec yêu cầu GENDER_HIGH=0.80, code đang 0.70.
GENDER_VOICE_MATCH_MIN = 0.70

# === LLM gender cross-validate (sau translate) ===
# Pipeline confidence thresholds cho rule tree LLM override (dubbing_svc):
#   conf < LOW  → LLM thắng vô điều kiện
#   conf < MID  → LLM thắng nếu evidence ≥ EVIDENCE_MIN_CHARS
#   conf < HIGH → LLM thắng nếu evidence_strong (≥ STRONG_CHARS hoặc keyword "self-ref"...)
#   conf ≥ HIGH → giữ pipeline (audio cực mạnh)
LLM_OVERRIDE_PIPELINE_LOW = 0.70
LLM_OVERRIDE_PIPELINE_MID = 0.90
LLM_OVERRIDE_PIPELINE_HIGH = 0.98
LLM_OVERRIDE_EVIDENCE_MIN_CHARS = 5
LLM_OVERRIDE_EVIDENCE_STRONG_CHARS = 30

# ═══════════════════════════════════════════════════════════════════════
# SPEC DEFAULTS — đặt sẵn cho Phase 3-7 sẽ dùng (character_registry,
# segment_ownership_service, gender_detection_service). Hiện chưa wire vào
# code. Các giá trị này theo spec audit report.
# ═══════════════════════════════════════════════════════════════════════

# === Speaker clustering (Phase 5: character_registry) ===
COSINE_MERGE_HIGH = 0.75       # cosine sim cao → merge tự động
COSINE_MERGE_LOW = 0.65        # < này → giữ riêng tuyệt đối
# Vùng 0.65 ≤ sim < 0.75: không merge nếu chỉ audio, cần ≥ 2 supporting evidences.

# === Gender confidence per character (Phase 7) ===
GENDER_HIGH = 0.80             # high confidence → dùng character profile mạnh
GENDER_MEDIUM = 0.60           # medium → dịch thận trọng, neutral-safe
# < GENDER_MEDIUM → unknown, fallback voice + neutral translation

# === Segment ownership per segment (Phase 6) ===
OWNERSHIP_KEEP = 0.70          # ownership conf ≥ này → giữ assignment
OWNERSHIP_REASSIGN_GAP = 0.20  # best_candidate - assigned > gap → reassign
OWNERSHIP_LOW = 0.50           # < này → mark low_confidence, log qa_report

# === Active speaker detection (Phase 7+) ===
ACTIVE_SPEAKER_STRONG = 0.80   # active speaker conf cao → tin face cho assignment

# === Audio strength (chống face override audio chắc) ===
AUDIO_STRONG = 0.85            # audio ownership ≥ này → face KHÔNG được override

# === Embedding extraction (Phase 4) ===
MIN_EMBEDDING_DURATION = 2.0   # đoạn audio tối thiểu (giây) để extract embedding tin cậy
MAX_EMBEDDING_DURATION = 10.0  # đoạn tối đa (tránh embedding "averaged" qua nhiều câu)
