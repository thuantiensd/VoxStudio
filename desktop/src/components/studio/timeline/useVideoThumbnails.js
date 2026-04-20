import { useEffect, useState } from "react";

/**
 * useVideoThumbnails — extract 1 thumbnail mỗi `interval` giây từ video URL.
 * Trả về { thumbnails: [{t, url}], ready, error, progress }.
 *
 * Chạy trong hidden <video> + <canvas>, URL là blob: để giải phóng sau unmount.
 * Cache theo `${url}|${interval}|${width}` trong memory để không extract lại
 * khi chuyển tab / remount.
 */
const cache = new Map();

export default function useVideoThumbnails(url, duration, {
  interval = 1,
  width = 80,
} = {}) {
  const [state, setState] = useState({
    thumbnails: [],
    ready: false,
    error: null,
    progress: 0,
  });

  useEffect(() => {
    if (!url || !duration || duration <= 0) return;
    const key = `${url}|${interval}|${width}`;
    const cached = cache.get(key);
    if (cached) {
      setState({ thumbnails: cached, ready: true, error: null, progress: 1 });
      return;
    }

    let cancelled = false;
    const video = document.createElement("video");
    video.src = url;
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const thumbs = [];
    const stamps = [];

    const onLoaded = async () => {
      const aspect = video.videoWidth / video.videoHeight || 16 / 9;
      const h = Math.round(width / aspect);
      canvas.width = width;
      canvas.height = h;

      for (let t = 0; t < duration; t += interval) {
        stamps.push(t);
      }

      for (let i = 0; i < stamps.length; i++) {
        if (cancelled) return;
        const t = stamps[i];
        await seek(video, t);
        if (cancelled) return;
        try {
          ctx.drawImage(video, 0, 0, width, h);
          const blob = await new Promise((res) =>
            canvas.toBlob(res, "image/jpeg", 0.7)
          );
          if (!blob) continue;
          const blobUrl = URL.createObjectURL(blob);
          thumbs.push({ t, url: blobUrl });
          setState({
            thumbnails: [...thumbs],
            ready: false,
            error: null,
            progress: (i + 1) / stamps.length,
          });
        } catch (e) {
          // Cross-origin / decode lỗi → thoát sớm
          setState((s) => ({ ...s, error: e, ready: true }));
          return;
        }
      }

      cache.set(key, thumbs);
      setState({ thumbnails: thumbs, ready: true, error: null, progress: 1 });
    };

    const onErr = (e) => {
      setState((s) => ({ ...s, error: e, ready: true }));
    };

    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("error", onErr);

    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onErr);
      video.src = "";
      video.remove();
      // Không revoke blob URL ở đây — cache còn dùng ở lần remount sau.
    };
  }, [url, duration, interval, width]);

  return state;
}

function seek(video, t) {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    try {
      video.currentTime = Math.min(t, Math.max(0, (video.duration || t) - 0.01));
    } catch {
      resolve();
    }
  });
}
