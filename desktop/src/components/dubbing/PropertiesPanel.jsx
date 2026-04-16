import { useState } from 'react';
import { Play, Pause, RotateCcw, Scissors, Trash2 } from 'lucide-react';
import SubtitleEditor from './SubtitleEditor';

const labelStyle = { color: 'var(--text-secondary)' };
const inputStyle = { background: '#1a1a2e', border: '1px solid #2a2a40', color: 'var(--text-primary)' };

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, '0')}`;
}

export default function PropertiesPanel({
  segment, onUpdate, onDelete, onGenerate, onSplit, audioUrl,
  showDubbing, showSubtitle, subtitleStyle, onSubtitleStyleChange,
}) {
  const [playing, setPlaying] = useState(false);
  const [audioEl] = useState(() => typeof Audio !== 'undefined' ? new Audio() : null);

  if (!segment) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: '#555' }}>
        <p className="text-sm">Select a segment on the timeline</p>
      </div>
    );
  }

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

  const duration = (segment.end - segment.start).toFixed(1);

  return (
    <div className="h-full flex flex-col overflow-y-auto"
      style={{ background: '#111127', borderLeft: '1px solid #1e1e38' }}>

      {/* Segment header */}
      <div className="flex items-center gap-2 px-4 py-3"
        style={{ borderBottom: '1px solid #1e1e38' }}>
        <span className="text-xs font-mono px-1.5 py-0.5 rounded"
          style={{ background: '#1a1a2e', color: 'var(--accent)' }}>
          #{segment.index + 1}
        </span>
        <span className="text-xs font-mono" style={labelStyle}>
          {fmtTime(segment.start)} — {fmtTime(segment.end)}
        </span>
        <span className="text-xs" style={labelStyle}>{duration}s</span>
        <div className="flex-1" />
        {/* Actions */}
        {showDubbing && segment.status === 'done' && audioUrl && (
          <button onClick={playing ? stop : play}
            className="p-1.5 rounded hover:opacity-80" style={{ color: 'var(--accent)' }}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
        )}
        {showDubbing && onGenerate && (
          <button onClick={onGenerate}
            className="p-1.5 rounded hover:opacity-80" style={labelStyle} title="Generate">
            <RotateCcw size={14} />
          </button>
        )}
        <button onClick={() => onSplit?.((segment.start + segment.end) / 2)}
          className="p-1.5 rounded hover:opacity-80" style={labelStyle} title="Split">
          <Scissors size={14} />
        </button>
        <button onClick={onDelete}
          className="p-1.5 rounded hover:opacity-80" style={{ color: 'var(--danger)' }} title="Delete">
          <Trash2 size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Original text */}
        <div>
          <label className="block text-xs mb-1.5 font-medium" style={labelStyle}>Original</label>
          <p className="text-sm leading-relaxed p-2.5 rounded"
            style={{ background: '#1a1a2e', color: 'var(--text-secondary)' }}>
            {segment.original_text || '—'}
          </p>
        </div>

        {/* Translation */}
        <div>
          <label className="block text-xs mb-1.5 font-medium" style={labelStyle}>Translation</label>
          <textarea
            value={segment.translated_text || ''}
            onChange={e => onUpdate?.({ translated_text: e.target.value })}
            placeholder="Enter translation..."
            rows={3}
            className="w-full p-2.5 rounded text-sm resize-none"
            style={inputStyle}
          />
        </div>

        {/* Dubbing controls */}
        {showDubbing && (
          <div>
            <label className="block text-xs mb-2 font-medium" style={labelStyle}>Audio</label>
            <div className="space-y-3">
              {/* Volume */}
              <div className="flex items-center gap-3">
                <span className="text-xs w-12" style={labelStyle}>Volume</span>
                <input type="range" min="0" max="2" step="0.05" value={segment.volume}
                  onChange={e => onUpdate?.({ volume: parseFloat(e.target.value) })}
                  className="flex-1" />
                <span className="text-xs font-mono w-10 text-right" style={labelStyle}>
                  {Math.round(segment.volume * 100)}%
                </span>
              </div>
              {/* Fade In */}
              <div className="flex items-center gap-3">
                <span className="text-xs w-12" style={labelStyle}>Fade In</span>
                <input type="range" min="0" max="2" step="0.1" value={segment.fade_in}
                  onChange={e => onUpdate?.({ fade_in: parseFloat(e.target.value) || 0 })}
                  className="flex-1" />
                <span className="text-xs font-mono w-10 text-right" style={labelStyle}>
                  {segment.fade_in}s
                </span>
              </div>
              {/* Fade Out */}
              <div className="flex items-center gap-3">
                <span className="text-xs w-12" style={labelStyle}>Fade Out</span>
                <input type="range" min="0" max="2" step="0.1" value={segment.fade_out}
                  onChange={e => onUpdate?.({ fade_out: parseFloat(e.target.value) || 0 })}
                  className="flex-1" />
                <span className="text-xs font-mono w-10 text-right" style={labelStyle}>
                  {segment.fade_out}s
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Subtitle style */}
        {showSubtitle && (
          <SubtitleEditor style={subtitleStyle} onChange={onSubtitleStyleChange} />
        )}
      </div>
    </div>
  );
}
