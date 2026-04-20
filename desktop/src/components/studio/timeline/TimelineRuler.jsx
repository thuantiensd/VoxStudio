import { TIMELINE_CONSTANTS } from "./useTimelineState";

/**
 * Ruler — tick + label time. Click-to-seek và drag-to-scrub.
 * Tick interval tự điều chỉnh theo zoom để không vẽ quá dày.
 */
export default function TimelineRuler({
  duration, pxPerSecond, scrollX, onSeek,
}) {
  const contentWidth = Math.max(1, duration * pxPerSecond);

  // Pick tick step sao cho label gap ~70-120px
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600];
  const majorStep =
    candidates.find((s) => s * pxPerSecond >= 60) || candidates[candidates.length - 1];
  const minorStep = majorStep / 5;

  const majorCount = Math.ceil(duration / majorStep) + 1;
  const minorCount = Math.ceil(duration / minorStep) + 1;

  const handleDown = (e) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const down = (clientX) => {
      const t = Math.max(0, (clientX - rect.left + scrollX) / pxPerSecond);
      onSeek(Math.min(duration, t));
    };
    down(e.clientX);
    const onMove = (ev) => down(ev.clientX);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      onMouseDown={handleDown}
      className="relative overflow-hidden flex-shrink-0 cursor-pointer select-none"
      style={{
        height: TIMELINE_CONSTANTS.RULER_HEIGHT,
        background: "var(--bg-base)",
        borderBottom: "1px solid rgba(127,127,160,0.15)",
      }}
    >
      <div
        className="absolute top-0 left-0 h-full"
        style={{ width: contentWidth, transform: `translateX(${-scrollX}px)` }}
      >
        {/* Minor ticks */}
        {Array.from({ length: minorCount }).map((_, i) => {
          const t = i * minorStep;
          const x = t * pxPerSecond;
          return (
            <div
              key={`mi-${i}`}
              style={{
                position: "absolute",
                left: x,
                top: 14,
                width: 1,
                height: 6,
                background: "rgba(127,127,160,0.3)",
              }}
            />
          );
        })}
        {/* Major ticks + labels */}
        {Array.from({ length: majorCount }).map((_, i) => {
          const t = i * majorStep;
          const x = t * pxPerSecond;
          return (
            <div key={`ma-${i}`}>
              <div
                style={{
                  position: "absolute",
                  left: x,
                  top: 10,
                  width: 1,
                  height: 14,
                  background: "rgba(127,127,160,0.55)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: x + 4,
                  top: 2,
                  fontSize: 10,
                  fontFamily: "ui-monospace,monospace",
                  color: "var(--text-secondary)",
                }}
              >
                {formatLabel(t, majorStep)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatLabel(t, step) {
  if (step < 1) {
    return `${t.toFixed(1)}s`;
  }
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
