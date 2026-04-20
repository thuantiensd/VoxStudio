import VideoClip from "./VideoClip";
import AudioClip from "./AudioClip";
import ClipBase from "./ClipBase";
import useClipInteraction from "./useClipInteraction";

export default function TimelineTrack({
  track, pxPerSecond,
  videoUrl, duration,
  audioUrlByTrack = {},
  tracks, selection, setSelection,
  snapEnabled, playhead, setClipStart, setSnapGuide,
  resizeClip, commit,
  trackAreaRef, moveClipToTrack, addTrack, cleanupTracks,
  onClickEmpty, openContextMenu,
}) {
  return (
    <div
      onMouseDown={(e) => {
        // Click vào vùng trống → clear selection
        if (e.target === e.currentTarget) onClickEmpty?.();
      }}
      className="relative flex-shrink-0"
      style={{
        height: track.height,
        background: "rgba(255,255,255,0.015)",
        borderBottom: "1px solid rgba(127,127,160,0.08)",
        opacity: track.hidden ? 0.35 : 1,
      }}
    >
      {track.clips.map((clip) => (
        <ClipHost
          key={clip.id}
          clip={clip}
          track={track}
          tracks={tracks}
          pxPerSecond={pxPerSecond}
          selection={selection}
          setSelection={setSelection}
          snapEnabled={snapEnabled}
          playhead={playhead}
          duration={duration}
          setClipStart={setClipStart}
          setSnapGuide={setSnapGuide}
          resizeClip={resizeClip}
          commit={commit}
          trackAreaRef={trackAreaRef}
          moveClipToTrack={moveClipToTrack}
          addTrack={addTrack}
          cleanupTracks={cleanupTracks}
          openContextMenu={openContextMenu}
          videoUrl={videoUrl}
          audioUrl={audioUrlByTrack[track.id]}
        />
      ))}
    </div>
  );
}

/**
 * ClipHost — gắn useClipInteraction vào đúng loại clip component.
 * Tách ra để hook chỉ chạy mỗi clip, không bị lặp trên cả track.
 */
function ClipHost({
  clip, track, tracks, pxPerSecond, selection, setSelection,
  snapEnabled, playhead, duration,
  setClipStart, setSnapGuide, resizeClip, commit,
  trackAreaRef, moveClipToTrack, addTrack, cleanupTracks,
  openContextMenu,
  videoUrl, audioUrl,
}) {
  const { isSelected, onMouseDown } = useClipInteraction({
    clip, track, tracks, selection, setSelection,
    pxPerSecond, snapEnabled, playhead, duration,
    setClipStart, setSnapGuide, commit,
    trackAreaRef, moveClipToTrack, addTrack, cleanupTracks,
  });
  const onResize = resizeClip ? (patch) => resizeClip(clip.id, patch) : null;
  const onResizeStart = commit ? () => commit() : null;
  const onContextMenu = openContextMenu
    ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Đảm bảo select clip trước khi mở menu
        if (!selection.has(clip.id)) setSelection([clip.id]);
        openContextMenu(e.clientX, e.clientY, clip.id);
      }
    : null;

  if (clip.type === "video") {
    return (
      <VideoClip
        clip={clip}
        pxPerSecond={pxPerSecond}
        videoUrl={videoUrl}
        duration={duration}
        selected={isSelected}
        onMouseDown={onMouseDown}
        onResize={onResize}
        onResizeStart={onResizeStart}
        onContextMenu={onContextMenu}
        locked={track.locked}
      />
    );
  }
  if (clip.type === "audio") {
    const color = track.id === "A2" ? "#22c55e" : "var(--accent)";
    return (
      <AudioClip
        clip={clip}
        pxPerSecond={pxPerSecond}
        audioUrl={audioUrl}
        duration={duration}
        color={color}
        selected={isSelected}
        onMouseDown={onMouseDown}
        onResize={onResize}
        onResizeStart={onResizeStart}
        onContextMenu={onContextMenu}
        locked={track.locked}
      />
    );
  }
  // subtitle / text
  return (
    <ClipBase
      clip={clip}
      pxPerSecond={pxPerSecond}
      selected={isSelected}
      onMouseDown={onMouseDown}
      background="rgba(249,115,22,0.28)"
      border="rgba(249,115,22,0.75)"
      title={clip.text}
      onResize={onResize}
      onResizeStart={onResizeStart}
      onContextMenu={onContextMenu}
      locked={track.locked}
    >
      <div
        className="h-full flex items-center px-2"
        style={{ color: "var(--text-primary)", fontSize: 11 }}
      >
        <span className="truncate">{clip.text || "…"}</span>
      </div>
    </ClipBase>
  );
}
