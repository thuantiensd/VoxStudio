import { useCallback, useEffect, useRef } from "react";
import { TIMELINE_CONSTANTS } from "./useTimelineState";

/**
 * Playhead — vạch dọc xuyên ruler + tracks. Có handle tam giác trên ruler
 * để drag seek. Bản thân component không tự scroll, chỉ render theo state.
 */
export default function Playhead({ time, pxPerSecond, scrollX, duration, onSeek }) {
  const draggingRef = useRef(false);
  const x = time * pxPerSecond - scrollX + TIMELINE_CONSTANTS.HEADER_WIDTH;

  const onDown = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = true;
      const startX = e.clientX;
      const startTime = time;
      const onMove = (ev) => {
        if (!draggingRef.current) return;
        const dt = (ev.clientX - startX) / pxPerSecond;
        onSeek(Math.max(0, Math.min(duration, startTime + dt)));
      };
      const onUp = () => {
        draggingRef.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [time, pxPerSecond, duration, onSeek]
  );

  useEffect(() => () => { draggingRef.current = false; }, []);

  if (x < TIMELINE_CONSTANTS.HEADER_WIDTH - 2) return null;

  return (
    <>
      {/* Handle tam giác trên ruler */}
      <div
        onMouseDown={onDown}
        style={{
          position: "absolute",
          left: x - 6,
          top: 0,
          width: 12,
          height: TIMELINE_CONSTANTS.RULER_HEIGHT,
          cursor: "ew-resize",
          zIndex: 30,
        }}
      >
        <div
          style={{
            width: 0,
            height: 0,
            borderLeft: "6px solid transparent",
            borderRight: "6px solid transparent",
            borderTop: "8px solid #fff",
            position: "absolute",
            top: TIMELINE_CONSTANTS.RULER_HEIGHT - 8,
            left: 0,
          }}
        />
      </div>
      {/* Vạch dọc xuyên toàn timeline */}
      <div
        style={{
          position: "absolute",
          left: x,
          top: 0,
          bottom: 0,
          width: 1,
          background: "#fff",
          pointerEvents: "none",
          zIndex: 25,
          boxShadow: "0 0 3px rgba(255,255,255,0.4)",
        }}
      />
    </>
  );
}
