"""Manage Whisper + OmniVoice + LLM on a single GPU with thread-safe inference."""

import logging
import os
import threading
from typing import Optional

# Allow MPS to use more memory (avoids OOM on Apple Silicon)
os.environ.setdefault("PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0.0")

import torch
from transformers import pipeline as hf_pipeline, AutoModelForCausalLM, AutoTokenizer

try:
    from omnivoice import OmniVoice
    OMNIVOICE_AVAILABLE = True
except ImportError:
    OmniVoice = None
    OMNIVOICE_AVAILABLE = False

from app.config import (
    DEVICE, DTYPE, TTS_MODEL, WHISPER_MODEL, LLM_MODEL,
    FASTER_WHISPER_MODEL, USE_FASTER_WHISPER,
)

logger = logging.getLogger(__name__)


# ── TTS text preprocessing ────────────────────────────────────────────
# OmniVoice tokenizer hay miss / silent với chữ IN HOA (đặc biệt acronym).
# Expand "AI/CEO/USA/FBI..." → đọc letter-by-letter bằng tên chữ tiếng Việt.
_VN_LETTER_NAME = {
    "A": "a", "B": "bê", "C": "xê", "D": "đê", "E": "e", "F": "ép",
    "G": "giê", "H": "hát", "I": "i", "J": "gi", "K": "ca", "L": "lờ",
    "M": "em", "N": "en", "O": "ô", "P": "pê", "Q": "qui", "R": "rờ",
    "S": "ét", "T": "tê", "U": "u", "V": "vê", "W": "đáp vê",
    "X": "ích", "Y": "y", "Z": "giét",
}


def _expand_acronyms_for_tts(text: str) -> str:
    """Expand consecutive uppercase letters → tên chữ tiếng Việt.

    Áp dụng cho acronym 2-6 chữ IN HOA liên tiếp (đứng riêng giữa word
    boundary). Bỏ qua các từ có chữ thường lẫn (iPhone, MacBook).

    Examples:
      AI       → "a i"
      USA      → "u ét a"
      CEO      → "xê i ô"
      Hello AI → "Hello a i"
      iPhone   → "iPhone" (giữ nguyên, không phải acronym)
    """
    if not text:
        return text
    import re

    def _repl(m: re.Match) -> str:
        chars = m.group(0)
        return " ".join(_VN_LETTER_NAME.get(c, c) for c in chars)

    # \b[A-Z]{2,6}\b — match cụm 2-6 chữ HOA giữa word boundary
    return re.sub(r"\b[A-Z]{2,6}\b", _repl, text)


_VN_NUMBER_WORDS = {
    0: "không", 1: "một", 2: "hai", 3: "ba", 4: "bốn",
    5: "năm", 6: "sáu", 7: "bảy", 8: "tám", 9: "chín", 10: "mười",
}


def _number_to_vietnamese(n: int) -> str:
    if n < 0:
        return "âm " + _number_to_vietnamese(-n)
    if n <= 10:
        return _VN_NUMBER_WORDS[n]
    if n < 20:
        return "mười " + ("" if n == 10 else
                          "một" if n == 11 else
                          "lăm" if n == 15 else _VN_NUMBER_WORDS[n % 10])
    if n < 100:
        tens = n // 10
        ones = n % 10
        result = _VN_NUMBER_WORDS[tens] + " mươi"
        if ones == 0:
            return result
        if ones == 1:
            return result + " mốt"
        if ones == 5:
            return result + " lăm"
        if ones == 4 and tens >= 2:
            return result + " tư"
        return result + " " + _VN_NUMBER_WORDS[ones]
    if n < 1000:
        hundreds = n // 100
        remainder = n % 100
        result = _VN_NUMBER_WORDS[hundreds] + " trăm"
        if remainder == 0:
            return result
        if remainder < 10:
            return result + " lẻ " + _VN_NUMBER_WORDS[remainder]
        return result + " " + _number_to_vietnamese(remainder)
    if n < 1_000_000:
        thousands = n // 1000
        remainder = n % 1000
        result = _number_to_vietnamese(thousands) + " nghìn"
        if remainder == 0:
            return result
        if remainder < 100:
            return result + " không trăm " + _number_to_vietnamese(remainder)
        return result + " " + _number_to_vietnamese(remainder)
    if n < 1_000_000_000:
        millions = n // 1_000_000
        remainder = n % 1_000_000
        result = _number_to_vietnamese(millions) + " triệu"
        if remainder == 0:
            return result
        return result + " " + _number_to_vietnamese(remainder)
    return str(n)


