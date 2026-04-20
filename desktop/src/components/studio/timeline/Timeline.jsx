import { useEffect, useRef, useCallback, useState } from "react";
import { TIMELINE_CONSTANTS } from "./useTimelineState";
import TimelineToolbar from "./TimelineToolbar";
import TimelineRuler from "./TimelineRuler";
import TrackHeader from "./TrackHeader";
import TimelineTrack from "./TimelineTrack";
import Playhead from "./Playhead";
import SnapGuide from "./SnapGuide";
import ContextMenu, { Scissors, Copy, Trash2 } from "./ContextMenu";
import {
  dubbingVideoURL, dubbedTrackURL, accompanimentURL,
  updateSegment, deleteSegment, splitSegment,
} from "../../../services/api";

/**
 * Timeline — root.
 *   ┌ Toolbar ┐
 *   │ Ruler   │ ← sticky top trong scroll ngang
 *   │ Tracks  │ ← scroll X đồng bộ với ruler; header sticky left
 *   └─────────┘
 *
 * Props:
 *   project    — để derive state
 *   playhead   — thời gian hiện tại (sec) từ player cha
 *   playing    — bool để toolbar hiển thị icon đúng
 *   onSeek     — gọi khi user drag playhead/click ruler
 *   onTogglePlay
 */
