"""
Ingest service — tải video từ URL public (TikTok / Douyin / YouTube / FB / IG /
Bilibili / Twitter …) vào 1 project dubbing mới bằng yt-dlp.

Exposes `ingest_url_generator(url)` → yields SSE dict progress:
  { step, label, progress, detail?, project_id?, title?, duration? }

Khi xong (`step == "done"`), payload có `project_id` để frontend navigate
thẳng sang trang Studio như file upload thường.

Lưu ý pháp lý:
- yt-dlp chỉ lấy URL public; app không lưu credential user.
- User tự chịu trách nhiệm bản quyền video (disclaimer hiển thị trong UI).
"""

from __future__ import annotations

import logging
import queue
import shutil
import threading
import uuid
from datetime import datetime
from pathlib import Path

import ffmpeg

from . import dubbing_svc
from .dubbing_svc import _project_dir, _save_meta, _detect_tts_engine

logger = logging.getLogger(__name__)

# Import yt-dlp lazy — nếu user chưa cài thì endpoint sẽ báo lỗi rõ ràng.
try:
    import yt_dlp  # type: ignore
    _YTDLP_AVAILABLE = True
except Exception as e:
    yt_dlp = None
    _YTDLP_AVAILABLE = False
    logger.warning("yt-dlp not installed: %s (pip install yt-dlp)", e)