def _expand_numbers_for_tts(text: str) -> str:
    import re

    def _repl(m: re.Match) -> str:
        num_str = m.group(0)
        try:
            n = int(num_str)
        except ValueError:
            return num_str
        if n > 999_999_999:
            return num_str
        return _number_to_vietnamese(n)

    return re.sub(r"\b\d{1,9}\b", _repl, text)


def _clean_punctuation_for_tts(text: str) -> str:
    import re
    out = text
    out = re.sub(r"^\d+\)\s*", "", out)
    out = re.sub(r",{2,}", ",", out)
    out = re.sub(r"\.{3,}", "...", out)
    out = re.sub(r"!{2,}", "!", out)
    out = re.sub(r"\?{2,}", "?", out)
    out = re.sub(r"[""„]", '"', out)
    out = re.sub(r"[''‚]", "'", out)
    out = re.sub(r"[「」『』【】]", "", out)
    out = re.sub(r"[（）\(\)]", "", out)
    out = re.sub(r"\s*[—–]\s*", ", ", out)
    out = re.sub(r"(\w)/(\w)", r"\1 hay \2", out)
    return out


def _insert_breath_marks(text: str) -> str:
    """Chèn dấu phẩy tại các điểm hơi tự nhiên để TTS không nuốt từ."""
    import re
    out = text
    # Trước tên riêng Hán-Việt 2 âm tiết liền nhau (Tòng An, Diệp Thần...)
    # nếu chưa có dấu câu trước đó
    _VN_UPPER = r"[A-ZÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐĐ]"
    _VN_LOWER = r"[a-zàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]"
    out = re.sub(
        rf"(\b{_VN_LOWER}+)\s+({_VN_UPPER}{_VN_LOWER}{{1,4}}\s+{_VN_UPPER}{_VN_LOWER}{{1,4}}\b)",
        r"\1, \2",
        out,
    )
    return out


def preprocess_tts_text(text: str) -> str:
    """Pre-process text trước khi đưa vào OmniVoice TTS.

    Pipeline:
      1. Clean punctuation (collapse doubles, normalize quotes/dashes)
      2. Expand numbers → chữ tiếng Việt
      3. Expand acronym IN HOA → tên chữ tiếng Việt
      4. Insert breath marks trước tên riêng
      5. Trim whitespace dư thừa
    """
    if not text:
        return text
    out = _clean_punctuation_for_tts(text)
    out = _expand_numbers_for_tts(out)
    out = _expand_acronyms_for_tts(out)
    out = _insert_breath_marks(out)
    out = " ".join(out.split())
    return out