export default function Timeline({
  project, playhead, playing, onSeek, onTogglePlay,
  state, actions,
}) {
  const scrollerRef = useRef(null);
  const [menu, setMenu] = useState(null); // {x,y,clipId}

  const tracks = state.tracks;
  const totalTrackHeight = tracks.reduce((sum, t) => sum + t.height, 0);

  // Sync scroll X với state để ruler vẽ chính xác
  const onScroll = useCallback(
    (e) => {
      actions.setScrollX(e.currentTarget.scrollLeft);
    },
    [actions]
  );

  // Ctrl+wheel → zoom tại vị trí chuột
  const onWheel = useCallback(
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const el = scrollerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left + el.scrollLeft;
      const timeUnderMouse = mouseX / state.pxPerSecond;

      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const nextPx = Math.max(
        TIMELINE_CONSTANTS.MIN_PX_PER_SEC,
        Math.min(TIMELINE_CONSTANTS.MAX_PX_PER_SEC, state.pxPerSecond * factor)
      );
      actions.setZoom(nextPx);

      // Giữ điểm dưới chuột đứng yên
      requestAnimationFrame(() => {
        if (!scrollerRef.current) return;
        scrollerRef.current.scrollLeft = timeUnderMouse * nextPx - (e.clientX - rect.left);
      });
    },
    [state.pxPerSecond, actions]
  );

  // Helper tìm clip theo id xuyên tracks
  const findClip = useCallback(
    (id) => {
      for (const t of state.tracks) {
        const c = t.clips.find((x) => x.id === id);
        if (c) return c;
      }
      return null;
    },
    [state.tracks]
  );

  // Sync split/delete subtitle lên backend (best-effort, không block UI)
  const syncSubtitleSplit = useCallback(
    (clip, atTime) => {
      if (!clip?.segmentId) return;
      if (!project?.id || project.id === "demo") return;
      splitSegment(project.id, clip.segmentId, atTime).catch(() => {});
    },
    [project?.id]
  );
  const syncSubtitleDelete = useCallback(
    (clip) => {
      if (!clip?.segmentId) return;
      if (!project?.id || project.id === "demo") return;
      deleteSegment(project.id, clip.segmentId).catch(() => {});
    },
    [project?.id]
  );

  // Helpers dùng cho toolbar + phím tắt
  const hasSelection = state.selection.size > 0;
  const handleSplit = useCallback(() => {
    if (state.selection.size !== 1) return;
    const [clipId] = state.selection;
    const clip = findClip(clipId);
    if (!clip) return;
    syncSubtitleSplit(clip, playhead);
    actions.commit();
    actions.splitClip(clipId, playhead);
  }, [state.selection, playhead, actions, findClip, syncSubtitleSplit]);

  const handleDelete = useCallback(() => {
    if (state.selection.size === 0) return;
    const ids = Array.from(state.selection);
    ids.forEach((id) => {
      const clip = findClip(id);
      if (clip) syncSubtitleDelete(clip);
    });
    actions.commit();
    actions.deleteClips(ids);
  }, [state.selection, actions, findClip, syncSubtitleDelete]);

  const handleDuplicate = useCallback(() => {
    if (state.selection.size === 0) return;
    actions.commit();
    actions.duplicateClips(Array.from(state.selection));
  }, [state.selection, actions]);

  const openContextMenu = useCallback((x, y, clipId) => {
    setMenu({ x, y, clipId });
  }, []);

  const menuItems = menu
    ? [
        {
          id: "split",
          icon: <Scissors size={12} />,
          label: "Chia tại playhead",
          shortcut: "K",
          onClick: handleSplit,
          disabled: (() => {
            const c = findClip(menu.clipId);
            return !c || playhead <= c.start || playhead >= c.start + c.duration;
          })(),
        },
        {
          id: "duplicate",
          icon: <Copy size={12} />,
          label: "Nhân đôi",
          shortcut: "⌘D",
          onClick: handleDuplicate,
        },
        {
          id: "delete",
          icon: <Trash2 size={12} />,
          label: "Xóa",
          shortcut: "Del",
          onClick: handleDelete,
          danger: true,
        },
      ]
    : [];

  // Keyboard: Space = play/pause, S = snap, K = split,
  // Del = delete, Ctrl+D = duplicate
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        onTogglePlay?.();
      } else if (e.key === "s" || e.key === "S") {
        actions.toggleSnap();
      } else if (e.key === "k" || e.key === "K") {
        handleSplit();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        handleDelete();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        handleDuplicate();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        actions.undo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        ((e.shiftKey && (e.key === "z" || e.key === "Z")) || e.key === "y" || e.key === "Y")
      ) {
        e.preventDefault();
        actions.redo();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onTogglePlay, actions, handleSplit, handleDelete, handleDuplicate]);

  // Debounced sync: khi subtitle clip đổi start/duration, gọi updateSegment.
  // Bỏ qua demo mode (project.id === "demo") và clip không có segmentId.
  const lastSentRef = useRef(new Map());
  useEffect(() => {
    if (!project?.id || project.id === "demo") return;
    const t1 = state.tracks.find((t) => t.id === "T1");
    if (!t1) return;
    const timer = setTimeout(() => {
      t1.clips.forEach((c) => {
        if (!c.segmentId) return;
        const end = c.start + c.duration;
        const prev = lastSentRef.current.get(c.segmentId);
        if (prev && prev.start === c.start && prev.end === end) return;
        lastSentRef.current.set(c.segmentId, { start: c.start, end });
        updateSegment(project.id, c.segmentId, { start: c.start, end }).catch(
          () => {}
        );
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [state.tracks, project?.id]);

  const contentWidth = Math.max(1, state.duration * state.pxPerSecond);

  return (
    <div
      className="flex flex-col"
      style={{
        background: "var(--bg-primary)",
        borderTop: "1px solid rgba(127,127,160,0.15)",
      }}
    >
      <TimelineToolbar
        playing={playing}
        onTogglePlay={onTogglePlay}
        playhead={playhead}
        duration={state.duration}
        snapEnabled={state.snapEnabled}
        onToggleSnap={actions.toggleSnap}
        pxPerSecond={state.pxPerSecond}
        onZoom={actions.setZoom}
        onUndo={actions.undo}
        onRedo={actions.redo}
        canUndo={state.__undo.length > 0}
        canRedo={state.__redo.length > 0}
        onSplit={handleSplit}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        hasSelection={hasSelection}
      />

      {/* Relative wrapper chứa Playhead xuyên */}
      <div
        className="relative flex-1 flex flex-col min-h-0"
        style={{ overflow: "hidden" }}
      >
        {/* Ruler row — chia 2 phần: header chỗ + ruler nội dung */}
        <div
          className="flex flex-shrink-0"
          style={{ position: "sticky", top: 0, zIndex: 20 }}
        >
          <div
            style={{
              width: TIMELINE_CONSTANTS.HEADER_WIDTH,
              height: TIMELINE_CONSTANTS.RULER_HEIGHT,
              background: "var(--bg-surface)",
              borderRight: "1px solid rgba(127,127,160,0.15)",
              borderBottom: "1px solid rgba(127,127,160,0.15)",
            }}
          />
          <div className="flex-1 min-w-0">
            <TimelineRuler
              duration={state.duration}
              pxPerSecond={state.pxPerSecond}
              scrollX={state.scrollX}
              onSeek={onSeek}
            />
          </div>
        </div>

        {/* Tracks */}
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          onWheel={onWheel}
          className="flex-1 overflow-auto"
          style={{ minHeight: totalTrackHeight + 8 }}
        >
          {/* Row = header (sticky left) + track body */}
          {tracks.map((track) => (
            <div key={track.id} className="flex">
              <div style={{ position: "sticky", left: 0, zIndex: 15 }}>
                <TrackHeader
                  track={track}
                  onToggleMute={() => actions.toggleTrackMute(track.id)}
                  onToggleLock={() => actions.toggleTrackLock(track.id)}
                  onToggleHidden={() => actions.toggleTrackHidden(track.id)}
                />
              </div>
              <div style={{ width: contentWidth, flexShrink: 0 }}>
                <TimelineTrack
                  track={track}
                  tracks={state.tracks}
                  pxPerSecond={state.pxPerSecond}
                  videoUrl={dubbingVideoURL(project.id)}
                  duration={state.duration}
                  audioUrlByTrack={{
                    A1: dubbedTrackURL(project.id),
                    A2: project.has_accompaniment
                      ? accompanimentURL(project.id)
                      : null,
                  }}
                  selection={state.selection}
                  setSelection={actions.setSelection}
                  snapEnabled={state.snapEnabled}
                  playhead={playhead}
                  setClipStart={actions.setClipStart}
                  setSnapGuide={actions.setSnapGuide}
                  resizeClip={actions.resizeClip}
                  commit={actions.commit}
                  trackAreaRef={scrollerRef}
                  moveClipToTrack={actions.moveClipToTrack}
                  addTrack={actions.addTrack}
                  cleanupTracks={actions.cleanupTracks}
                  openContextMenu={openContextMenu}
                  onClickEmpty={actions.clearSelection}
                />
              </div>
            </div>
          ))}
          <div style={{ height: 20 }} />
        </div>

        <SnapGuide
          time={state.snapGuide}
          pxPerSecond={state.pxPerSecond}
          scrollX={state.scrollX}
        />

        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menuItems}
            onClose={() => setMenu(null)}
          />
        )}

        {/* Playhead phủ toàn vùng (nằm ngoài scroll vì dùng scrollX từ state) */}
        <Playhead
          time={playhead}
          pxPerSecond={state.pxPerSecond}
          scrollX={state.scrollX}
          duration={state.duration}
          onSeek={onSeek}
        />
      </div>
    </div>
  );
}

