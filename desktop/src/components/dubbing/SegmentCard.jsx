import { forwardRef, useRef, useEffect, useState } from 'react';
import { Play, Pause, RotateCw, Scissors, Trash2, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

const fmt = (s) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 10);
  return `${m}:${sec.toString().padStart(2, '0')}.${ms}`;
};

const STATUS_COLORS = {
  done: { bg: 'rgba(34,197,94,0.12)', color: '#22c55e', label: 'Done' },
  generating: { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', label: 'Gen...' },
  error: { bg: 'rgba(239,68,68,0.12)', color: '#ef4444', label: 'Error' },
  pending: { bg: 'rgba(255,255,255,0.04)', color: '#555', label: 'Pending' },
};

const SegmentCard = forwardRef(function SegmentCard({
  segment, isActive, isSelected, onSelect,
  onUpdate, onDelete, onSplit, onGenerate,
  audioUrl,
}, ref) {
  const textareaRef = useRef(null);
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [genLoading, setGenLoading] = useState(false);

  const seg = segment;
  const dur = seg.end - seg.start;
  const st = STATUS_COLORS[seg.status] || STATUS_COLORS.pending;

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    }
  }, [seg.translated_text]);

  const toggleAudio = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); } else { a.play(); }
    setPlaying(!playing);
  };

  const handleGenerate = async () => {
    setGenLoading(true);
    try { await onGenerate(); } catch {}
    setGenLoading(false);
  };

  return (
    <div
      ref={ref}
      onClick={onSelect}
      className="rounded-lg cursor-pointer transition-all group"
      style={{
        background: isActive ? 'rgba(124,58,237,0.08)' : isSelected ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
        borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
        border: isSelected && !isActive ? '1px solid var(--accent)' : undefined,
        borderRight: '1px solid transparent',
        borderTop: !isSelected || isActive ? '1px solid #1a1a30' : undefined,
        borderBottom: !isSelected || isActive ? '1px solid #1a1a30' : undefined,
        padding: '10px 12px 10px 10px',
      }}
    >
      {/* Header: index, time, duration, status */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-bold px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(255,255,255,0.06)', color: '#888', fontSize: 10 }}>
          #{seg.index + 1}
        </span>
        <span className="text-xs font-mono" style={{ color: '#666', fontSize: 10 }}>
          {fmt(seg.start)} → {fmt(seg.end)}
        </span>
        <span className="text-xs font-mono" style={{ color: '#444', fontSize: 10 }}>
          ({dur.toFixed(1)}s)
        </span>
        <div className="flex-1" />
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: st.bg, color: st.color, fontSize: 10 }}>
          {st.label}
        </span>
      </div>

      {/* Original text */}
      <p className="text-xs mb-1.5 leading-relaxed" style={{ color: '#777' }}>
        {seg.original_text || '(no text)'}
      </p>

      {/* Translation textarea */}
      <textarea
        ref={textareaRef}
        value={seg.translated_text || ''}
        onChange={(e) => onUpdate({ translated_text: e.target.value })}
        onClick={(e) => e.stopPropagation()}
        placeholder="Enter translation..."
        rows={1}
        className="w-full text-sm p-2 rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-purple-500"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid #1e1e38',
          color: '#ddd',
          minHeight: 32,
        }}
      />

      {/* Action row */}
      <div className="flex items-center gap-1 mt-2 opacity-60 group-hover:opacity-100 transition-opacity"
        style={isActive || isSelected ? { opacity: 1 } : {}}>

        {/* Play audio */}
        {audioUrl && (
          <>
            <audio ref={audioRef} src={audioUrl} onEnded={() => setPlaying(false)} />
            <button onClick={(e) => { e.stopPropagation(); toggleAudio(); }}
              className="p-1.5 rounded-md hover:opacity-80" style={{ color: '#22c55e' }}
              title="Play segment audio">
              {playing ? <Pause size={12} /> : <Play size={12} />}
            </button>
          </>
        )}

        {/* Generate */}
        <button onClick={(e) => { e.stopPropagation(); handleGenerate(); }}
          disabled={genLoading || !seg.translated_text?.trim()}
          className="p-1.5 rounded-md hover:opacity-80 disabled:opacity-30"
          style={{ color: 'var(--accent)' }}
          title="Generate audio">
          {genLoading ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
        </button>

        {/* Split */}
        <button onClick={(e) => {
            e.stopPropagation();
            const mid = seg.start + dur / 2;
            onSplit(mid);
          }}
          className="p-1.5 rounded-md hover:opacity-80" style={{ color: '#888' }}
          title="Split segment">
          <Scissors size={12} />
        </button>

        {/* Delete */}
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1.5 rounded-md hover:opacity-80" style={{ color: '#ef4444' }}
          title="Delete segment">
          <Trash2 size={12} />
        </button>

        <div className="flex-1" />

        {/* Volume compact */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ color: '#555', fontSize: 10 }}>Vol</span>
          <input type="range" min={0} max={2} step={0.05}
            value={seg.volume ?? 1}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onUpdate({ volume: parseFloat(e.target.value) })}
            style={{ width: 50, accentColor: 'var(--accent)' }} />
          <span className="text-xs font-mono" style={{ color: '#666', fontSize: 10, minWidth: 28 }}>
            {Math.round((seg.volume ?? 1) * 100)}%
          </span>
        </div>

        {/* Advanced toggle */}
        <button onClick={(e) => { e.stopPropagation(); setShowAdvanced(!showAdvanced); }}
          className="p-1 rounded hover:opacity-80" style={{ color: '#555' }}>
          {showAdvanced ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      </div>

      {/* Advanced: fade in/out */}
      {showAdvanced && (
        <div className="flex gap-4 mt-2 pt-2" style={{ borderTop: '1px solid #1a1a30' }}
          onClick={(e) => e.stopPropagation()}>
          <div className="flex-1">
            <label className="text-xs block mb-1" style={{ color: '#555', fontSize: 10 }}>Fade In (s)</label>
            <input type="range" min={0} max={2} step={0.1}
              value={seg.fade_in ?? 0}
              onChange={(e) => onUpdate({ fade_in: parseFloat(e.target.value) })}
              className="w-full" style={{ accentColor: 'var(--accent)' }} />
            <span className="text-xs font-mono" style={{ color: '#666', fontSize: 10 }}>{(seg.fade_in ?? 0).toFixed(1)}s</span>
          </div>
          <div className="flex-1">
            <label className="text-xs block mb-1" style={{ color: '#555', fontSize: 10 }}>Fade Out (s)</label>
            <input type="range" min={0} max={2} step={0.1}
              value={seg.fade_out ?? 0}
              onChange={(e) => onUpdate({ fade_out: parseFloat(e.target.value) })}
              className="w-full" style={{ accentColor: 'var(--accent)' }} />
            <span className="text-xs font-mono" style={{ color: '#666', fontSize: 10 }}>{(seg.fade_out ?? 0).toFixed(1)}s</span>
          </div>
        </div>
      )}
    </div>
  );
});

export default SegmentCard;
