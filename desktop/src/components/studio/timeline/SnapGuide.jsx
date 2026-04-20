import { TIMELINE_CONSTANTS } from "./useTimelineState";

/**
 * SnapGuide — vạch vàng dọc hiển thị khi clip đang drag chạm mốc snap.
 * Ẩn khi time=null.
 */
export default function SnapGuide({ time, pxPerSecond, scrollX }) {
  if (time == null) return null;
  const x = time * pxPerSecond - scrollX + TIMELINE_CONSTANTS.HEADER_WIDTH;
  if (x < TIMELINE_CONSTANTS.HEADER_WIDTH) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: 0,
        bottom: 0,
        width: 1,
        background: "#facc15",
        boxShadow: "0 0 6px rgba(250,204,21,0.8)",
        pointerEvents: "none",
        zIndex: 28,
      }}
    />
  );
}
