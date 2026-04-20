import {
  Play, Pause, Undo2, Redo2, Scissors,
  Trash2, Copy, Magnet, ZoomIn, ZoomOut,
} from "lucide-react";
import { TIMELINE_CONSTANTS } from "./useTimelineState";

function fmt(s) {
  if (!s || !isFinite(s)) return "0:00.0";
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${String(sec).padStart(4, "0")}`;
}

export default function TimelineToolbar({
  playing, onTogglePlay,
  playhead, duration,
  snapEnabled, onToggleSnap,
  pxPerSecond, onZoom,
  onUndo, onRedo, onSplit, onDelete, onDuplicate,
  canUndo = false, canRedo = false, hasSelection = false,
}) {
  const zoomIn = () =>
    onZoom(Math.min(TIMELINE_CONSTANTS.MAX_PX_PER_SEC, pxPerSecond * 1.5));
  const zoomOut = () =>
    onZoom(Math.max(TIMELINE_CONSTANTS.MIN_PX_PER_SEC, pxPerSecond / 1.5));

  return (
    <div
      className="flex items-center gap-2 px-3 h-10 flex-shrink-0"
      style={{
        background: "var(--bg-surface)",
        borderBottom: "1px solid rgba(127,127,160,0.15)",
      }}
    >
      <Btn onClick={onTogglePlay} title="Space">
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </Btn>
      <span
        className="text-xs font-mono"
        style={{ color: "var(--text-secondary)", minWidth: 100 }}
      >
        {fmt(playhead)} / {fmt(duration)}
      </span>

      <Divider />

      <Btn onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        <Undo2 size={13} />
      </Btn>
      <Btn onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
        <Redo2 size={13} />
      </Btn>

      <Divider />

      <Btn onClick={onSplit} disabled={!hasSelection} title="Split (K)">
        <Scissors size={13} />
      </Btn>
      <Btn onClick={onDuplicate} disabled={!hasSelection} title="Duplicate (Ctrl+D)">
        <Copy size={13} />
      </Btn>
      <Btn onClick={onDelete} disabled={!hasSelection} title="Delete">
        <Trash2 size={13} />
      </Btn>

      <div className="flex-1" />

      <Btn
        onClick={onToggleSnap}
        active={snapEnabled}
        title="Snap (S)"
      >
        <Magnet size={13} />
      </Btn>

      <Divider />

      <Btn onClick={zoomOut} title="Zoom out">
        <ZoomOut size={13} />
      </Btn>
      <input
        type="range"
        min={TIMELINE_CONSTANTS.MIN_PX_PER_SEC}
        max={TIMELINE_CONSTANTS.MAX_PX_PER_SEC}
        value={pxPerSecond}
        onChange={(e) => onZoom(parseFloat(e.target.value))}
        className="w-28"
        style={{ accentColor: "var(--accent)" }}
      />
      <Btn onClick={zoomIn} title="Zoom in">
        <ZoomIn size={13} />
      </Btn>
    </div>
  );
}

function Btn({ children, onClick, disabled, active, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="p-1.5 rounded transition-colors disabled:opacity-30"
      style={{
        background: active ? "rgba(108,92,231,0.15)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-secondary)",
      }}
      onMouseEnter={(e) => {
        if (!disabled && !active)
          e.currentTarget.style.background = "rgba(255,255,255,0.06)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return (
    <div
      className="w-px h-5"
      style={{ background: "rgba(127,127,160,0.2)" }}
    />
  );
}