class GPUManager:
    def __init__(self):
        self._lock = threading.RLock()       # TTS + Whisper (RLock: reentrant for create_voice_prompt → transcribe)
        self._llm_lock = threading.Lock()    # LLM riêng, không block TTS/Whisper
        self.tts_model: Optional["OmniVoice"] = None  # type: ignore
        self.whisper_pipe = None
        self._fw_model = None                # Faster-Whisper model
        self._use_faster_whisper = USE_FASTER_WHISPER
        self._llm_model = None
        self._llm_tokenizer = None
        self._llm_loaded = False
        self._llm_loading = False
        self._ready = False

    # ------------------------------------------------------------------
    # Startup
    # ------------------------------------------------------------------
    def _load_faster_whisper(self):
        """Load Faster-Whisper (CTranslate2) — much faster than HuggingFace pipeline."""
        from faster_whisper import WhisperModel

        compute_type = "float16" if DEVICE.startswith("cuda") else "int8"
        device = "cuda" if DEVICE.startswith("cuda") else "cpu"
        logger.info("Loading Faster-Whisper model=%s device=%s compute=%s ...",
                     FASTER_WHISPER_MODEL, device, compute_type)
        self._fw_model = WhisperModel(
            FASTER_WHISPER_MODEL,
            device=device,
            compute_type=compute_type,
        )
        logger.info("Faster-Whisper loaded.")

    def _load_hf_whisper(self):
        """Load HuggingFace Whisper pipeline (fallback)."""
        logger.info("Loading HF Whisper from %s ...", WHISPER_MODEL)
        whisper_dtype = torch.float16 if DEVICE.startswith("cuda") else torch.float32
        self.whisper_pipe = hf_pipeline(
            "automatic-speech-recognition",
            model=WHISPER_MODEL,
            dtype=whisper_dtype,
            device_map=DEVICE,
        )
        logger.info("HF Whisper loaded.")

    def load_all(self):
        """Load Whisper at startup. TTS loads lazily on first generate to save memory."""
        logger.info("Loading models on device=%s dtype=%s ...", DEVICE, DTYPE)

        # Whisper STT — load at startup (needed for transcription)
        if self._use_faster_whisper:
            try:
                self._load_faster_whisper()
            except Exception as e:
                logger.warning("Faster-Whisper failed (%s), falling back to HF Whisper", e)
                self._use_faster_whisper = False
                self._load_hf_whisper()
        else:
            self._load_hf_whisper()

        # TTS loads on first generate_tts() call
        self._ready = True
        logger.info("Server ready. TTS will load on first generate request.")

    def _ensure_tts(self):
        """Lazy-load Vox Premium TTS engine on first use."""
        if self.tts_model is not None:
            return
        if not OMNIVOICE_AVAILABLE:
            raise RuntimeError(
                "Vox Premium engine not installed. "
                "Install: pip install -e /path/to/voice-engine (see docs)"
            )
        logger.info("Loading Vox Premium engine from %s (first TTS request)...", TTS_MODEL)
        self.tts_model = OmniVoice.from_pretrained(
            TTS_MODEL,
            device_map=DEVICE,
            dtype=DTYPE,
            load_asr=False,
        )
        logger.info("Vox Premium engine loaded.")

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def sampling_rate(self) -> int:
        return self.tts_model.sampling_rate if self.tts_model else 24000

    # ------------------------------------------------------------------
    # Thread-safe inference — TTS & Whisper
    # ------------------------------------------------------------------
    def transcribe_faster(self, audio_path: str, language: str = None) -> dict:
        """Faster-Whisper STT — returns {"text", "segments", "language"}.

        - VAD first; retry without VAD if all audio removed.
        - word_timestamps=True so downstream can split/snap to actual word boundaries
          instead of guessing by character-count proportion.
        """
        # Re-load if Whisper was unloaded to free VRAM
        if self._fw_model is None and self._use_faster_whisper:
            self._load_faster_whisper()
        with self._lock:
            def _run(vad: bool):
                # Anti-hallucination cho Chinese drama / video có nhạc nền:
                # condition_on_previous_text=True (default) khiến model dùng
                # hypothesis trước làm context → loop output cùng text khi
                # gặp silence/music. Tắt + thêm hallucination_silence_threshold
                # + no_repeat_ngram để chặn repeat ngay tại generation.
                #
                # initial_prompt: prime Whisper với context phim drama để
                # giảm xác suất fallback về YouTube outro pattern
                # ("请订阅点赞") khi gặp nhạc nền. Whisper train trên RẤT
                # nhiều YouTube Trung outro → khi audio không rõ, default
                # về pattern này. Initial prompt với từ vựng drama đẩy
                # nó về context phim.
                lang_code = (language or "").lower() if language else ""
                init_prompt = None
                if lang_code in ("zh", "chinese"):
                    init_prompt = (
                        "这是一段中文电视剧对白，包含家庭、爱情、商业、"
                        "古装等情节。请准确转写每个角色的台词。"
                    )
                elif lang_code in ("ja", "japanese"):
                    init_prompt = (
                        "これは日本のドラマの会話です。"
                        "登場人物のセリフを正確に書き起こしてください。"
                    )
                elif lang_code in ("ko", "korean"):
                    init_prompt = (
                        "이것은 한국 드라마의 대화입니다. "
                        "등장인물의 대사를 정확하게 받아쓰기해 주세요."
                    )
                kwargs = {
                    "beam_size": 5,
                    "vad_filter": vad,
                    "word_timestamps": True,
                    "condition_on_previous_text": False,
                    # 3.0s threshold (cũ 2.0) — phim có nhạc nền + pause tự
                    # nhiên giữa câu hay bị coi là hallucinate → drop nhầm
                    # câu THẬT. Nới ra để giữ dialogue.
                    "hallucination_silence_threshold": 3.0,
                    "no_repeat_ngram_size": 3,
                    "temperature": [0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
                    # 2.4 = default Whisper (cũ 2.2 quá strict — drop nhầm
                    # câu thoại tự nhiên có lặp tiểu từ "à/nhỉ/thế").
                    "compression_ratio_threshold": 2.4,
                }
                if init_prompt:
                    kwargs["initial_prompt"] = init_prompt
                if vad:
                    # VAD nhạy hơn cho phim Trung — Whisper hay bỏ sót dialogue
                    # khi có nhạc nền mixed vào speech (gap 19s+ giữa phim
                    # mà thực tế có người nói). Lower threshold + smaller
                    # min_speech_duration để bắt giọng yếu / câu ngắn.
                    kwargs["vad_parameters"] = {
                        "min_speech_duration_ms": 150,  # bắt câu 1-2 từ (cũ 250)
                        "max_speech_duration_s": 15,
                        "min_silence_duration_ms": 400,  # cắt sớm hơn (cũ 500)
                        "speech_pad_ms": 500,            # pad rộng hơn (cũ 400)
                        "threshold": 0.2,                # nhạy hơn (cũ 0.3, Silero default 0.5)
                    }
                if language:
                    kwargs["language"] = language
                segments_gen, info = self._fw_model.transcribe(audio_path, **kwargs)
                segs = []
                for s in segments_gen:
                    words = []
                    if s.words:
                        for w in s.words:
                            words.append({
                                "start": w.start,
                                "end": w.end,
                                "word": w.word,
                                "probability": getattr(w, "probability", None),
                            })
                    segs.append({
                        "start": s.start,
                        "end": s.end,
                        "text": s.text.strip(),
                        "words": words,
                        # Confidence metrics — dùng filter music/song segments
                        # no_speech_prob cao = audio không phải speech (music)
                        # avg_logprob âm sâu = LM confidence thấp (gibberish/music)
                        "no_speech_prob": float(getattr(s, "no_speech_prob", 0.0) or 0.0),
                        "avg_logprob": float(getattr(s, "avg_logprob", 0.0) or 0.0),
                    })
                return segs, info

            # Default vad=False — VAD Silero hay bỏ sót dialogue khi mixed
            # nhạc nền (xác nhận bằng test thực tế: tắt VAD bắt được 6 câu
            # mà bật VAD bỏ qua hết). Whisper internal đã handle silence OK.
            # Trade-off: chậm hơn ~2x cho audio dài, nhưng precision quan trọng
            # hơn cho dub. Audio dài hiếm gặp dub job (<30 min typical).
            segments, info = _run(vad=False)
            if not segments:
                # Hiếm khi xảy ra (Whisper raw thường output gì đó) — fallback
                # bật VAD lenient. Chỉ làm gì khi VAD-off trả nothing.
                logger.warning("Whisper raw returned no segments — retry with VAD")
                segments, info = _run(vad=True)

            full_text = " ".join(seg["text"] for seg in segments)
            self._clear_cache()
            total_words = sum(len(s.get("words", [])) for s in segments)
            logger.info("Faster-Whisper: %d segments (%d words), lang=%s",
                        len(segments), total_words, info.language)
            return {
                "text": full_text,
                "segments": segments,
                "language": info.language,
            }

    def transcribe(self, audio_path: str, return_timestamps: bool = False, language: str = None) -> dict:
        """HuggingFace Whisper STT — returns {"text": ..., "chunks": [...]}."""
        # Re-load if Whisper was unloaded to free VRAM
        if self.whisper_pipe is None and not self._use_faster_whisper:
            self._load_hf_whisper()
        with self._lock:
            kwargs = {"return_timestamps": return_timestamps}
            if language:
                kwargs["generate_kwargs"] = {"language": language}
            result = self.whisper_pipe(audio_path, **kwargs)
            return result

    def _clear_cache(self):
        """Free GPU memory cache."""
        if DEVICE == "mps":
            torch.mps.empty_cache()
        elif DEVICE == "cuda":
            torch.cuda.empty_cache()

    # ------------------------------------------------------------------
    # VRAM management — unload models between pipeline phases
    # ------------------------------------------------------------------
    def vram_stats(self) -> dict:
        """Return current VRAM usage in MB (CUDA only)."""
        if not torch.cuda.is_available():
            return {"device": DEVICE, "cuda": False}
        free, total = torch.cuda.mem_get_info()
        used = total - free
        return {
            "device": "cuda",
            "total_mb": round(total / 1024 / 1024, 1),
            "used_mb": round(used / 1024 / 1024, 1),
            "free_mb": round(free / 1024 / 1024, 1),
            "allocated_mb": round(torch.cuda.memory_allocated() / 1024 / 1024, 1),
            "reserved_mb": round(torch.cuda.memory_reserved() / 1024 / 1024, 1),
            "models_loaded": {
                "whisper_hf": self.whisper_pipe is not None,
                "whisper_faster": self._fw_model is not None,
                "omnivoice_tts": self.tts_model is not None,
                "llm": self._llm_loaded,
            },
        }

    def _log_vram(self, tag: str):
        """Log current VRAM state with a tag."""
        if torch.cuda.is_available():
            s = self.vram_stats()
            logger.info("[VRAM %s] used=%.1fMB/%.1fMB, allocated=%.1fMB",
                        tag, s["used_mb"], s["total_mb"], s["allocated_mb"])

    def unload_llm(self):
        """Free Qwen 7B from VRAM (~5-6GB). Safe to call after translation is done."""
        with self._llm_lock:
            if self._llm_model is None and self._llm_tokenizer is None:
                return
            logger.info("Unloading LLM (freeing ~5-6GB VRAM)...")
            del self._llm_model
            del self._llm_tokenizer
            self._llm_model = None
            self._llm_tokenizer = None
            self._llm_loaded = False
            import gc
            gc.collect()
            self._clear_cache()
            if torch.cuda.is_available():
                torch.cuda.synchronize()
            self._log_vram("after unload_llm")

    def unload_tts(self):
        """Free Vox Premium TTS from VRAM (~2-3GB). Reloads lazily on next generate."""
        with self._lock:
            if self.tts_model is None:
                return
            logger.info("Unloading Vox Premium TTS engine...")
            del self.tts_model
            self.tts_model = None
            import gc
            gc.collect()
            self._clear_cache()
            if torch.cuda.is_available():
                torch.cuda.synchronize()
            self._log_vram("after unload_tts")

    def unload_whisper(self):
        """Free Whisper from VRAM. Re-loads lazily on next transcribe."""
        with self._lock:
            if self.whisper_pipe is None and self._fw_model is None:
                return
            logger.info("Unloading Whisper...")
            del self.whisper_pipe
            del self._fw_model
            self.whisper_pipe = None
            self._fw_model = None
            self._ready = False  # will reload on next transcribe call
            import gc
            gc.collect()
            self._clear_cache()
            if torch.cuda.is_available():
                torch.cuda.synchronize()
            self._log_vram("after unload_whisper")

    def ensure_whisper(self):
        """Lazy-reload Whisper if it was unloaded."""
        with self._lock:
            if self._use_faster_whisper and self._fw_model is None:
                self._load_faster_whisper()
            elif not self._use_faster_whisper and self.whisper_pipe is None:
                self._load_hf_whisper()
            self._ready = True

    def create_voice_prompt(self, ref_audio: str, ref_text: str = None,
                            preprocess_prompt: bool = True):
        """Create a reusable VoiceClonePrompt from reference audio.

        preprocess_prompt: nếu False → OmniVoice KHÔNG chạy silence removal
        lần 2. Dùng khi caller đã preprocess audio (vd voice_svc gọi
        preprocess_ref_audio trước). Tránh bug ref_text/audio mismatch.
        """
        with self._lock:
            self._ensure_tts()
            self._clear_cache()
            if ref_text is None:
                logger.info("Auto-transcribing reference audio...")
                # Fallback: whisper_pipe (HF) → faster-whisper → None để
                # OmniVoice tự load ASR. Tránh crash khi whisper_pipe is None.
                if self.whisper_pipe is not None:
                    whisper_result = self.whisper_pipe(ref_audio)
                    ref_text = whisper_result["text"].strip()
                elif getattr(self, "_fw_model", None) is not None:
                    fw_result = self.transcribe_faster(ref_audio)
                    ref_text = (fw_result.get("text") or "").strip()
                if ref_text:
                    logger.info("Transcribed: %s", ref_text[:80])

            prompt = self.tts_model.create_voice_clone_prompt(
                ref_audio=ref_audio,
                ref_text=ref_text,
                preprocess_prompt=preprocess_prompt,
            )
            self._clear_cache()
            return prompt

    def generate_tts(self, text: str, voice_prompt=None, **kwargs):
        """Generate audio from text. Returns waveform tensor.

        Text được normalize qua preprocess_tts_text() để expand acronym
        IN HOA — OmniVoice tokenizer hay miss/silent chữ HOA, đặc biệt
        acronym (AI/USA/CEO) → đọc letter-by-letter bằng tên chữ Việt.
        """
        text = preprocess_tts_text(text)
        if not text or not text.strip():
            return torch.zeros(1)
        with self._lock:
            self._ensure_tts()
            self._clear_cache()
            kw = {"text": text}
            if voice_prompt is not None:
                kw["voice_clone_prompt"] = voice_prompt
            kw.update(kwargs)
            audio = self.tts_model.generate(**kw)
            self._clear_cache()
            return audio[0].squeeze(0)  # (T,)

    # ------------------------------------------------------------------
    # LLM — separate lock, lazy-loaded, non-blocking for TTS/Whisper
    # ------------------------------------------------------------------
    def _ensure_llm(self):
        """Load Qwen model on first use. Uses its own lock."""
        if self._llm_loaded:
            return
        if self._llm_loading:
            logger.info("LLM already loading, waiting...")
            # Wait for loading to finish
            while self._llm_loading and not self._llm_loaded:
                import time
                time.sleep(0.5)
            return

        self._llm_loading = True
        logger.info("Loading LLM %s (this won't block TTS/Whisper)...", LLM_MODEL)
        try:
            self._llm_tokenizer = AutoTokenizer.from_pretrained(LLM_MODEL)
            # Use 4-bit quantization to fit 7B model in limited VRAM
            try:
                from transformers import BitsAndBytesConfig
                quant_config = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_compute_dtype=torch.float16,
                    bnb_4bit_quant_type="nf4",
                )
                self._llm_model = AutoModelForCausalLM.from_pretrained(
                    LLM_MODEL,
                    quantization_config=quant_config,
                    device_map="auto",
                )
                logger.info("LLM loaded with 4-bit quantization")
            except ImportError:
                logger.warning("bitsandbytes not available, loading in float16")
                self._llm_model = AutoModelForCausalLM.from_pretrained(
                    LLM_MODEL,
                    torch_dtype=torch.float16 if DEVICE != "cpu" else torch.float32,
                    device_map=DEVICE,
                )
            self._llm_model.eval()
            self._llm_loaded = True
            logger.info("LLM loaded on %s.", DEVICE)
        except Exception as e:
            logger.error("Failed to load LLM: %s", e)
            self._llm_model = None
            self._llm_tokenizer = None
            self._llm_loaded = False
            raise
        finally:
            self._llm_loading = False

    def llm_generate(self, messages: list[dict], max_new_tokens: int = 2048, temperature: float = 0.3) -> str:
        """Run chat completion with the loaded LLM. Uses separate lock from TTS/Whisper."""
        with self._llm_lock:
            self._ensure_llm()
            self._clear_cache()

            text = self._llm_tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True,
            )
            inputs = self._llm_tokenizer(text, return_tensors="pt").to(self._llm_model.device)

            with torch.no_grad():
                output_ids = self._llm_model.generate(
                    **inputs,
                    max_new_tokens=max_new_tokens,
                    temperature=temperature,
                    do_sample=temperature > 0,
                    top_p=0.9,
                )

            # Decode only new tokens
            new_tokens = output_ids[0][inputs["input_ids"].shape[1]:]
            result = self._llm_tokenizer.decode(new_tokens, skip_special_tokens=True)
            self._clear_cache()
            return result.strip()

    @property
    def llm_ready(self) -> bool:
        return self._llm_loaded


# Singleton
gpu = GPUManager()
