"""Voice management API endpoints."""

import shutil
import tempfile

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.models.schemas import VoiceInfo, VoiceListResponse
from app.services import voice_svc, tts_svc
from app.core.gpu_manager import gpu
from app.core.storage import save_audio

router = APIRouter(prefix="/voices", tags=["Voices"])


@router.post("/preview")
async def preview_voice(
    audio: UploadFile = File(..., description="Reference audio file (3-10s)"),
    text: str = Form(..., description="Text to synthesize for preview"),
    ref_text: str = Form(None, description="Audio transcript (auto-detected if empty)"),
    language: str = Form(None, description="Target language"),
    speed: float = Form(1.0, description="Speed multiplier"),
    num_step: int = Form(None, description="Inference steps"),
    guidance_scale: float = Form(None, description="CFG guidance scale"),
    t_shift: float = Form(None, description="Time shift"),
    layer_penalty_factor: float = Form(None, description="Layer penalty"),
    position_temperature: float = Form(None, description="Position temperature"),
    class_temperature: float = Form(None, description="Class temperature"),
    denoise: bool = Form(None, description="Apply denoising"),
    preprocess_prompt: bool = Form(None, description="Preprocess prompt"),
    postprocess_output: bool = Form(None, description="Postprocess output"),
    audio_chunk_duration: float = Form(None, description="Audio chunk duration"),
):
    """Preview TTS with a reference audio — creates temp voice in memory, does NOT save."""
    from omnivoice import OmniVoiceGenerationConfig
    from app.config import TTS_DEFAULT_GUIDANCE, TTS_DEFAULT_STEPS

    suffix = "." + (audio.filename.split(".")[-1] if audio.filename else "wav")
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(audio.file, tmp)
        tmp_path = tmp.name

    try:
        voice_prompt = gpu.create_voice_prompt(ref_audio=tmp_path, ref_text=ref_text)

        # Build generation config
        cfg = {
            "num_step": num_step or TTS_DEFAULT_STEPS,
            "guidance_scale": guidance_scale if guidance_scale is not None else TTS_DEFAULT_GUIDANCE,
        }
        if t_shift is not None: cfg["t_shift"] = t_shift
        if layer_penalty_factor is not None: cfg["layer_penalty_factor"] = layer_penalty_factor
        if position_temperature is not None: cfg["position_temperature"] = position_temperature
        if class_temperature is not None: cfg["class_temperature"] = class_temperature
        if denoise is not None: cfg["denoise"] = denoise
        if preprocess_prompt is not None: cfg["preprocess_prompt"] = preprocess_prompt
        if postprocess_output is not None: cfg["postprocess_output"] = postprocess_output
        if audio_chunk_duration is not None: cfg["audio_chunk_duration"] = audio_chunk_duration

        gen_config = OmniVoiceGenerationConfig(**cfg)
        kwargs = {"generation_config": gen_config}
        if language: kwargs["language"] = language
        if speed and speed != 1.0: kwargs["speed"] = speed

        waveform = gpu.generate_tts(text, voice_prompt=voice_prompt, **kwargs)
        file_id, _ = save_audio(waveform, gpu.sampling_rate)
        duration = waveform.shape[-1] / gpu.sampling_rate
        return {
            "audio_url": f"/api/v1/tts/audio/{file_id}",
            "duration": round(duration, 2),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/clone", response_model=VoiceInfo)
async def clone_voice(
    audio: UploadFile = File(..., description="Reference audio file (3-10s)"),
    name: str = Form(..., description="Voice name"),
    ref_text: str = Form(None, description="Audio transcript (auto-detected if empty)"),
    tags: str = Form("", description="Comma-separated tags"),
):
    """Clone a voice from reference audio."""
    # Save uploaded file to temp
    suffix = "." + (audio.filename.split(".")[-1] if audio.filename else "wav")
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(audio.file, tmp)
        tmp_path = tmp.name

    try:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
        meta = voice_svc.clone(
            audio_path=tmp_path,
            name=name,
            ref_text=ref_text or None,
            tags=tag_list,
        )
        return meta
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("", response_model=VoiceListResponse)
async def list_voices():
    """List all saved voices."""
    voices = voice_svc.get_all()
    return {"voices": voices, "total": len(voices)}


@router.get("/{voice_id}", response_model=VoiceInfo)
async def get_voice(voice_id: str):
    """Get voice details."""
    try:
        return voice_svc.get_one(voice_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/{voice_id}")
async def delete_voice(voice_id: str):
    """Delete a saved voice."""
    deleted = voice_svc.remove(voice_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Voice not found")
    return {"status": "deleted", "id": voice_id}
