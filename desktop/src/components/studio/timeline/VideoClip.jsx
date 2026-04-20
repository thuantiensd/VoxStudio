import { useMemo } from "react";
import useVideoThumbnails from "./useVideoThumbnails";
import ClipBase from "./ClipBase";

export default function VideoClip({
  clip, pxPerSecond, videoUrl, duration,
  selected, onMouseDown, onContextMenu, onResize, onResizeStart, locked,
}) {
  const interval = duration > 120 ? 2 : 1;
  const thumbWidth = 80;
  const { thumbnails, ready, progress, error } = useVideoThumbnails(
    videoUrl,
    duration,
    { interval, width: thumbWidth }
  );

  const step = useMemo(() => {
    if (!pxPerSecond) return 1;
    const minInterval = thumbWidth / pxPerSecond;
    return Math.max(1, Math.ceil(minInterval / interval));
  }, [pxPerSecond, interval]);

  return (
    <ClipBase
      clip={clip}
      pxPerSecond={pxPerSecond}
      selected={selected}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      background="rgba(71,85,105,0.6)"
      border="rgba(148,163,184,0.6)"
      onResize={onResize}
      onResizeStart={onResizeStart}
      locked={locked}
    >
      {!ready && !error && (
        <div
          className="absolute top-0 left-0 h-0.5"
          style={{
            width: `${Math.round(progress * 100)}%`,
            background: "var(--accent)",
            transition: "width 0.2s",
          }}
        />
      )}

      <div className="relative w-full h-full">
        {thumbnails
          .filter((_, i) => i % step === 0)
          .map((th) => {
            const thLeft = (th.t - clip.start + (clip.sourceStart || 0)) * pxPerSecond;
            return (
              <img
                key={th.t}
                src={th.url}
                alt=""
                draggable={false}
                style={{
                  position: "absolute",
                  left: thLeft,
                  top: 0,
                  height: "100%",
                  width: "auto",
                  maxWidth: "none",
                  objectFit: "cover",
                  pointerEvents: "none",
                  userSelect: "none",
                }}
              />
            );
          })}

        {thumbnails.length === 0 && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ color: "rgba(255,255,255,0.7)", fontSize: 10 }}
          >
            {error
              ? "video (không tải được)"
              : ready
              ? "video"
              : "đang tải video…"}
          </div>
        )}
      </div>
    </ClipBase>
  );
}
