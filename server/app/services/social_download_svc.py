"""
Social download service — tải video từ TikTok / Douyin / YouTube / Facebook /
Instagram / Bilibili / Twitter / …

Chiến lược 2-layer:
  1. Douyin_TikTok_Scraper (pip: douyin-tiktok-scraper) — cho TikTok/Douyin/
     Bilibili có thuật toán signing riêng, nhanh + không cần browser.
  2. yt-dlp (với curl-cffi impersonation) — fallback cho các site khác + khi
     scraper trên fail.

Exposes:
  - async fetch_info(url) → InfoResult { title, thumbnail, author, duration,
                                          video_url, audio_url, platform, ... }
  - download_to_file_generator(url, dest_path) — SSE generator yield progress
  - download_to_project_generator(url, target_language, ...) — SSE + tạo project
"""

from __future__ import annotations

import asyncio
import logging
import os
import queue
import shutil
import threading
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import ffmpeg
import httpx

logger = logging.getLogger(__name__)

# ── Optional deps (graceful if missing) ────────────────────────
try:
    from douyin_tiktok_scraper.scraper import Scraper as _DTScraper
    _DT_OK = True
except Exception as e:
    _DTScraper = None
    _DT_OK = False
    logger.warning("douyin-tiktok-scraper not installed: %s", e)

try:
    import yt_dlp
    _YTDLP_OK = True
except Exception as e:
    yt_dlp = None
    _YTDLP_OK = False
    logger.warning("yt-dlp not installed: %s", e)


# ── Unified info schema ────────────────────────────────────────
@dataclass
class InfoResult:
    url: str
    platform: str           # tiktok | douyin | youtube | facebook | instagram | bilibili | twitter | generic
    title: str
    author: str | None
    thumbnail: str | None
    duration: float         # seconds
    video_url: str | None   # direct mp4/m3u8 URL (ưu tiên no-watermark)
    watermark_url: str | None
    audio_url: str | None
    source: str             # "scraper" | "ytdlp" — nguồn lấy metadata

    def to_dict(self):
        return asdict(self)


_DT_DOMAINS = ("tiktok.com", "douyin.com", "bilibili.com", "iesdouyin.com",
               "vt.tiktok.com", "vm.tiktok.com", "b23.tv", "xiaohongshu.com",
               "weibo.com", "kuaishou.com")


def _classify(url: str) -> str:
    host = (urlparse(url).hostname or "").lower().lstrip("www.")
    if "tiktok" in host: return "tiktok"
    if "douyin" in host: return "douyin"
    if "youtube" in host or host == "youtu.be": return "youtube"
    if "facebook" in host or "fb.watch" in host: return "facebook"
    if "instagram" in host: return "instagram"
    if "bilibili" in host or host == "b23.tv": return "bilibili"
    if host in ("twitter.com", "x.com", "t.co"): return "twitter"
    return "generic"


# ── Fetch info ─────────────────────────────────────────────────
async def fetch_info(url: str, engine: str = "auto") -> InfoResult:
    """Lấy metadata + direct URL.

    engine:
      - "auto"    : scraper trước (nếu platform match), fallback yt-dlp
      - "scraper" : CHỈ Douyin scraper, không fallback
      - "ytdlp"   : CHỈ yt-dlp
    """
    url = (url or "").strip()
    if not url or not url.lower().startswith(("http://", "https://")):
        raise ValueError("URL không hợp lệ (cần http:// hoặc https://).")

    platform = _classify(url)
    engine = (engine or "auto").lower()

    # Forced engine paths
    if engine == "scraper":
        if not _DT_OK:
            raise RuntimeError("douyin-tiktok-scraper chưa cài trên server.")
        info = await _fetch_via_scraper(url, platform)
        if not info or not info.video_url:
            raise RuntimeError(
                "Scraper không lấy được video URL. Thuật toán signing có thể "
                "đã lỗi thời. Thử engine 'yt-dlp'."
            )
        return info

    if engine == "ytdlp":
        if not _YTDLP_OK:
            raise RuntimeError("yt-dlp chưa cài trên server.")
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _fetch_via_ytdlp, url, platform)

    # engine == "auto" — smart fallback
    # 1. Douyin scraper cho TikTok/Douyin/Bilibili nếu khả dụng
    scraper_err = None
    if _DT_OK and platform in ("tiktok", "douyin", "bilibili"):
        try:
            info = await _fetch_via_scraper(url, platform)
            if info and info.video_url:
                return info
            logger.info("Scraper empty video_url, falling back to yt-dlp")
        except Exception as e:
            scraper_err = e
            logger.warning("Scraper fail: %s — falling back yt-dlp", e)

    # 2. yt-dlp fallback
    if _YTDLP_OK:
        loop = asyncio.get_running_loop()
        try:
            return await loop.run_in_executor(None, _fetch_via_ytdlp, url, platform)
        except Exception as ytdlp_err:
            # Show both errors if scraper was also tried
            if scraper_err:
                raise RuntimeError(
                    f"Cả 2 engine đều fail. Scraper: {str(scraper_err)[:120]} · "
                    f"yt-dlp: {str(ytdlp_err)[:120]}"
                )
            raise

    raise RuntimeError("Cả 2 engine đều không sẵn sàng trên server.")


