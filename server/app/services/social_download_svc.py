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
            raise RuntimeError("Chế độ Nhanh chưa sẵn sàng trên server.")
        if platform == "tiktok":
            raise RuntimeError(
                "Chế độ Nhanh tạm thời không hỗ trợ TikTok ổn định. "
                "Hãy chuyển sang chế độ Toàn năng."
            )
        if platform not in ("douyin", "bilibili"):
            raise RuntimeError(
                "Chế độ Nhanh chỉ hỗ trợ Douyin, Bilibili. "
                "Với link khác hãy dùng chế độ Toàn năng."
            )
        try:
            info = await _fetch_via_scraper(url, platform)
        except Exception as e:
            raise RuntimeError(
                f"Chế độ Nhanh thất bại. Chuyển Toàn năng rồi thử lại. "
                f"(Chi tiết: {str(e)[:120]})"
            )
        if not info or not info.video_url:
            raise RuntimeError(
                "Chế độ Nhanh không lấy được video. Chuyển sang chế độ "
                "Toàn năng rồi thử lại."
            )
        return info

    if engine == "ytdlp":
        if not _YTDLP_OK:
            raise RuntimeError("Chế độ Toàn năng chưa sẵn sàng trên server.")
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _fetch_via_ytdlp, url, platform)

    # engine == "auto" — smart fallback
    # 1. Scraper chỉ thử với Douyin/Bilibili vì TikTok signing hiện không ổn
    #    (PyPI douyin-tiktok-scraper 1.2.9 outdated → ContentTypeError retry).
    #    TikTok trong auto mode sẽ skip thẳng sang yt-dlp.
    scraper_err = None
    if _DT_OK and platform in ("douyin", "bilibili"):
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
                    f"Cả 2 chế độ đều thất bại. Nhanh: {str(scraper_err)[:120]} · "
                    f"Toàn năng: {str(ytdlp_err)[:120]}"
                )
            raise

    raise RuntimeError("Cả 2 chế độ đều không sẵn sàng trên server.")


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
        msg = str(e).replace("yt-dlp:", "").replace("[yt-dlp]", "").strip()
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
        # Strip ANSI color + technical names cho dễ đọc
        import re
        clean = re.sub(r"\x1b\[[0-9;]*m", "", msg)
        clean = re.sub(r"\[?(yt-dlp|TikTok|YouTube|Facebook|Instagram|Douyin|Bilibili)\]?\s*:?\s*",
                       "", clean, flags=re.IGNORECASE)
        clean = re.sub(r"ERROR:\s*", "", clean, flags=re.IGNORECASE)
        clean = clean.strip()
        raise RuntimeError(clean[:280] or "Không tải được video.")
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


