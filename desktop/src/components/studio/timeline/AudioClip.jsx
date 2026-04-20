import { useEffect, useRef } from "react";
import useWaveform, { RESOLUTION } from "./useWaveform";
import ClipBase from "./ClipBase";

export default function AudioClip({
  clip, pxPerSecond, audioUrl, duration,
  color = "var(--accent)",
  selected, onMouseDown, onContextMenu, onResize, onResizeStart, locked,
}) {
  const canvasRef = useRef(null);
  const { peaks, ready, error } = useWaveform(audioUrl);
  const width = Math.max(4, clip.duration * pxPerSecond);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(cv.offsetWidth));
    const h = Math.max(1, Math.floor(cv.offsetHeight));
    cv.width = w * dpr;
    cv.height = h * dpr;
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    if (!peaks || peaks.length === 0) return;

    const srcStart = clip.sourceStart || 0;
    const srcEnd = srcStart + clip.duration;
    const secsPerBucket = (duration || clip.duration) / RESOLUTION;
    const startBucket = Math.floor(srcStart / secsPerBucket);
    const endBucket = Math.min(RESOLUTION, Math.ceil(srcEnd / secsPerBucket));
    const totalBuckets = Math.max(1, endBucket - startBucket);

    ctx.fillStyle = cssResolve(color);
    const mid = h / 2;
    for (let px = 0; px < w; px++) {
      const bucketIdx = startBucket + Math.floor((px / w) * totalBuckets);
      const min = peaks[bucketIdx * 2] ?? 0;
      const max = peaks[bucketIdx * 2 + 1] ?? 0;
      const y1 = mid + min * mid;
      const y2 = mid + max * mid;
      ctx.fillRect(px, Math.min(y1, y2), 1, Math.max(1, Math.abs(y2 - y1)));
    }
  }, [peaks, width, clip.duration, clip.sourceStart, duration, color]);

  return (
    <ClipBase
      clip={clip}
      pxPerSecond={pxPerSecond}
      selected={selected}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      background="rgba(108,92,231,0.2)"
      border="rgba(108,92,231,0.65)"
      onResize={onResize}
      onResizeStart={onResizeStart}
      locked={locked}
    >
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      {(!ready || error || !peaks) && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ color: "rgba(255,255,255,0.7)", fontSize: 10 }}
        >
          {error ? "audio (không tải được)" : !peaks && ready ? "audio" : "đang phân tích…"}
        </div>
      )}
    </ClipBase>
  );
}

function cssResolve(value) {
  if (typeof value === "string" && value.startsWith("var(")) {
    const name = value.slice(4, -1).trim();
    const resolved = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    return resolved || "#6c5ce7";
  }
  return value;
}