async def _fetch_via_scraper(url: str, platform: str) -> InfoResult | None:
    scraper = _DTScraper()
    data = await scraper.hybrid_parsing(url)
    if not data or data.get("status") != "success":
        return None
    d = data.get("data") or {}
    # Đọc các field theo shape của scraper (khác nhau giữa tiktok/douyin/bilibili)
    title = d.get("desc") or d.get("title") or ""
    author = ((d.get("author") or {}).get("nickname")
              or (d.get("author") or {}).get("name")
              or d.get("owner", {}).get("name") if isinstance(d.get("owner"), dict) else None)
    if isinstance(d.get("author"), str):
        author = d.get("author")
    duration = float(d.get("duration", 0) or 0) / 1000 if d.get("duration", 0) > 1000 else float(d.get("duration", 0) or 0)
    thumbnail = None
    for k in ("origin_cover", "dynamic_cover", "cover"):
        v = d.get(k)
        if isinstance(v, str):
            thumbnail = v; break
        if isinstance(v, dict):
            urls = v.get("url_list") or []
            if urls:
                thumbnail = urls[0]; break
    # Video URL (ưu tiên no-watermark)
    video_url = None
    watermark_url = None
    vd = d.get("video_data") or {}
    if vd:
        video_url = vd.get("nwm_video_url_HQ") or vd.get("nwm_video_url") \
                  or vd.get("nwm_video_list", [None])[0]
        watermark_url = vd.get("wm_video_url_HQ") or vd.get("wm_video_url")
    # Douyin / TikTok direct fields
    if not video_url:
        for k in ("play_addr", "video_url", "play"):
            v = d.get(k)
            if isinstance(v, str):
                video_url = v; break
            if isinstance(v, dict):
                urls = v.get("url_list") or []
                if urls: video_url = urls[0]; break
    # Bilibili: `video_url` thường là m3u8 hoặc mp4 dashes
    audio_url = d.get("music", {}).get("play_url", {}).get("url_list", [None])[0] \
                if isinstance(d.get("music"), dict) else None

    if not video_url:
        return None
    return InfoResult(
        url=url, platform=platform,
        title=title or "video", author=author,
        thumbnail=thumbnail, duration=round(duration, 2),
        video_url=video_url, watermark_url=watermark_url,
        audio_url=audio_url, source="scraper",
    )


def _fetch_via_ytdlp(url: str, platform: str) -> InfoResult:
    opts = {"quiet": True, "no_warnings": True, "skip_download": True,
            "noplaylist": True}
    _attach_chrome_cookies(opts)
    try:
        with yt_dlp.YoutubeDL(opts) as y:
            info = y.extract_info(url, download=False)
    except Exception as e:
        msg = str(e)
        # Dịch các lỗi phổ biến sang tiếng Việt dễ hiểu
        if "Log in for access" in msg or "login" in msg.lower():
            raise RuntimeError(
                "Video cần ĐĂNG NHẬP để xem. Mở Chrome → login TikTok/YouTube/… "
                "→ Cmd+Q Chrome → thử lại."
            )
        if "IP address is blocked" in msg:
            raise RuntimeError(
                "IP bị TikTok chặn. Thử dùng video không age-restricted, hoặc "
                "dùng VPN thay đổi IP."
            )
        if "Private video" in msg or "Video unavailable" in msg:
            raise RuntimeError("Video private hoặc đã bị xoá.")
        if "Sign in to confirm your age" in msg:
            raise RuntimeError(
                "Video giới hạn độ tuổi. Login YouTube trong Chrome (Cmd+Q Chrome) "
                "rồi thử lại."
            )
        if "HTTP Error 404" in msg:
            raise RuntimeError("URL không tồn tại (404). Kiểm tra lại link.")
        if "HTTP Error 403" in msg:
            raise RuntimeError("Server chặn (403). Login vào site trong Chrome rồi thử lại.")
        if "DRM" in msg or "widevine" in msg.lower():
            raise RuntimeError("Video có DRM protection — không tải được.")
        if "geo" in msg.lower() and "block" in msg.lower():
            raise RuntimeError("Video bị chặn theo vùng địa lý.")
        # Strip ANSI color codes cho dễ đọc
        import re
        clean = re.sub(r"\x1b\[[0-9;]*m", "", msg)
        raise RuntimeError(clean[:280])
    if not info:
        raise RuntimeError("yt-dlp trả về rỗng")
    video_url = info.get("url")
    # Nếu là manifest, pick format tốt nhất có mp4
    formats = info.get("formats") or []
    if not video_url:
        mp4s = [f for f in formats if f.get("ext") == "mp4" and f.get("url") and f.get("vcodec") != "none"]
        if mp4s:
            # sort by height desc
            mp4s.sort(key=lambda f: f.get("height") or 0, reverse=True)
            video_url = mp4s[0].get("url")
    if not video_url and formats:
        # Any usable URL
        cands = [f for f in formats if f.get("url") and f.get("vcodec") != "none"]
        cands.sort(key=lambda f: f.get("height") or 0, reverse=True)
        if cands: video_url = cands[0].get("url")
    if not video_url:
        raise RuntimeError("yt-dlp không trả direct URL (có thể DRM hoặc HLS)")
    return InfoResult(
        url=url, platform=platform,
        title=info.get("title") or "video",
        author=info.get("uploader") or info.get("channel") or info.get("creator"),
        thumbnail=info.get("thumbnail"),
        duration=float(info.get("duration") or 0),
        video_url=video_url,
        watermark_url=None,
        audio_url=None,
        source="ytdlp",
    )


