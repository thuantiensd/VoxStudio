"""Generic translation endpoint — multi-provider (Google/OpenAI/Claude/DeepL/Gemini)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import cloud_translate_svc

router = APIRouter(prefix="/translate", tags=["Translate"])


class TranslateRequest(BaseModel):
    texts: list[str] = Field(..., description="Danh sách chuỗi cần dịch (giữ thứ tự)")
    target: str = Field(..., description="Target language ISO code hoặc tên ('vi', 'vietnamese', 'en'…)")
    source: str = Field("auto", description="Source language ISO code / tên / 'auto'")
    engine: str = Field("google_free",
                         description="google_free | google_cloud | deepl | gemini | openai | claude")
    api_key: str | None = Field(None, description="API key cho cloud engine. Lưu client-side, gửi per-call.")
    model: str | None = Field(None, description="Override model cho openai/claude/gemini")


class TranslateResponse(BaseModel):
    translations: list[str]
    engine: str


@router.post("", response_model=TranslateResponse)
async def translate(req: TranslateRequest):
    try:
        out = cloud_translate_svc.translate_texts(
            texts=req.texts,
            target=req.target,
            source=req.source,
            engine=req.engine,
            api_key=req.api_key,
            model=req.model,
        )
        return {"translations": out, "engine": req.engine}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/engines")
async def list_engines():
    """Liệt kê engines cho dropdown UI."""
    return {
        "engines": [
            {"id": "google_free",  "label": "Google Translate (miễn phí)",  "needsKey": False},
            {"id": "google_cloud", "label": "Google Cloud Translate",         "needsKey": True},
            {"id": "deepl",        "label": "DeepL",                          "needsKey": True},
            {"id": "gemini",       "label": "Gemini",                         "needsKey": True},
            {"id": "openai",       "label": "OpenAI (GPT)",                   "needsKey": True},
            {"id": "claude",       "label": "Anthropic (Claude)",             "needsKey": True},
        ],
    }
