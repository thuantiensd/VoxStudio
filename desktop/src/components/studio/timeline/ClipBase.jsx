import { useCallback } from "react";

const HANDLE_W = 6;

/**
 * ClipBase — khung ngoài dùng chung cho mọi clip.
 *   - Body: select + drag (onMouseDown từ useClipInteraction).
 *   - 2 trim handle ở mép trái/phải, stopPropagation để không trigger drag.
 */
export default function ClipBase({
  clip, pxPerSecond, selected, onMouseDown, onContextMenu,
  background, border, children, title,
  onResize, // (patch) => void
  onResizeStart, // () => void — dùng để commit history trước khi trim
  locked = false,
}) {
  const left = clip.start * pxPerSecond;
  const width = Math.max(4, clip.duration * pxPerSecond);

  const startTrim = useCallback(
    (side) => (e) => {
      if (locked || !onResize) return;
      e.preventDefault();
      e.stopPropagation();
      onResizeStart?.();
      const startX = e.clientX;
      const start0 = clip.start;
      const duration0 = clip.duration;
      const sourceStart0 = clip.sourceStart || 0;

      const onMove = (ev) => {
        const dSec = (ev.clientX - startX) / pxPerSecond;
        if (side === "left") {
          let nextStart = Math.max(0, start0 + dSec);
          const maxShift = duration0 - 0.1; // chừa min duration
          if (nextStart > start0 + maxShift) nextStart = start0 + maxShift;
          const shift = nextStart - start0;
          onResize({
            start: nextStart,
            duration: Math.max(0.1, duration0 - shift),
            sourceStart: Math.max(0, sourceStart0 + shift),
          });
        } else {
          const nextDur = Math.max(0.1, duration0 + dSec);
          onResize({ duration: nextDur });
        }
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [clip, pxPerSecond, onResize, onResizeStart, locked]
  );

  return (
    <div
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      className="absolute rounded overflow-hidden group"
      style={{
        top: 4,
        bottom: 4,
        left,
        width,
        background,
        border: `${selected ? 2 : 1}px solid ${selected ? "#fff" : border}`,
        boxShadow: selected ? "0 0 0 1px var(--accent)" : "none",
        cursor: locked ? "not-allowed" : "grab",
        userSelect: "none",
      }}
      title={title || clip.id}
    >
      {children}

      {/* Trim handles */}
      {onResize && !locked && width > HANDLE_W * 3 && (
        <>
          <div
            onMouseDown={startTrim("left")}
            className="absolute top-0 bottom-0 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{
              left: 0,
              width: HANDLE_W,
              cursor: "ew-resize",
              background: selected
                ? "rgba(255,255,255,0.9)"
                : "rgba(255,255,255,0.4)",
              zIndex: 2,
            }}
          />
          <div
            onMouseDown={startTrim("right")}
            className="absolute top-0 bottom-0 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{
              right: 0,
              width: HANDLE_W,
              cursor: "ew-resize",
              background: selected
                ? "rgba(255,255,255,0.9)"
                : "rgba(255,255,255,0.4)",
              zIndex: 2,
            }}
          />
        </>
      )}
    </div>
  );
}