def _attach_chrome_cookies(opts: dict):
    """Thử các browser user có cài — yt-dlp sẽ pick browser đầu tiên có cookie.
    Chrome phải được ĐÓNG HẲN (Cmd+Q) để cookie DB unlock.
    """
    candidates = []
    # macOS paths
    if os.path.exists(os.path.expanduser("~/Library/Application Support/Google/Chrome")):
        candidates.append("chrome")
    if os.path.exists(os.path.expanduser("~/Library/Safari")):
        candidates.append("safari")
    if os.path.exists(os.path.expanduser("~/Library/Application Support/Firefox/Profiles")):
        candidates.append("firefox")
    if os.path.exists(os.path.expanduser("~/Library/Application Support/Microsoft Edge")):
        candidates.append("edge")
    if os.path.exists(os.path.expanduser("~/Library/Application Support/BraveSoftware/Brave-Browser")):
        candidates.append("brave")
    # Linux paths
    if os.path.exists(os.path.expanduser("~/.config/google-chrome")):
        candidates.append("chrome")
    if os.path.exists(os.path.expanduser("~/.mozilla/firefox")):
        candidates.append("firefox")
    # Windows paths
    if os.path.exists(os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome")):
        candidates.append("chrome")
    if candidates:
        # Yt-dlp chỉ chấp nhận 1 browser — ưu tiên Chrome > Safari > Firefox
        for b in ("chrome", "safari", "firefox", "edge", "brave"):
            if b in candidates:
                opts["cookiesfrombrowser"] = (b,)
                logger.info("yt-dlp: using cookies from %s", b)
                break


# ── Download to disk with progress ─────────────────────────────
def download_to_file_generator(info: InfoResult, dest_path: Path,
                               max_filesize_mb: int = 500):
    """Yield {step, progress, label, detail?} khi tải file từ info.video_url
    về dest_path. Dùng httpx stream."""
    q: "queue.Queue[dict | None]" = queue.Queue()

    def worker():
        try:
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            max_bytes = max_filesize_mb * 1024 * 1024
            downloaded = 0
            last_emit = 0.0
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/131.0.0.0 Safari/537.36"
                ),
            }
            # Referer giúp TikTok/Douyin không block download
            if info.platform == "tiktok":
                headers["Referer"] = "https://www.tiktok.com/"
            elif info.platform == "douyin":
                headers["Referer"] = "https://www.douyin.com/"
            elif info.platform == "bilibili":
                headers["Referer"] = "https://www.bilibili.com/"

            import time
            with httpx.stream("GET", info.video_url, headers=headers,
                              follow_redirects=True, timeout=30) as r:
                r.raise_for_status()
                total = int(r.headers.get("content-length", 0) or 0)
                if total > max_bytes:
                    raise RuntimeError(
                        f"File quá lớn: {total/1024/1024:.0f}MB > {max_filesize_mb}MB giới hạn."
                    )
                with open(dest_path, "wb") as f:
                    for chunk in r.iter_bytes(chunk_size=1024 * 64):
                        f.write(chunk)
                        downloaded += len(chunk)
                        if downloaded > max_bytes:
                            raise RuntimeError("Vượt giới hạn file size.")
                        now = time.time()
                        if now - last_emit > 0.2 and total:
                            pct = downloaded / total * 100
                            q.put({"step": "downloading",
                                   "progress": round(pct * 0.88, 1),
                                   "label": "Đang tải video…",
                                   "detail": f"{downloaded/1024/1024:.1f} / {total/1024/1024:.1f} MB"})
                            last_emit = now
            q.put({"step": "processing", "progress": 90,
                   "label": "Đang xử lý…"})
        except httpx.HTTPError as e:
            q.put({"step": "error", "progress": -1,
                   "label": f"HTTP {getattr(e.response, 'status_code', '?')}: {str(e)[:200]}"})
        except Exception as e:
            logger.exception("download fail")
            q.put({"step": "error", "progress": -1, "label": str(e)[:280]})
        finally:
            q.put(None)

    threading.Thread(target=worker, daemon=True).start()
    while True:
        item = q.get()
        if item is None: break
        yield item