# ── yt-dlp download (auto-merge video+audio) ────────────────────
def _download_via_ytdlp(url: str, pdir: Path, final_path: Path):
    """Generator yield progress. Dùng yt-dlp download+merge thay vì httpx
    stream 1 URL — fix case DASH có video/audio tách riêng (FB/YouTube).
    yt-dlp tự merge qua ffmpeg khi merge_output_format='mp4'."""
    q: "queue.Queue[dict | None]" = queue.Queue()

    def progress_hook(d):
        status = d.get("status")
        if status == "downloading":
            downloaded = d.get("downloaded_bytes") or 0
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            pct = (downloaded / total * 100) if total else 0
            progress = round(5 + pct * 0.83, 1)  # 5→88%
            speed = d.get("speed") or 0
            speed_str = f"{speed / 1024 / 1024:.1f} MB/s" if speed > 0 else ""
            eta = d.get("eta")
            eta_str = f" · còn {eta}s" if eta else ""
            detail = (speed_str + eta_str).strip(" ·")
            q.put({"step": "downloading", "progress": progress,
                   "label": "Đang tải video…", "detail": detail or None})
        elif status == "finished":
            # Có thể là video xong, chuẩn bị merge audio
            q.put({"step": "processing", "progress": 90,
                   "label": "Đang ghép video + audio…"})

    def worker():
        try:
            outtmpl = str(pdir / "original.%(ext)s")
            # Ưu tiên format đã combined (video+audio trong 1 stream) để
            # không cần ffmpeg merge — tránh lỗi merge khi ffmpeg binary
            # path không match. Fallback merge bestvideo+bestaudio nếu
            # không có combined sẵn.
            common_opts = {
                "outtmpl": outtmpl,
                "merge_output_format": "mp4",
                "progress_hooks": [progress_hook],
                "quiet": True,
                "no_warnings": True,
                "noplaylist": True,
                "retries": 3,
                "max_filesize": 500 * 1024 * 1024,
                # Tăng tốc download DASH segments song song — YouTube/FB chia
                # video thành nhiều fragments, mặc định tải tuần tự 1 connection.
                # concurrent_fragments=8 = tải 8 chunk song song → x4-6 tốc độ.
                "concurrent_fragment_downloads": 8,
                # YouTube throttle aggressive cho web_safari client. iOS client
                # (bypass throttle) thường cho tốc độ full bandwidth.
                "extractor_args": {
                    "youtube": {
                        "player_client": ["ios", "web"],
                    },
                },
                "http_headers": {
                    "User-Agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/131.0.0.0 Safari/537.36"
                    ),
                },
            }
            # Set ffmpeg_location từ PATH nếu có — yt-dlp cần binary để merge
            import shutil as _shutil
            ffbin = _shutil.which("ffmpeg")
            if ffbin:
                common_opts["ffmpeg_location"] = ffbin
            _attach_chrome_cookies(common_opts)

            # Format selector priority (ưu tiên H.264 để SKIP transcode step
            # trên Mac, tiết kiệm 10-30s/video):
            #   1. H.264 video (avc1/avc3/h264) + AAC audio → no transcode needed
            #   2. Any combined progressive stream (có cả video+audio sẵn)
            #   3. Any bestvideo+bestaudio (DASH merge + transcode sau nếu AV1)
            # Cap 1080p vì 4K/8K không đáng tải cho dubbing use case (tốn dung
            # lượng + thời gian, chất lượng vẫn thừa cho social upload).
            opts_final = dict(common_opts,
                format=(
                    # 1. H.264 merge (bỏ transcode)
                    "bestvideo[vcodec^=avc][height<=1080]+bestaudio[acodec=aac]/"
                    "bestvideo[vcodec^=avc][height<=1080]+bestaudio/"
                    # 2. Progressive combined (TikTok/Douyin)
                    "best[vcodec^=avc][acodec!=none][height<=1080]/"
                    "best[acodec!=none][vcodec!=none][height<=1080]/"
                    # 3. Fallback: any video+audio merge (có thể AV1 → transcode)
                    "bestvideo[height<=1080]+bestaudio/"
                    "best[height<=1080]/best"
                ))
            with yt_dlp.YoutubeDL(opts_final) as ydl:
                info = ydl.extract_info(url, download=True)
                logger.info("yt-dlp picked format: %s (vcodec=%s acodec=%s)",
                            info.get("format_id"), info.get("vcodec"), info.get("acodec"))

            # yt-dlp đã save theo outtmpl — file có thể là .mp4 hoặc extension khác.
            # Tìm file và rename về original.mp4 nếu cần.
            import os as _os
            for ext in ("mp4", "mkv", "webm", "mov"):
                cand = pdir / f"original.{ext}"
                if cand.exists():
                    if cand != final_path:
                        # Remux sang mp4 nếu extension khác
                        try:
                            (
                                ffmpeg.input(str(cand))
                                .output(str(final_path), vcodec="copy", acodec="copy")
                                .overwrite_output().run(quiet=True)
                            )
                            cand.unlink()
                        except Exception as e:
                            logger.warning("remux fail, using as-is: %s", e)
                            shutil.move(str(cand), str(final_path))
                    break
            if not final_path.exists():
                raise RuntimeError("yt-dlp không tạo ra file output.")
            # Verify + transcode nếu codec không phổ thông (AV1, HEVC 10-bit…).
            # FB/YouTube giờ hay dùng AV1 (av01) — QuickTime + một số player
            # không decode được. Transcode sang H.264 + AAC để tương thích
            # toàn bộ: QuickTime, VLC, iOS, Windows, ffmpeg pipeline dubbing.
            try:
                probe = ffmpeg.probe(str(final_path))
                streams = probe.get("streams", [])
                vstream = next((s for s in streams if s.get("codec_type") == "video"), None)
                astreams = [s for s in streams if s.get("codec_type") == "audio"]
                has_audio = len(astreams) > 0
                vcodec = (vstream or {}).get("codec_name", "")
                if not has_audio:
                    logger.warning("File KHÔNG có audio stream (yt-dlp format lỗi?).")
                # Transcode nếu vcodec không phải h264 (AVC) hoặc chưa có audio
                needs_transcode = vcodec.lower() in ("av1", "av01", "hevc", "vp9", "vp8")
                if needs_transcode:
                    q.put({"step": "processing", "progress": 91,
                           "label": "Đang chuyển mã sang H.264 (QuickTime compat)…"})
                    _transcode_to_h264(final_path)
                    logger.info("Transcoded %s → H.264", vcodec)
            except Exception as e:
                logger.warning("post-download probe/transcode fail: %s", e)
            q.put({"step": "processing", "progress": 92,
                   "label": "Hoàn tất tải, xử lý audio…"})
        except Exception as e:
            msg = str(e)
            import re as _re
            clean = _re.sub(r"\x1b\[[0-9;]*m", "", msg)
            clean = _re.sub(r"\[?(yt-dlp|TikTok|YouTube|Facebook|Instagram|Douyin|Bilibili)\]?\s*:?\s*",
                            "", clean, flags=_re.IGNORECASE)
            q.put({"step": "error", "progress": -1, "label": clean[:280]})
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

    # Download — 2 paths khác nhau:
    #   source='ytdlp': dùng yt-dlp download() để auto merge video+audio
    #                   (DASH streams như YouTube/FB thường tách riêng).
    #   source='scraper': httpx stream URL đơn (TikTok/Douyin mobile API
    #                     thường trả URL combined sẵn).
    had_error = False
    if info.source == "ytdlp":
        for tick in _download_via_ytdlp(url, pdir, final_path):
            if tick.get("step") == "error":
                shutil.rmtree(pdir, ignore_errors=True)
                had_error = True
                yield tick
                break
            yield tick
    else:
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
        # Probe trước để biết có audio stream không + lấy duration thật
        try:
            probe = ffmpeg.probe(str(final_path))
            duration = float(probe["format"]["duration"])
            streams = probe.get("streams", [])
            has_audio = any(s.get("codec_type") == "audio" for s in streams)
        except Exception as e:
            logger.warning("ffprobe fail: %s", e)
            duration = info.duration or 0.0
            has_audio = True  # giả định có audio để thử extract

        audio_path = pdir / "original_audio.wav"
        if has_audio:
            try:
                (
                    ffmpeg.input(str(final_path))
                    .output(str(audio_path), acodec="pcm_s16le", ac=1, ar=16000)
                    .overwrite_output().run(quiet=True, capture_stderr=True)
                )
            except ffmpeg.Error as e:
                err = (e.stderr.decode("utf-8", errors="ignore") if e.stderr else "")[:300]
                logger.warning("audio extract fail (will create silent): %s", err)
                _create_silent_wav(audio_path, duration or 1.0)
        else:
            # Video không có audio track → tạo audio im lặng để pipeline dub
            # (transcribe sẽ thấy silence → empty segments → user vẫn export được
            # video gốc + thêm phụ đề/dub thủ công).
            logger.info("Video không có audio stream — tạo silent track placeholder")
            _create_silent_wav(audio_path, duration or 1.0)
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


