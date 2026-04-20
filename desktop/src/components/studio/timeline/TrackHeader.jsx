import { Eye, EyeOff, Volume2, VolumeX, Lock, Unlock, Film, Mic, Music, Type } from "lucide-react";
import { TIMELINE_CONSTANTS } from "./useTimelineState";

const KIND_ICON = {
  video: Film,
  audio: Mic,
  subtitle: Type,
};

export default function TrackHeader({ track, onToggleMute, onToggleLock, onToggleHidden }) {
  const Icon = track.kind === "audio" && track.id === "A2" ? Music : (KIND_ICON[track.kind] || Film);
  // Track text/subtitle không có âm → ẩn icon loa (không có tác dụng).
  const hasAudio = track.kind === "video" || track.kind === "audio";

  return (
    <div
      className="flex items-center gap-2 px-2 flex-shrink-0 select-none"
      style={{
        width: TIMELINE_CONSTANTS.HEADER_WIDTH,
        height: track.height,
        background: "var(--bg-surface)",
        borderBottom: "1px solid rgba(127,127,160,0.1)",
        borderRight: "1px solid rgba(127,127,160,0.15)",
      }}
    >
      <Icon size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
      <span
        className="flex-1 text-xs truncate"
        style={{ color: "var(--text-primary)" }}
        title={track.label}
      >
        {track.label}
      </span>
      {hasAudio && (
        <IconBtn onClick={onToggleMute} active={track.muted} title="Mute">
          {track.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
        </IconBtn>
      )}
      <IconBtn onClick={onToggleLock} active={track.locked} title="Lock">
        {track.locked ? <Lock size={11} /> : <Unlock size={11} />}
      </IconBtn>
      <IconBtn onClick={onToggleHidden} active={track.hidden} title="Hide">
        {track.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
      </IconBtn>
    </div>
  );
}

function IconBtn({ children, onClick, active, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-0.5 rounded transition-colors"
      style={{
        color: active ? "var(--accent)" : "var(--text-secondary)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}
