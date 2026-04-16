import { Loader2, Play, Pause, Mic, Languages, Zap, Film, Download } from 'lucide-react';

function fmt(s) {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function BottomActionBar({
  isPlaying, onTogglePlay, currentTime, duration,
  hasSegments, hasTranslations, doneCount, totalGenerable,
  transcribing, translating, generating, exporting,
  onTranscribe, onTranslate, onGenerateAll, onExport,
  exportReady, exportDownloadUrl,
}) {
  return (
    <div className="flex items-center gap-2 px-4 h-11 flex-shrink-0"
      style={{ background: '#111128', borderTop: '1px solid #1e1e38' }}>

      {/* Play / Pause */}
      <button onClick={onTogglePlay}
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
        style={{ background: 'var(--accent)' }}>
        {isPlaying
          ? <Pause size={13} fill="#fff" color="#fff" />
          : <Play size={13} fill="#fff" color="#fff" className="ml-0.5" />
        }
      </button>

      {/* Time */}
      <span className="text-xs font-mono flex-shrink-0" style={{ color: '#888', minWidth: 80 }}>
        {fmt(currentTime)} / {fmt(duration)}
      </span>

      <div className="flex-1" />

      {/* Actions */}
      <ActionBtn onClick={onTranscribe} loading={transcribing}
        icon={<Mic size={12} />} label={hasSegments ? 'Re-transcribe' : 'Transcribe'} />

      {hasSegments && (
        <ActionBtn onClick={onTranslate} loading={translating}
          icon={<Languages size={12} />} label="Translate" />
      )}

      {hasSegments && hasTranslations && (
        <ActionBtn onClick={onGenerateAll} loading={generating}
          icon={<Zap size={12} />}
          label={generating ? `Generating...` : `Generate (${doneCount}/${totalGenerable})`}
          accent />
      )}

      {hasSegments && doneCount > 0 && (
        <ActionBtn onClick={onExport} loading={exporting}
          icon={<Film size={12} />} label="Export" />
      )}

      {exportReady && (
        <a href={exportDownloadUrl} download
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all hover:brightness-110"
          style={{ background: '#22c55e', color: '#fff' }}>
          <Download size={12} /> Download
        </a>
      )}
    </div>
  );
}

function ActionBtn({ onClick, loading, icon, label, accent }) {
  return (
    <button onClick={onClick} disabled={loading}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-40 transition-all hover:brightness-110"
      style={{
        background: accent ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
        color: accent ? '#fff' : '#999',
        border: accent ? 'none' : '1px solid #252542',
      }}>
      {loading ? <Loader2 size={12} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}
