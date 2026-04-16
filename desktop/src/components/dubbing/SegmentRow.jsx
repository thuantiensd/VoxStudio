import { useState } from 'react';
import { Play, Pause, Loader2, Check, X, Scissors, Trash2, RotateCcw } from 'lucide-react';

const labelStyle = { color: 'var(--text-secondary)' };

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, '0')}`;
}

export default function SegmentRow({
  segment, onUpdate, onDelete, onGenerate, onSplit, audioUrl, onSeekVideo,
  showDubbingControls = true,
}) {
  const [playing, setPlaying] = useState(false);
  const [audioEl] = useState(() => typeof Audio !== 'undefined' ? new Audio() : null);
  const duration = (segment.end - segment.start).toFixed(1);

  const play = () => {
    if (!audioUrl) return;
    audioEl.src = audioUrl;
    audioEl.play();
    setPlaying(true);
    audioEl.onended = () => setPlaying(false);
  };

  const stop = () => {
    audioEl.pause();
    audioEl.currentTime = 0;
    setPlaying(false);
  };

  const statusIcon = {
    pending: null,
    generating: <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent)' }} />,
    done: <Check size={14} style={{ color: 'var(--success)' }} />,
    error: <X size={14} style={{ color: 'var(--danger)' }} />,
  }[segment.status];

  return (
    <div className="p-3 rounded-lg mb-2" style={{ background: 'var(--bg-card)', border: '1px solid #2a2a40' }}>
      {/* Header row */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs font-mono px-1.5 py-0.5 rounded"
          style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
          #{segment.index + 1}
        </span>

        <button onClick={() => onSeekVideo?.(segment.start)}
          className="text-xs font-mono hover:opacity-80"
          style={{ color: 'var(--accent)' }}
          title="Seek video to this segment">
          {fmtTime(segment.start)} — {fmtTime(segment.end)}
        </button>

        <span className="text-xs px-1.5 py-0.5 rounded"
          style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
          {duration}s
        </span>

        {statusIcon}

        <div className="flex-1" />

        {/* Actions */}
        {showDubbingControls && segment.status === 'done' && audioUrl && (
          <button onClick={playing ? stop : play}
            className="p-1 rounded" style={{ color: 'var(--accent)' }} title="Preview audio">
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
        )}

        {showDubbingControls && onGenerate && (
          <button onClick={() => onGenerate?.()} title="Generate / Regenerate"
            className="p-1 rounded" style={{ color: 'var(--text-secondary)' }}>
            <RotateCcw size={14} />
          </button>
        )}

        <button onClick={() => {
            const mid = (segment.start + segment.end) / 2;
            onSplit?.(mid);
          }}
          className="p-1 rounded" style={{ color: 'var(--text-secondary)' }} title="Split">
          <Scissors size={14} />
        </button>

        <button onClick={() => onDelete?.()} className="p-1 rounded"
          style={{ color: 'var(--danger)' }} title="Delete segment">
          <Trash2 size={14} />
        </button>
      </div>

      {/* Original text */}
      <p className="text-xs mb-1.5 leading-relaxed" style={labelStyle}>
        {segment.original_text}
      </p>

      {/* Translated text input */}
      <textarea
        value={segment.translated_text}
        onChange={e => onUpdate?.({ translated_text: e.target.value })}
        placeholder="Enter translation..."
        rows={2}
        className="w-full p-2 rounded text-sm resize-none mb-2"
        style={{ background: 'var(--bg-surface)', border: '1px solid #2a2a40', color: 'var(--text-primary)' }}
      />

      {/* Controls row (only for dubbing) */}
      {showDubbingControls && (
        <div className="flex items-center gap-4 text-xs">
          <label className="flex items-center gap-1.5" style={labelStyle}>
            Vol
            <input type="range" min="0" max="2" step="0.05" value={segment.volume}
              onChange={e => onUpdate?.({ volume: parseFloat(e.target.value) })}
              className="w-20" />
            <span className="font-mono w-8">{Math.round(segment.volume * 100)}%</span>
          </label>

          <label className="flex items-center gap-1" style={labelStyle}>
            Fade In
            <input type="number" min="0" max="2" step="0.1" value={segment.fade_in}
              onChange={e => onUpdate?.({ fade_in: parseFloat(e.target.value) || 0 })}
              className="w-12 p-1 rounded text-center text-xs"
              style={{ background: 'var(--bg-surface)', border: '1px solid #2a2a40', color: 'var(--text-primary)' }} />
            <span>s</span>
          </label>

          <label className="flex items-center gap-1" style={labelStyle}>
            Fade Out
            <input type="number" min="0" max="2" step="0.1" value={segment.fade_out}
              onChange={e => onUpdate?.({ fade_out: parseFloat(e.target.value) || 0 })}
              className="w-12 p-1 rounded text-center text-xs"
              style={{ background: 'var(--bg-surface)', border: '1px solid #2a2a40', color: 'var(--text-primary)' }} />
            <span>s</span>
          </label>
        </div>
      )}
    </div>
  );
}