def ingest_url_generator(
    url: str,
    target_language: str = "vietnamese",
    source_language: str = "auto",
    enable_dubbing: bool = True,
    enable_subtitle: bool = False,
    max_height: int = 1080,
    max_filesize_mb: int = 500,
):
    """Generator — yield SSE progress dicts khi yt-dlp tải video."""
    if not _YTDLP_AVAILABLE:
        yield {"step": "error", "progress": -1,
               "label": "yt-dlp chưa được cài trên server (pip install yt-dlp)."}
        return

    url = (url or "").strip()
    if not url:
        yield {"step": "error", "progress": -1, "label": "URL trống."}
        return

    project_id = uuid.uuid4().hex[:12]
    pdir = _project_dir(project_id)
    pdir.mkdir(parents=True, exist_ok=True)

    out_tmpl = str(pdir / "original.%(ext)s")

    q: "queue.Queue[dict | None]" = queue.Queue()

    def progress_hook(d):
        status = d.get("status")
        if status == "downloading":
            downloaded = d.get("downloaded_bytes") or 0
            total = (
                d.get("total_bytes")
                or d.get("total_bytes_estimate")
                or 0
            )
            pct = (downloaded / total * 100) if total else 0
            # 90% của bar dành cho download, 10% cho post-process + remux
            progress = round(0 + pct * 0.88, 1)
            speed = d.get("speed") or 0
            speed_str = (
                f"{speed / 1024 / 1024:.1f} MB/s" if speed > 0 else ""
            )
            eta = d.get("eta")
            eta_str = f" · còn {eta}s" if eta else ""
            detail = (speed_str + eta_str).strip(" ·")
            q.put({"step": "downloading", "progress": progress,
                   "label": "Đang tải video…",
                   "detail": detail or None})
        elif status == "finished":
            q.put({"step": "processing", "progress": 90,
                   "label": "Đang xử lý audio…"})

    def worker():
        try:
            opts = {
                "format": f"best[ext=mp4][height<={max_height}]/best[height<={max_height}]/best",
                "outtmpl": out_tmpl,
                "progress_hooks": [progress_hook],
                "quiet": True,
                "no_warnings": True,
                "noplaylist": True,
                "max_filesize": max_filesize_mb * 1024 * 1024,
                "merge_output_format": "mp4",
                "retries": 3,
                # Headers an toàn cho 1 số site
                "http_headers": {
                    "User-Agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    ),
                },
            }
            with yt_dlp.YoutubeDL(opts) as ydl:
                # Lấy metadata trước (không tải) để hiện title cho UI sớm
                try:
                    info = ydl.extract_info(url, download=False)
                    title = info.get("title") or "video"
                    duration = float(info.get("duration") or 0)
                    uploader = info.get("uploader") or info.get("channel") or ""
                    thumb = info.get("thumbnail")
                    q.put({"step": "meta", "progress": 2,
                           "label": title[:80],
                           "detail": f"{uploader} · {int(duration)}s" if duration else uploader,
                           "thumbnail": thumb})
                except Exception as e:
                    logger.warning("extract_info failed: %s", e)
                    title = "video"
                    duration = 0.0

                # Tải thật
                ydl.download([url])

            # Tìm file video output thực (yt-dlp đã lưu theo outtmpl)
            video_path = _find_output_video(pdir)
            if not video_path:
                raise RuntimeError("Không tìm thấy file video đã tải.")

            # Remux ra original.mp4 đồng nhất
            final_path = pdir / "original.mp4"
            if video_path != final_path:
                try:
                    (
                        ffmpeg.input(str(video_path))
                        .output(str(final_path), vcodec="copy", acodec="copy")
                        .overwrite_output()
                        .run(quiet=True)
                    )
                    if video_path.exists():
                        video_path.unlink()
                except Exception as e:
                    # Không remux được → dùng trực tiếp
                    logger.warning("remux failed, using as-is: %s", e)
                    if video_path != final_path:
                        shutil.move(str(video_path), str(final_path))

            # Extract audio 16kHz mono như flow create_project
            q.put({"step": "processing", "progress": 92,
                   "label": "Trích xuất audio…"})
            audio_path = pdir / "original_audio.wav"
            try:
                (
                    ffmpeg.input(str(final_path))
                    .output(str(audio_path), acodec="pcm_s16le", ac=1, ar=16000)
                    .overwrite_output()
                    .run(quiet=True)
                )
            except ffmpeg.Error as e:
                shutil.rmtree(pdir, ignore_errors=True)
                raise RuntimeError(f"ffmpeg extract audio fail: {e}")

            # Duration thật
            try:
                probe = ffmpeg.probe(str(final_path))
                duration = float(probe["format"]["duration"])
            except Exception:
                pass

            # Thumbnail
            q.put({"step": "processing", "progress": 96,
                   "label": "Tạo thumbnail…"})
            try:
                thumb_path = pdir / "thumbnail.jpg"
                thumb_at = min(1.0, duration / 2) if duration > 0 else 0
                (
                    ffmpeg.input(str(final_path), ss=thumb_at)
                    .output(str(thumb_path), vframes=1, **{"q:v": 4})
                    .overwrite_output()
                    .run(quiet=True)
                )
            except Exception as e:
                logger.warning("thumb fail: %s", e)

            # Lưu metadata project (schema giống create_project)
            safe_title = _safe_filename(title)
            filename = f"{safe_title}.mp4"
            project = {
                "id": project_id,
                "status": "created",
                "source_language": None,
                "source_language_input": source_language,
                "target_language": target_language,
                "voice_id": None,
                "tts_engine": _detect_tts_engine(),
                "edge_voice": None,
                "enable_dubbing": enable_dubbing,
                "enable_subtitle": enable_subtitle,
                "subtitle_style": _default_subtitle_style(),
                "segments": [],
                "video_filename": filename,
                "video_duration": round(duration, 2),
                "source_url": url,
                "created_at": datetime.now().isoformat(),
            }
            _save_meta(project)
            logger.info("Ingest project created: %s (%.1fs) from %s",
                        project_id, duration, url)

            q.put({"step": "done", "progress": 100,
                   "label": "Hoàn tất",
                   "project_id": project_id,
                   "title": title,
                   "filename": filename,
                   "duration": round(duration, 2)})
        except yt_dlp.utils.DownloadError as e:  # type: ignore
            shutil.rmtree(pdir, ignore_errors=True)
            msg = str(e) or "yt-dlp download error"
            q.put({"step": "error", "progress": -1, "label": msg[:300]})
        except Exception as e:
            shutil.rmtree(pdir, ignore_errors=True)
            logger.exception("ingest fail")
            q.put({"step": "error", "progress": -1, "label": str(e)[:300]})
        finally:
            q.put(None)

    threading.Thread(target=worker, daemon=True).start()
    while True:
        item = q.get()
        if item is None:
            break
        yield item


def _find_output_video(pdir: Path):
    """yt-dlp đã lưu vào pdir theo outtmpl — tìm file video kết quả."""
    direct = pdir / "original.mp4"
    if direct.exists():
        return direct
    for ext in ("mp4", "mkv", "webm", "mov"):
        for p in pdir.glob(f"original.{ext}"):
            return p
    # Fallback — file video đầu tiên trong dir
    for p in pdir.iterdir():
        if p.is_file() and p.suffix.lower() in (".mp4", ".mkv", ".webm", ".mov"):
            return p
    return None


def _safe_filename(name: str) -> str:
    keep = "".join(c if c.isalnum() or c in " _-." else "_" for c in name)
    keep = keep.strip().strip(".") or "video"
    return keep[:80]


def _default_subtitle_style():
    return {
        "font_family": "Arial", "font_size": 24, "font_color": "#FFFFFF",
        "font_bold": False, "font_italic": False,
        "bg_color": "#000000", "bg_opacity": 0.6,
        "outline_color": "#000000", "outline_width": 2, "shadow_offset": 1,
        "position": "bottom", "margin_v": 30,
    }
