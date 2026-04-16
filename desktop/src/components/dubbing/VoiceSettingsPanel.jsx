import { useState } from 'react';
import { Play, Pause, RotateCcw, Scissors, Trash2, Settings2, Volume2, Waves } from 'lucide-react';

const labelStyle = { color: '#777' };
const inputStyle = { background: '#1a1a2e', border: '1px solid #252542', color: '#ccc' };

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, '0')}`;
}

function SliderRow({ label, value, min, max, step, onChange, suffix = '', displayValue }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs w-16 flex-shrink-0" style={labelStyle}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="flex-1" style={{ accentColor: 'var(--accent)' }} />
      <span className="text-xs font-mono w-12 text-right flex-shrink-0" style={labelStyle}>
        {displayValue ?? value}{suffix}
      </span>
    </div>
  );
}

export default function VoiceSettingsPanel({
  segment,
  voiceName,
  onUpdate,
  onGenerate,
  onDelete,
  onSplit,
  audioUrl,
  showDubbing,
}) {
  const [playing, setPlaying] = useState(false);
  const [audioEl] = useState(() => typeof Audio !== 'undefined' ? new Audio() : null);

  if (!segment) {
    return (
      <div className="h-full flex flex-col"
        style={{ background: '#0f0f24', borderLeft: '1px solid #1e1e38', width: 280 }}>
        <div className="px-3 py-3" style={{ borderBottom: '1px solid #1e1e38' }}>
          <div className="flex items-center gap-2">
            <Settings2 size={14} style={{ color: 'var(--accent)' }} />
            <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: '#999' }}>
              Voice Settings
            </span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-xs text-center" style={{ color: '#555' }}>
            Select a scene to adjust voice settings
          </p>
        </div>
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
    <div className="h-full flex flex-col"
      style={{ background: '#0f0f24', borderLeft: '1px solid #1e1e38', width: 280 }}>

      {/* Header */}
      <div className="px-3 py-3 flex-shrink-0" style={{ borderBottom: '1px solid #1e1e38' }}>
        <div className="flex items-center gap-2 mb-2">
          <Settings2 size={14} style={{ color: 'var(--accent)' }} />
          <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: '#999' }}>
            Voice Settings
          </span>
        </div>
        {/* Segment info */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono px-1.5 py-0.5 rounded"
            style={{ background: '#1a1a2e', color: 'var(--accent)' }}>
            #{segment.index + 1}
          </span>
          <span className="text-xs font-mono" style={{ color: '#666' }}>
            {fmtTime(segment.start)} — {fmtTime(segment.end)}
          </span>
          <span className="text-xs" style={{ color: '#555' }}>{duration}s</span>
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          {voiceName && (
            <p className="text-xs flex items-center gap-1.5" style={{ color: '#888' }}>
              <Waves size={10} />
              {voiceName}
            </p>
          )}
          {segment.emotion && segment.emotion !== 'neutral' && (
            <span className="text-xs px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', fontSize: 10 }}>
              {segment.emotion}
            </span>
          )}
        </div>
      </div>

      {/* Settings */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-5"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#252542 transparent' }}>

        {/* Audio preview */}
        {showDubbing && segment.status === 'done' && audioUrl && (
          <div className="rounded-lg p-3" style={{ background: '#1a1a2e', border: '1px solid #252542' }}>
            <div className="flex items-center gap-3">
              <button onClick={playing ? stop : play}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:brightness-110"
                style={{ background: 'var(--accent)', color: '#fff' }}>
                {playing ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <div className="flex-1">
                <p className="text-xs font-medium" style={{ color: '#ccc' }}>Generated Audio</p>
                <p className="text-xs" style={{ color: '#555' }}>{duration}s</p>
              </div>
            </div>
          </div>
        )}

        {/* Volume & Fade */}
        {showDubbing && (
          <div>
            <p className="text-xs font-medium mb-3 flex items-center gap-1.5" style={{ color: '#999' }}>
              <Volume2 size={12} />
              Audio Controls
            </p>
            <div className="space-y-3">
              <SliderRow label="Volume" value={segment.volume ?? 1}
                min={0} max={2} step={0.05}
                onChange={v => onUpdate?.({ volume: v })}
                displayValue={Math.round((segment.volume ?? 1) * 100)} suffix="%" />
              <SliderRow label="Fade In" value={segment.fade_in ?? 0}
                min={0} max={2} step={0.1}
                onChange={v => onUpdate?.({ fade_in: v })} suffix="s" />
              <SliderRow label="Fade Out" value={segment.fade_out ?? 0}
                min={0} max={2} step={0.1}
                onChange={v => onUpdate?.({ fade_out: v })} suffix="s" />
            </div>
          </div>
        )}

        {/* Speed (future - placeholder for backend support) */}
        {showDubbing && (
          <div>
            <p className="text-xs font-medium mb-3 flex items-center gap-1.5" style={{ color: '#999' }}>
              <Waves size={12} />
              Voice Tuning
            </p>
            <div className="space-y-3">
              <SliderRow label="Speed" value={segment.speed ?? 1.0}
                min={0.5} max={2.0} step={0.05}
                onChange={v => onUpdate?.({ speed: v })}
                displayValue={(segment.speed ?? 1.0).toFixed(2)} suffix="x" />
            </div>
          </div>
        )}

        {/* Original text preview */}
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: '#999' }}>Original</p>
          <p className="text-xs leading-relaxed p-2.5 rounded"
            style={{ background: '#1a1a2e', color: '#777' }}>
            {segment.original_text || '—'}
          </p>
        </div>

        {/* Translation preview */}
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: '#999' }}>Translation</p>
          <p className="text-xs leading-relaxed p-2.5 rounded"
            style={{ background: '#1a1a2e', color: '#ccc' }}>
            {segment.translated_text || '—'}
          </p>
        </div>

        {/* Speech text (TTS input) */}
        {segment.speech_text && segment.speech_text !== segment.translated_text && (
          <div>
            <p className="text-xs font-medium mb-2 flex items-center gap-1.5" style={{ color: '#999' }}>
              <Volume2 size={10} />
              TTS Script
            </p>
            <p className="text-xs leading-relaxed p-2.5 rounded"
              style={{ background: '#1a1a2e', color: '#8b9dc3' }}>
              {segment.speech_text}
            </p>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="px-3 py-3 flex-shrink-0 space-y-2" style={{ borderTop: '1px solid #1e1e38' }}>
        {showDubbing && onGenerate && (
          <button onClick={onGenerate}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all hover:brightness-110"
            style={{
              background: 'linear-gradient(135deg, var(--accent), #8b5cf6)',
              color: '#fff',
            }}>
            <RotateCcw size={12} />
            {segment.status === 'done' ? 'Regenerate' : 'Generate Audio'}
            <span className="opacity-50 ml-1 font-mono text-xs">[G]</span>
          </button>
        )}
        <div className="flex gap-2">
          <button onClick={() => onSplit?.((segment.start + segment.end) / 2)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs transition-all hover:brightness-110"
            style={{ background: 'rgba(255,255,255,0.05)', color: '#888', border: '1px solid #252542' }}>
            <Scissors size={11} /> Split <span className="opacity-40 ml-0.5 font-mono" style={{ fontSize: 9 }}>K</span>
          </button>
          <button onClick={onDelete}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs transition-all hover:brightness-110"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
            <Trash2 size={11} /> Delete <span className="opacity-40 ml-0.5 font-mono" style={{ fontSize: 9 }}>Del</span>
          </button>
        </div>
      </div>
    </div>
  );
}