def _transcode_to_h264(path: Path):
    """Re-encode video sang H.264 + AAC để tương thích QuickTime / iOS /
    Windows Media Player. Giữ original nếu transcode fail."""
    tmp = path.with_suffix(".h264.mp4")
    try:
        (
            ffmpeg.input(str(path))
            .output(
                str(tmp),
                vcodec="libx264",
                **{
                    "preset": "fast",
                    "crf": 22,           # chất lượng ~visually lossless cho web video
                    "pix_fmt": "yuv420p", # QuickTime require yuv420p
                    "profile:v": "high",
                    "level": "4.0",
                },
                acodec="aac",
                **{"b:a": "128k", "ac": 2, "ar": 44100},
                movflags="+faststart",   # moov atom ở đầu → QuickTime open nhanh
            )
            .overwrite_output().run(quiet=True, capture_stderr=True)
        )
        # Replace original
        path.unlink(missing_ok=True)
        tmp.rename(path)
    except ffmpeg.Error as e:
        err = (e.stderr.decode("utf-8", errors="ignore") if e.stderr else "")[:300]
        logger.warning("transcode fail: %s", err)
        if tmp.exists():
            try: tmp.unlink()
            except Exception: pass
        raise


def _create_silent_wav(path: Path, duration_s: float):
    """Tạo file WAV im lặng 16kHz mono — placeholder khi video không có audio."""
    try:
        (
            ffmpeg
            .input(f"anullsrc=channel_layout=mono:sample_rate=16000",
                   f="lavfi", t=max(0.5, duration_s))
            .output(str(path), acodec="pcm_s16le", ac=1, ar=16000)
            .overwrite_output().run(quiet=True)
        )
    except Exception as e:
        logger.warning("silent wav fail: %s", e)
        # Last resort: write minimal valid WAV header
        try:
            import wave
            with wave.open(str(path), "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
                w.writeframes(b"\x00\x00" * 16000)  # 1s silence
        except Exception as e2:
            logger.error("fallback silent wav fail: %s", e2)


def _default_subtitle_style():
    return {
        "font_family": "Arial", "font_size": 24, "font_color": "#FFFFFF",
        "font_bold": False, "font_italic": False,
        "bg_color": "#000000", "bg_opacity": 0.6,
        "outline_color": "#000000", "outline_width": 2, "shadow_offset": 1,
        "position": "bottom", "margin_v": 30,
    }