# ── High-level: download URL → VoxStudio project ───────────────
def download_to_project_generator(url: str,
                                  target_language: str = "vietnamese",
                                  source_language: str = "auto",
                                  enable_dubbing: bool = True,
                                  enable_subtitle: bool = False,
                                  use_watermark: bool = False,
                                  engine: str = "auto"):
    """Full flow: fetch info → download → create dubbing project. Yields SSE.
    Cuối cùng yield {step:"done", project_id, title, filename, duration}."""
    from .dubbing_svc import _project_dir, _save_meta, _detect_tts_engine

    # Resolve info (sync wrapper)
    try:
        yield {"step": "resolving", "progress": 2, "label": "Đang phân tích URL…"}
        loop = asyncio.new_event_loop()
        try:
            info = loop.run_until_complete(fetch_info(url, engine=engine))
        finally:
            loop.close()
    except Exception as e:
        yield {"step": "error", "progress": -1, "label": str(e)[:280]}
        return

    # Override với watermark url nếu user yêu cầu
    if use_watermark and info.watermark_url:
        info.video_url = info.watermark_url

    yield {"step": "meta", "progress": 5,
           "label": info.title[:80] or "video",
           "detail": (info.author or "") + (f" · {int(info.duration)}s" if info.duration else ""),
           "thumbnail": info.thumbnail}

    project_id = uuid.uuid4().hex[:12]
    pdir = _project_dir(project_id)
    pdir.mkdir(parents=True, exist_ok=True)
    final_path = pdir / "original.mp4"

    # Download
    had_error = False
    for tick in download_to_file_generator(info, final_path):
        if tick.get("step") == "error":
            shutil.rmtree(pdir, ignore_errors=True)
            had_error = True
            yield tick
            break
        yield tick
    if had_error:
        return

    # Post process — audio + duration + thumb
    try:
        audio_path = pdir / "original_audio.wav"
        (
            ffmpeg.input(str(final_path))
            .output(str(audio_path), acodec="pcm_s16le", ac=1, ar=16000)
            .overwrite_output().run(quiet=True)
        )
        try:
            probe = ffmpeg.probe(str(final_path))
            duration = float(probe["format"]["duration"])
        except Exception:
            duration = info.duration or 0.0
        # Thumbnail
        try:
            thumb_path = pdir / "thumbnail.jpg"
            ts = min(1.0, duration / 2) if duration else 0
            (
                ffmpeg.input(str(final_path), ss=ts)
                .output(str(thumb_path), vframes=1, **{"q:v": 4})
                .overwrite_output().run(quiet=True)
            )
        except Exception as e:
            logger.warning("thumb fail: %s", e)
        # Metadata
        safe_title = _safe_filename(info.title)
        filename = f"{safe_title}.mp4"
        project = {
            "id": project_id, "status": "created",
            "source_language": None, "source_language_input": source_language,
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
            "source_platform": info.platform,
            "source_author": info.author,
            "created_at": datetime.now().isoformat(),
        }
        _save_meta(project)
        yield {"step": "done", "progress": 100,
               "label": "Hoàn tất",
               "project_id": project_id,
               "title": info.title,
               "filename": filename,
               "duration": round(duration, 2),
               "platform": info.platform,
               "thumbnail": info.thumbnail}
    except Exception as e:
        shutil.rmtree(pdir, ignore_errors=True)
        logger.exception("post-process fail")
        yield {"step": "error", "progress": -1, "label": str(e)[:280]}


def _safe_filename(name: str) -> str:
    keep = "".join(c if c.isalnum() or c in " _-." else "_" for c in (name or ""))
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
