import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { ChevronRight, Check, Clock, AlertCircle, Loader2 } from 'lucide-react';

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const EMOTION_COLORS = {
  happy: { color: '#facc15', bg: 'rgba(250,204,21,0.12)' },
  sad: { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  angry: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  fearful: { color: '#c084fc', bg: 'rgba(192,132,252,0.12)' },
  surprised: { color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  disgusted: { color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  whisper: { color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
};

const STATUS_CONFIG = {
  done: { label: 'Done', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: Check },
  generating: { label: 'Gen...', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: Loader2 },
  error: { label: 'Error', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: AlertCircle },
  pending: { label: 'Pending', color: '#666', bg: 'rgba(255,255,255,0.04)', icon: Clock },
};

export default function ScriptEditor({
  segments,
  voices,
  selectedSegId,
  selectedSegIds,       // multi-select set
  onSelectSegment,
  onMultiSelect,        // (id, shiftKey) => void
  onUpdateSegment,
  onSeekVideo,
  currentTime,
  onNavigateSegment,    // (direction: 1|-1) => void
}) {
  const listRef = useRef(null);
  const userScrolled = useRef(false);
  const scrollTimer = useRef(null);

  // Detect user manual scroll → pause auto-scroll for 3s
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      userScrolled.current = true;
      clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(() => { userScrolled.current = false; }, 3000);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-scroll to active segment (paused during user scroll)
  useEffect(() => {
    if (!listRef.current || !segments.length || userScrolled.current) return;
    const active = segments.find(s => currentTime >= s.start && currentTime < s.end);
    if (active) {
      const el = listRef.current.querySelector(`[data-seg-id="${active.id}"]`);
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentTime, segments]);

  if (!segments.length) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: '#555' }}>
        <div className="text-center">
          <p className="text-sm mb-1">No script yet</p>
          <p className="text-xs" style={{ color: '#444' }}>Click "Auto Script" to transcribe & translate</p>
        </div>
      </div>
    );
  }

  const doneCount = segments.filter(s => s.status === 'done').length;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 flex-shrink-0"
        style={{ borderTop: '1px solid #1e1e38', borderBottom: '1px solid #1e1e38', background: '#0e0e22' }}>
        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: '#666' }}>
          Script — {segments.length} scenes
        </span>
        <div className="flex items-center gap-2">
          {/* Progress bar mini */}
          <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: '#1a1a2e' }}>
            <div className="h-full rounded-full transition-all" style={{
              width: `${(doneCount / segments.length) * 100}%`,
              background: doneCount === segments.length ? '#22c55e' : 'var(--accent)',
            }} />
          </div>
          <span className="text-xs font-mono" style={{ color: '#555' }}>
            {doneCount}/{segments.length}
          </span>
        </div>
      </div>

      {/* Scene list */}
      <div ref={listRef} className="flex-1 overflow-y-auto"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#252542 transparent' }}>
        {segments.map((seg, i) => {
          const isActive = currentTime >= seg.start && currentTime < seg.end;
          const isSelected = seg.id === selectedSegId;
          const isMultiSelected = selectedSegIds?.has(seg.id);

          return (
            <SceneRow
              key={seg.id}
              seg={seg}
              index={i}
              voices={voices}
              isActive={isActive}
              isSelected={isSelected}
              isMultiSelected={isMultiSelected}
              onSelect={(e) => {
                if (e?.shiftKey && onMultiSelect) {
                  onMultiSelect(seg.id, true);
                } else {
                  onSelectSegment?.(seg.id);
                }
              }}
              onUpdate={(data) => onUpdateSegment?.(seg.id, data)}
              onSeek={() => onSeekVideo?.(seg.start)}
              onNavigate={onNavigateSegment}
              totalSegments={segments.length}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── SceneRow — memoized, compact/expand ──
const SceneRow = memo(function SceneRow({
  seg, index, voices, isActive, isSelected, isMultiSelected,
  onSelect, onUpdate, onSeek, onNavigate, totalSegments,
}) {
  const textareaRef = useRef(null);
  const [localText, setLocalText] = useState(seg.translated_text || '');
  const debounceRef = useRef(null);

  // Sync local text when segment changes externally
  useEffect(() => {
    setLocalText(seg.translated_text || '');
  }, [seg.translated_text]);

  // Debounced update — 500ms after user stops typing
  const handleTextChange = useCallback((e) => {
    const val = e.target.value;
    setLocalText(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onUpdate({ translated_text: val });
    }, 500);
  }, [onUpdate]);

  // Cleanup debounce on unmount
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  // Auto-resize textarea when expanded
  useEffect(() => {
    if (!isSelected || !textareaRef.current) return;
    const ta = textareaRef.current;
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight, 36) + 'px';
  }, [isSelected, localText]);

  // Tab navigation between segments
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      onNavigate?.(e.shiftKey ? -1 : 1);
    }
  }, [onNavigate]);

  const duration = (seg.end - seg.start).toFixed(1);
  const status = STATUS_CONFIG[seg.status] || STATUS_CONFIG.pending;
  const StatusIcon = status.icon;
  const expanded = isSelected;

  return (
    <div
      data-seg-id={seg.id}
      onClick={onSelect}
      className="transition-all cursor-pointer"
      style={{
        background: isMultiSelected ? 'rgba(124,58,237,0.12)'
          : isSelected ? 'rgba(124,58,237,0.08)'
          : isActive ? 'rgba(255,255,255,0.025)'
          : 'transparent',
        borderLeft: `3px solid ${
          isMultiSelected ? '#8b5cf6'
          : isSelected ? 'var(--accent)'
          : isActive ? '#4a4a6a'
          : 'transparent'
        }`,
        borderBottom: '1px solid #1a1a30',
      }}>

      {/* ── Compact header (always visible) ── */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Expand chevron */}
        <ChevronRight size={12} className="flex-shrink-0 transition-transform"
          style={{
            color: '#555',
            transform: expanded ? 'rotate(90deg)' : 'none',
          }} />

        {/* Index */}
        <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ background: '#1a1a2e', color: 'var(--accent)', minWidth: 24, textAlign: 'center' }}>
          {index + 1}
        </span>

        {/* Timestamp */}
        <button onClick={e => { e.stopPropagation(); onSeek(); }}
          className="text-xs font-mono hover:opacity-80 transition-opacity flex-shrink-0"
          style={{ color: '#666' }}>
          {fmtTime(seg.start)}
        </button>

        {/* Duration badge */}
        <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ background: '#1a1a2e', color: '#888', fontSize: 10 }}>
          {duration}s
        </span>

        {/* Emotion tag */}
        {seg.emotion && seg.emotion !== 'neutral' && (
          <span className="text-xs px-1 py-0.5 rounded flex-shrink-0"
            style={{ background: EMOTION_COLORS[seg.emotion]?.bg || '#1a1a2e',
                     color: EMOTION_COLORS[seg.emotion]?.color || '#888', fontSize: 9 }}>
            {seg.emotion}
          </span>
        )}

        {/* Translation preview (compact) */}
        {!expanded && (
          <span className="text-xs truncate flex-1 min-w-0" style={{ color: '#aaa' }}>
            {localText || <span style={{ color: '#444', fontStyle: 'italic' }}>No translation</span>}
          </span>
        )}

        {expanded && <div className="flex-1" />}

        {/* Status badge */}
        <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ background: status.bg, color: status.color, fontSize: 10 }}>
          <StatusIcon size={10} className={seg.status === 'generating' ? 'animate-spin' : ''} />
          {status.label}
        </span>
      </div>

      {/* ── Expanded content ── */}
      {expanded && (
        <div className="px-3 pb-3 pt-0 space-y-2" style={{ paddingLeft: 42 }}>
          {/* Original text */}
          {seg.original_text && (
            <p className="text-xs leading-relaxed px-2 py-1.5 rounded"
              style={{ background: '#0d0d1e', color: '#666', fontStyle: 'italic' }}>
              {seg.original_text}
            </p>
          )}

          {/* Voice selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs flex-shrink-0" style={{ color: '#555' }}>Voice:</span>
            <select
              value={seg.voice_id || ''}
              onChange={e => { e.stopPropagation(); onUpdate({ voice_id: e.target.value || null }); }}
              onClick={e => e.stopPropagation()}
              className="text-xs px-2 py-1 rounded flex-1"
              style={{ background: '#1a1a2e', border: '1px solid #252542', color: '#999', maxWidth: 160 }}>
              <option value="">Default</option>
              {voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>

          {/* Speech text (TTS-ready, with pauses) */}
          {seg.speech_text && seg.speech_text !== localText && (
            <div className="px-2 py-1.5 rounded" style={{ background: '#0d0d1e' }}>
              <span className="text-xs" style={{ color: '#555' }}>TTS: </span>
              <span className="text-xs" style={{ color: '#8b9dc3' }}>{seg.speech_text}</span>
            </div>
          )}

          {/* Translation textarea */}
          <textarea
            ref={textareaRef}
            value={localText}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onClick={e => e.stopPropagation()}
            placeholder="Enter translation..."
            rows={1}
            className="w-full px-2.5 py-2 rounded text-sm resize-none"
            style={{
              background: '#1a1a2e',
              border: '1px solid #252542',
              color: '#ddd',
              lineHeight: 1.5,
            }}
          />
        </div>
      )}
    </div>
  );
});
