import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { ZoomIn, ZoomOut, Scissors, Volume2, VolumeX, Trash2, GitMerge, Copy } from 'lucide-react';

const RULER_H = 26;
const TRACK_H = 36;
const TRACK_GAP = 1;
const MIN_PX_PER_SEC = 4;
const MAX_PX_PER_SEC = 60;
const HANDLE_W = 6;
const SNAP_THRESHOLD_PX = 6;
const MIN_SEG_DURATION = 0.3; // seconds

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtTimePrecise(s) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, '0')}`;
}

export default function Timeline({
  segments, duration, selectedId, onSelect, onSeek, currentTime = 0,
  trimStart = 0, trimEnd, onTrimChange, onSplitAtPlayhead,
  onSegmentTimeChange, onDeleteSegment, onMergeSegments,
  // Track states
  hasAccompaniment = false,
  muteOriginal = false, onToggleMuteOriginal,
  muteDubbed = false, onToggleMuteDubbed,
  muteAccomp = false, onToggleMuteAccomp,
}) {
  const containerRef = useRef(null);
  const [pxPerSec, setPxPerSec] = useState(12);
  const [hoveredSeg, setHoveredSeg] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Drag state: { type: 'trim-start'|'trim-end'|'seg-start'|'seg-end'|'seg-move', segId?, origStart?, origEnd?, mouseStartX? }
  const [drag, setDrag] = useState(null);
  // Preview of drag result (for visual feedback before committing)
  const [dragPreview, setDragPreview] = useState(null);
  // Snap line position (seconds) during drag
  const [snapLine, setSnapLine] = useState(null);
  // Right-click context menu
  const [contextMenu, setContextMenu] = useState(null); // { x, y, segId }

  const effectiveTrimEnd = trimEnd ?? duration;
  const totalWidth = duration * pxPerSec;

  // Build snap points from segment edges + playhead
  const snapPoints = useMemo(() => {
    const pts = [0, duration, currentTime];
    segments.forEach(s => { pts.push(s.start, s.end); });
    return [...new Set(pts)].sort((a, b) => a - b);
  }, [segments, duration, currentTime]);

  // Snap a time value to nearby points
  const snapTime = useCallback((time) => {
    const threshold = SNAP_THRESHOLD_PX / pxPerSec;
    let best = time;
    let bestDist = threshold;
    for (const pt of snapPoints) {
      const dist = Math.abs(time - pt);
      if (dist < bestDist) {
        bestDist = dist;
        best = pt;
      }
    }
    setSnapLine(best !== time ? best : null);
    return best;
  }, [snapPoints, pxPerSec]);

  // Track definitions
  const tracks = useMemo(() => {
    const t = [
      { id: 'video', label: 'Video', color: '#3b82f6', muted: false, onToggle: null },
    ];
    if (hasAccompaniment) {
      t.push(
        { id: 'vocals', label: 'Vocals', color: '#f59e0b', muted: muteOriginal, onToggle: onToggleMuteOriginal },
        { id: 'bgmusic', label: 'BG Music', color: '#22c55e', muted: muteAccomp, onToggle: onToggleMuteAccomp },
      );
    } else {
      t.push(
        { id: 'audio', label: 'Audio', color: '#888', muted: muteOriginal, onToggle: onToggleMuteOriginal },
      );
    }
    t.push(
      { id: 'dubbed', label: 'Dubbed', color: '#7c3aed', muted: muteDubbed, onToggle: onToggleMuteDubbed },
      { id: 'scenes', label: 'Scenes', color: '#888', muted: false, onToggle: null },
    );
    return t;
  }, [hasAccompaniment, muteOriginal, muteDubbed, muteAccomp, onToggleMuteOriginal, onToggleMuteDubbed, onToggleMuteAccomp]);

  const totalTracksH = TRACK_H * tracks.length + TRACK_GAP * (tracks.length - 1);

  // ── Mouse position → time helper ──
  const mouseToTime = useCallback((e) => {
    const el = containerRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + el.scrollLeft;
    return Math.max(0, Math.min(x / pxPerSec, duration));
  }, [pxPerSec, duration]);

  // ── Zoom ──
  const handleWheel = useCallback((e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setPxPerSec(prev => Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, prev * (e.deltaY < 0 ? 1.15 : 0.87))));
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Auto-scroll playhead
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const px = currentTime * pxPerSec;
    const vl = el.scrollLeft, vr = vl + el.clientWidth;
    if (px < vl + 40 || px > vr - 40) el.scrollLeft = Math.max(0, px - el.clientWidth * 0.3);
  }, [currentTime, pxPerSec]);

  // ── Click to seek ──
  const handleTimelineClick = (e) => {
    if (drag) return;
    const time = mouseToTime(e);
    onSeek?.(time);
  };

  // ── Unified drag handler ──
  useEffect(() => {
    if (!drag) return;

    const onMove = (e) => {
      const time = mouseToTime(e);
      const snapped = snapTime(time);

      if (drag.type === 'trim-start') {
        const clamped = Math.max(0, Math.min(snapped, effectiveTrimEnd - 0.5));
        onTrimChange?.(clamped, effectiveTrimEnd);
      } else if (drag.type === 'trim-end') {
        const clamped = Math.max(trimStart + 0.5, Math.min(snapped, duration));
        onTrimChange?.(trimStart, clamped);
      } else if (drag.type === 'seg-start') {
        // Resize segment from left edge
        const newStart = Math.max(0, Math.min(snapped, drag.origEnd - MIN_SEG_DURATION));
        setDragPreview({ segId: drag.segId, start: newStart, end: drag.origEnd });
      } else if (drag.type === 'seg-end') {
        // Resize segment from right edge
        const newEnd = Math.max(drag.origStart + MIN_SEG_DURATION, Math.min(snapped, duration));
        setDragPreview({ segId: drag.segId, start: drag.origStart, end: newEnd });
      } else if (drag.type === 'seg-move') {
        // Move entire segment
        const dx = (e.clientX - drag.mouseStartX) / pxPerSec;
        const segDur = drag.origEnd - drag.origStart;
        let newStart = snapTime(drag.origStart + dx);
        newStart = Math.max(0, Math.min(newStart, duration - segDur));
        setDragPreview({ segId: drag.segId, start: newStart, end: newStart + segDur });
      }
    };

    const onUp = () => {
      // Commit segment drag
      if (dragPreview && onSegmentTimeChange) {
        onSegmentTimeChange(dragPreview.segId, dragPreview.start, dragPreview.end);
      }
      setDrag(null);
      setDragPreview(null);
      setSnapLine(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, dragPreview, mouseToTime, snapTime, onTrimChange, onSegmentTimeChange,
      trimStart, effectiveTrimEnd, duration, pxPerSec]);

  // ── Close context menu ──
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [contextMenu]);

  // ── Right-click on segment ──
  const handleSegContextMenu = (e, segId) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, segId });
    onSelect?.(segId);
  };

  // Get segment display times (use preview if dragging)
  const getSegTimes = (seg) => {
    if (dragPreview && dragPreview.segId === seg.id) {
      return { start: dragPreview.start, end: dragPreview.end };
    }
    return { start: seg.start, end: seg.end };
  };

  // ── Visual helpers ──
  const zoomPercent = ((pxPerSec - MIN_PX_PER_SEC) / (MAX_PX_PER_SEC - MIN_PX_PER_SEC)) * 100;
  const interval = pxPerSec > 30 ? 5 : pxPerSec > 15 ? 10 : pxPerSec > 8 ? 30 : 60;
  const ticks = [];
  for (let t = 0; t <= duration; t += interval) ticks.push(t);

  const segColor = (seg) => {
    if (seg.id === selectedId) return 'var(--accent)';
    switch (seg.status) {
      case 'done': return '#22c55e';
      case 'generating': return '#f59e0b';
      case 'error': return '#ef4444';
      default: return '#4a4a6a';
    }
  };

  const playheadX = currentTime * pxPerSec;
  const trimStartX = trimStart * pxPerSec;
  const trimEndX = effectiveTrimEnd * pxPerSec;
  const trimWidth = trimEndX - trimStartX;

  // Waveform bars
  const waveformBars = (color, muted, seed = 0) => {
    const count = Math.min(Math.floor(totalWidth / 4), 300);
    return (
      <div className="flex items-center h-full px-0.5 gap-px overflow-hidden">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} style={{
            width: 2, borderRadius: 1, flexShrink: 0,
            height: `${20 + Math.sin((i + seed) * 0.6) * 30 + Math.sin((i + seed) * 1.3) * 15}%`,
            background: muted ? '#333' : color, opacity: muted ? 0.3 : 0.45,
          }} />
        ))}
      </div>
    );
  };

  // ── Editable segment block (used in scenes + dubbed tracks) ──
  const renderEditableSegment = (seg, trackColor, showText = false) => {
    const { start, end } = getSegTimes(seg);
    const left = start * pxPerSec;
    const width = Math.max((end - start) * pxPerSec, 2);
    const isSelected = seg.id === selectedId;
    const isDragging = dragPreview?.segId === seg.id;

    return (
      <div key={`e-${seg.id}`}
        className="absolute group"
        style={{
          left, width, top: 2, height: TRACK_H - 4,
          zIndex: isDragging ? 20 : isSelected ? 15 : 1,
        }}>

        {/* Main body — drag to move */}
        <div
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            onSelect?.(seg.id);
            setDrag({
              type: 'seg-move', segId: seg.id,
              origStart: seg.start, origEnd: seg.end,
              mouseStartX: e.clientX,
            });
          }}
          onContextMenu={(e) => handleSegContextMenu(e, seg.id)}
          onMouseEnter={e => { setHoveredSeg(seg); setTooltipPos({ x: e.clientX, y: e.clientY }); }}
          onMouseMove={e => setTooltipPos({ x: e.clientX, y: e.clientY })}
          onMouseLeave={() => setHoveredSeg(null)}
          className="absolute rounded cursor-grab active:cursor-grabbing transition-shadow"
          style={{
            left: 0, top: 0, right: 0, bottom: 0,
            background: isDragging
              ? `${trackColor}44`
              : isSelected ? `${trackColor}55` : `${trackColor}25`,
            border: isSelected ? `2px solid ${trackColor}` : `1px solid ${trackColor}66`,
            boxShadow: isDragging ? `0 0 12px ${trackColor}44` : 'none',
            overflow: 'hidden',
            display: 'flex', alignItems: 'center', paddingLeft: HANDLE_W + 2, paddingRight: HANDLE_W + 2,
          }}>
          {showText && width > 40 && (
            <span className="text-xs truncate select-none" style={{ color: '#ddd', fontSize: 9 }}>
              {seg.translated_text?.trim()?.substring(0, 30) || seg.original_text?.substring(0, 30) || `#${seg.index + 1}`}
            </span>
          )}
          {!showText && width > 20 && (
            <span className="text-xs select-none" style={{ color: trackColor, fontSize: 9, opacity: 0.7 }}>~</span>
          )}
        </div>

        {/* Left resize handle */}
        <div
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            onSelect?.(seg.id);
            setDrag({ type: 'seg-start', segId: seg.id, origStart: seg.start, origEnd: seg.end });
          }}
          className="absolute opacity-0 group-hover:opacity-100 transition-opacity rounded-l"
          style={{
            left: 0, top: 0, width: HANDLE_W, height: '100%',
            background: trackColor, cursor: 'ew-resize', zIndex: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <div style={{ width: 2, height: 14, background: 'rgba(255,255,255,0.5)', borderRadius: 1 }} />
        </div>

        {/* Right resize handle */}
        <div
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            onSelect?.(seg.id);
            setDrag({ type: 'seg-end', segId: seg.id, origStart: seg.start, origEnd: seg.end });
          }}
          className="absolute opacity-0 group-hover:opacity-100 transition-opacity rounded-r"
          style={{
            right: 0, top: 0, width: HANDLE_W, height: '100%',
            background: trackColor, cursor: 'ew-resize', zIndex: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <div style={{ width: 2, height: 14, background: 'rgba(255,255,255,0.5)', borderRadius: 1 }} />
        </div>

        {/* Duration badge on hover */}
        {isSelected && width > 35 && (
          <div className="absolute text-center select-none pointer-events-none"
            style={{ left: 0, right: 0, bottom: -1, fontSize: 8, color: '#999' }}>
            {(end - start).toFixed(1)}s
          </div>
        )}
      </div>
    );
  };

  // ── Track content renderers ──
  const renderTrackContent = (track) => {
    switch (track.id) {
      case 'video':
        return (
          <>
            <div className="absolute rounded" style={{
              left: 0, top: 4, width: totalWidth,
              height: TRACK_H - 8, background: '#1a2040',
              border: '1px solid #252560', opacity: 0.5,
            }} />
            <div className="absolute rounded" style={{
              left: trimStartX, top: 4, width: trimWidth,
              height: TRACK_H - 8, background: '#1a3060',
              border: '1px solid #3b82f6', opacity: 0.8,
            }} />
            {onTrimChange && (
              <>
                <div
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setDrag({ type: 'trim-start' }); }}
                  className="absolute rounded-l"
                  style={{
                    left: trimStartX - 2, top: 2, width: HANDLE_W + 2, height: TRACK_H - 4,
                    background: drag?.type === 'trim-start' ? '#fbbf24' : '#f59e0b',
                    cursor: 'ew-resize', zIndex: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                  <div style={{ width: 2, height: 14, background: 'rgba(0,0,0,0.3)', borderRadius: 1 }} />
                </div>
                <div
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setDrag({ type: 'trim-end' }); }}
                  className="absolute rounded-r"
                  style={{
                    left: trimEndX - HANDLE_W, top: 2, width: HANDLE_W + 2, height: TRACK_H - 4,
                    background: drag?.type === 'trim-end' ? '#fbbf24' : '#f59e0b',
                    cursor: 'ew-resize', zIndex: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                  <div style={{ width: 2, height: 14, background: 'rgba(0,0,0,0.3)', borderRadius: 1 }} />
                </div>
              </>
            )}
          </>
        );

      case 'audio':
        return (
          <div className="absolute rounded" style={{
            left: 0, top: 4, width: totalWidth, height: TRACK_H - 8,
            background: track.muted ? '#111118' : 'rgba(136,136,136,0.08)',
            border: track.muted ? '1px solid #1e1e2e' : '1px solid rgba(136,136,136,0.2)',
            opacity: track.muted ? 0.5 : 1, overflow: 'hidden',
          }}>{waveformBars('#888', track.muted, 0)}</div>
        );

      case 'vocals':
        return (
          <div className="absolute rounded" style={{
            left: 0, top: 4, width: totalWidth, height: TRACK_H - 8,
            background: track.muted ? '#111118' : 'rgba(245,158,11,0.06)',
            border: track.muted ? '1px solid #1e1e2e' : '1px solid rgba(245,158,11,0.2)',
            opacity: track.muted ? 0.5 : 1, overflow: 'hidden',
          }}>{waveformBars('#f59e0b', track.muted, 0)}</div>
        );

      case 'bgmusic':
        return (
          <div className="absolute rounded" style={{
            left: 0, top: 4, width: totalWidth, height: TRACK_H - 8,
            background: track.muted ? '#111118' : 'rgba(34,197,94,0.06)',
            border: track.muted ? '1px solid #1e1e2e' : '1px solid rgba(34,197,94,0.2)',
            opacity: track.muted ? 0.5 : 1, overflow: 'hidden',
          }}>{waveformBars('#22c55e', track.muted, 50)}</div>
        );

      case 'dubbed':
        return segments.filter(s => s.status === 'done').map(seg =>
          renderEditableSegment(seg, '#7c3aed', false)
        );

      case 'scenes':
        return segments.map(seg =>
          renderEditableSegment(seg, segColor(seg), true)
        );

      default: return null;
    }
  };

  // Find adjacent segments for merge
  const getAdjacentSegId = (segId) => {
    const idx = segments.findIndex(s => s.id === segId);
    if (idx < segments.length - 1) return segments[idx + 1].id;
    return null;
  };

  return (
    <div className="flex flex-col flex-shrink-0" style={{ background: '#0d0d1a', borderTop: '1px solid #1e1e38' }}>
      {/* Controls bar */}
      <div className="flex items-center justify-between px-3 py-1.5"
        style={{ borderBottom: '1px solid #1a1a30' }}>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: '#666' }}>
            Timeline
          </span>
          {onSplitAtPlayhead && (
            <button onClick={onSplitAtPlayhead}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-all hover:brightness-125"
              style={{ background: 'rgba(124,58,237,0.15)', color: 'var(--accent)' }}
              title="Split segment at playhead [K]">
              <Scissors size={10} /> Split
            </button>
          )}
          {/* Segment count */}
          <span className="text-xs px-2 py-0.5 rounded"
            style={{ background: 'rgba(255,255,255,0.03)', color: '#555' }}>
            {segments.length} segments
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Drag info */}
          {dragPreview && (
            <span className="text-xs font-mono px-2 py-0.5 rounded animate-pulse"
              style={{ background: 'rgba(124,58,237,0.15)', color: 'var(--accent)', fontSize: 10 }}>
              {fmtTimePrecise(dragPreview.start)} - {fmtTimePrecise(dragPreview.end)}
              {' '}({(dragPreview.end - dragPreview.start).toFixed(1)}s)
            </span>
          )}
          {(trimStart > 0 || effectiveTrimEnd < duration) && !dragPreview && (
            <span className="text-xs font-mono px-2 py-0.5 rounded"
              style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', fontSize: 10 }}>
              Trim: {fmtTimePrecise(trimStart)} - {fmtTimePrecise(effectiveTrimEnd)}
              {' '}({fmtTimePrecise(effectiveTrimEnd - trimStart)})
            </span>
          )}
          <span className="text-xs font-mono px-2 py-0.5 rounded"
            style={{ background: '#1a1a2e', color: '#aaa' }}>
            {fmtTimePrecise(currentTime)} / {fmtTime(duration)}
          </span>
          <div className="flex items-center gap-1.5">
            <ZoomOut size={11} style={{ color: '#555' }} />
            <input type="range" min={MIN_PX_PER_SEC} max={MAX_PX_PER_SEC} step={1}
              value={pxPerSec} onChange={e => setPxPerSec(Number(e.target.value))}
              className="w-20" style={{ accentColor: 'var(--accent)' }}
              title={`Zoom: ${Math.round(zoomPercent)}%`} />
            <ZoomIn size={11} style={{ color: '#555' }} />
          </div>
          <span className="text-xs" style={{ color: '#444' }}>Ctrl+Scroll</span>
        </div>
      </div>

      {/* Timeline area */}
      <div className="flex" style={{ minHeight: RULER_H + totalTracksH + 8 }}>
        {/* Track labels */}
        <div className="flex-shrink-0 flex flex-col" style={{ width: 76, borderRight: '1px solid #1a1a30' }}>
          <div style={{ height: RULER_H }} />
          {tracks.map((track, i) => (
            <div key={track.id} className="flex items-center gap-1 justify-end pr-2"
              style={{ height: TRACK_H, marginTop: i === 0 ? 0 : TRACK_GAP }}>
              {track.onToggle && (
                <button onClick={track.onToggle}
                  className="p-0.5 rounded transition-all hover:brightness-150"
                  style={{ color: track.muted ? '#ef4444' : track.color, opacity: track.muted ? 0.7 : 0.9 }}
                  title={track.muted ? `Unmute ${track.label}` : `Mute ${track.label}`}>
                  {track.muted ? <VolumeX size={10} /> : <Volume2 size={10} />}
                </button>
              )}
              <span className="text-xs" style={{
                color: track.muted ? '#444' : '#888', fontSize: 11,
                textDecoration: track.muted ? 'line-through' : 'none',
              }}>{track.label}</span>
            </div>
          ))}
        </div>

        {/* Scrollable tracks */}
        <div ref={containerRef} className="flex-1 overflow-x-auto overflow-y-hidden"
          style={{ cursor: drag ? (drag.type === 'seg-move' ? 'grabbing' : 'ew-resize') : 'default' }}>
          <div style={{ width: Math.max(totalWidth, 800), position: 'relative' }}>

            {/* Ruler */}
            <div style={{ height: RULER_H, position: 'relative', cursor: 'pointer' }}
              onClick={handleTimelineClick}>
              {ticks.map(t => (
                <div key={t} style={{
                  position: 'absolute', left: t * pxPerSec, top: 0,
                  height: RULER_H, borderLeft: '1px solid #2a2a45',
                }}>
                  <span className="pl-1 select-none" style={{ color: '#666', fontSize: 10 }}>
                    {fmtTime(t)}
                  </span>
                </div>
              ))}
            </div>

            {/* Trim overlay */}
            {(trimStart > 0 || effectiveTrimEnd < duration) && (
              <>
                {trimStart > 0 && (
                  <div style={{
                    position: 'absolute', left: 0, top: RULER_H,
                    width: trimStartX, height: totalTracksH,
                    background: 'rgba(0,0,0,0.45)', zIndex: 5, pointerEvents: 'none',
                  }} />
                )}
                {effectiveTrimEnd < duration && (
                  <div style={{
                    position: 'absolute', left: trimEndX, top: RULER_H,
                    width: totalWidth - trimEndX, height: totalTracksH,
                    background: 'rgba(0,0,0,0.45)', zIndex: 5, pointerEvents: 'none',
                  }} />
                )}
              </>
            )}

            {/* Tracks */}
            {tracks.map((track, i) => (
              <div key={track.id}
                style={{
                  height: TRACK_H, position: 'relative',
                  marginTop: i === 0 ? 0 : TRACK_GAP,
                  cursor: drag ? undefined : 'pointer',
                  borderBottom: '1px solid #111125',
                }}
                onClick={handleTimelineClick}>
                {renderTrackContent(track)}
              </div>
            ))}

            {/* Snap guide line */}
            {snapLine !== null && drag && (
              <div style={{
                position: 'absolute', left: snapLine * pxPerSec, top: 0,
                width: 1, height: RULER_H + totalTracksH,
                background: '#fbbf24', zIndex: 25, pointerEvents: 'none',
                opacity: 0.7,
              }} />
            )}

            {/* Playhead */}
            <div style={{
              position: 'absolute', left: playheadX, top: 0,
              width: 2, height: RULER_H + totalTracksH,
              background: '#fff', zIndex: 20, pointerEvents: 'none',
            }}>
              <div style={{
                position: 'absolute', top: -1, left: -4, width: 0, height: 0,
                borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
                borderTop: '6px solid #fff',
              }} />
            </div>
          </div>
        </div>
      </div>

      {/* Hover tooltip */}
      {hoveredSeg && !drag && (
        <div className="fixed z-50 px-2.5 py-1.5 rounded shadow-lg pointer-events-none"
          style={{
            left: tooltipPos.x + 12, top: tooltipPos.y - 50,
            background: '#1a1a2e', border: '1px solid #252542', maxWidth: 260,
          }}>
          <p className="text-xs font-mono mb-0.5" style={{ color: 'var(--accent)' }}>
            #{hoveredSeg.index + 1} — {fmtTimePrecise(hoveredSeg.start)} - {fmtTimePrecise(hoveredSeg.end)}
            <span style={{ color: '#666' }}> ({(hoveredSeg.end - hoveredSeg.start).toFixed(1)}s)</span>
          </p>
          <p className="text-xs truncate" style={{ color: '#ccc' }}>
            {hoveredSeg.translated_text?.trim() || hoveredSeg.original_text?.substring(0, 60) || '—'}
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#555' }}>
            Drag to move • Edges to resize • Right-click for more
          </p>
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <div className="fixed z-50 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y, background: '#1a1a2e', border: '1px solid #2a2a4a' }}>
          {onSplitAtPlayhead && (
            <button onClick={() => { setContextMenu(null); onSplitAtPlayhead(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/5 text-left"
              style={{ color: '#ccc' }}>
              <Scissors size={11} /> Split at Playhead
              <span className="ml-auto" style={{ color: '#555' }}>K</span>
            </button>
          )}
          {onDeleteSegment && (
            <button onClick={() => { setContextMenu(null); onDeleteSegment(contextMenu.segId); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/5 text-left"
              style={{ color: '#ef4444' }}>
              <Trash2 size={11} /> Delete Segment
              <span className="ml-auto" style={{ color: '#555' }}>Del</span>
            </button>
          )}
          {onMergeSegments && getAdjacentSegId(contextMenu.segId) && (
            <>
              <div style={{ height: 1, background: '#252542', margin: '2px 0' }} />
              <button onClick={() => {
                const nextId = getAdjacentSegId(contextMenu.segId);
                setContextMenu(null);
                if (nextId) onMergeSegments([contextMenu.segId, nextId]);
              }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/5 text-left"
                style={{ color: '#ccc' }}>
                <GitMerge size={11} /> Merge with Next
              </button>
            </>
          )}
          <div style={{ height: 1, background: '#252542', margin: '2px 0' }} />
          <button onClick={() => {
            setContextMenu(null);
            const seg = segments.find(s => s.id === contextMenu.segId);
            if (seg) onSeek?.(seg.start);
          }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/5 text-left"
            style={{ color: '#ccc' }}>
            <Copy size={11} /> Go to Start
          </button>
        </div>
      )}
    </div>
  );
}
