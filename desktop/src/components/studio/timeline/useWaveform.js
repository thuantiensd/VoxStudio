import { useEffect, useState } from "react";

/**
 * useWaveform — fetch audio từ URL rồi decode + downsample ra mảng peaks.
 * Trả về { peaks: Float32Array, ready, error }.
 *
 * peaks: dạng interleave [min0, max0, min1, max1, ...] — mỗi "pixel ảo"
 * có 2 giá trị biên để vẽ dải dọc trên canvas.
 *
 * Kích thước cố định `resolution = 2000` bucket cho cả audio,
 * đủ chi tiết với timeline dài vài phút; clip sẽ sample lại theo width
 * khi vẽ.
 */
const cache = new Map();
const RESOLUTION = 2000;

export default function useWaveform(url) {
  const [state, setState] = useState({
    peaks: null,
    ready: false,
    error: null,
  });

  useEffect(() => {
    if (!url) return;
    const cached = cache.get(url);
    if (cached) {
      setState({ peaks: cached, ready: true, error: null });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("fetch failed " + res.status);
        const buf = await res.arrayBuffer();
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = new AC();
        const audio = await ctx.decodeAudioData(buf);
        const ch = audio.getChannelData(0);
        const step = Math.max(1, Math.floor(ch.length / RESOLUTION));
        const peaks = new Float32Array(RESOLUTION * 2);
        for (let i = 0; i < RESOLUTION; i++) {
          let min = 1, max = -1;
          const start = i * step;
          const end = Math.min(ch.length, start + step);
          for (let j = start; j < end; j++) {
            const v = ch[j];
            if (v < min) min = v;
            if (v > max) max = v;
          }
          peaks[i * 2] = min;
          peaks[i * 2 + 1] = max;
        }
        ctx.close?.();
        if (cancelled) return;
        cache.set(url, peaks);
        setState({ peaks, ready: true, error: null });
      } catch (e) {
        if (!cancelled) setState({ peaks: null, ready: true, error: e });
      }
    })();

    return () => { cancelled = true; };
  }, [url]);

  return state;
}

export { RESOLUTION };
