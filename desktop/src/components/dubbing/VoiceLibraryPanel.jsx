import { useState, useEffect } from 'react';
import { Mic, Plus, Search, Star, Volume2, Check, Cloud, Cpu, Globe } from 'lucide-react';
import { listVoices, listEdgeVoices } from '../../services/api';

const ENGINE_CLOUD = 'edge';    // VoxCloud — free, online
const ENGINE_LOCAL = 'omnivoice'; // VoxLocal — local GPU

// Map language name → Edge TTS locale prefix
const LOCALE_MAP = {
  vietnamese: 'vi', english: 'en', chinese: 'zh', japanese: 'ja', korean: 'ko',
  french: 'fr', spanish: 'es', german: 'de', portuguese: 'pt', russian: 'ru',
  thai: 'th', hindi: 'hi',
};

export default function VoiceLibraryPanel({
  selectedVoiceId,
  onSelectVoice,
  projectVoiceId,
  ttsEngine,
  onChangeEngine,
  edgeVoice,
  onChangeEdgeVoice,
  targetLanguage,
}) {
  const [clonedVoices, setClonedVoices] = useState([]);
  const [allEdgeVoices, setAllEdgeVoices] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const engine = ttsEngine || ENGINE_CLOUD;

  useEffect(() => {
    Promise.all([
      listVoices().then(r => setClonedVoices(r.voices || [])).catch(() => {}),
      listEdgeVoices().then(r => setAllEdgeVoices(r.voices || [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  // Filter Edge voices by target language + search
  const langPrefix = LOCALE_MAP[targetLanguage] || 'en';
  const edgeFiltered = allEdgeVoices
    .filter(v => v.locale.startsWith(langPrefix))
    .filter(v => v.name.toLowerCase().includes(search.toLowerCase()));

  const clonedFiltered = clonedVoices.filter(v =>
    v.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full"
      style={{ background: '#0f0f24', borderRight: '1px solid #1e1e38', width: 240 }}>

      {/* Header */}
      <div className="px-3 py-3 flex-shrink-0" style={{ borderBottom: '1px solid #1e1e38' }}>
        <div className="flex items-center gap-2 mb-2.5">
          <Mic size={14} style={{ color: 'var(--accent)' }} />
          <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: '#999' }}>
            Voice Library
          </span>
        </div>

        {/* Engine Toggle: VoxCloud / VoxLocal */}
        <div className="flex rounded-lg overflow-hidden mb-2.5"
          style={{ border: '1px solid #252542' }}>
          <button
            onClick={() => onChangeEngine?.(ENGINE_CLOUD)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium transition-all"
            style={{
              background: engine === ENGINE_CLOUD ? 'var(--accent)' : '#1a1a2e',
              color: engine === ENGINE_CLOUD ? '#fff' : '#666',
            }}>
            <Cloud size={11} />
            VoxCloud
          </button>
          <button
            onClick={() => onChangeEngine?.(ENGINE_LOCAL)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium transition-all"
            style={{
              background: engine === ENGINE_LOCAL ? 'var(--accent)' : '#1a1a2e',
              color: engine === ENGINE_LOCAL ? '#fff' : '#666',
            }}>
            <Cpu size={11} />
            VoxLocal
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#555' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search voices..."
            className="w-full pl-7 pr-3 py-1.5 rounded-md text-xs"
            style={{ background: '#1a1a2e', border: '1px solid #252542', color: '#ccc' }}
          />
        </div>
      </div>

      {/* Voice list */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#252542 transparent' }}>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs" style={{ color: '#555' }}>Loading...</span>
          </div>
        ) : engine === ENGINE_CLOUD ? (
          /* ── VoxCloud voices (Edge TTS) ── */
          <>
            {/* Auto voice option */}
            <VoiceRow
              label="Auto Voice"
              sub={`Best for ${targetLanguage || 'english'}`}
              icon={<Globe size={12} style={{ color: '#888' }} />}
              selected={!edgeVoice}
              onClick={() => onChangeEdgeVoice?.('')}
            />

            {edgeFiltered.length === 0 ? (
              <div className="flex items-center justify-center py-6">
                <span className="text-xs" style={{ color: '#555' }}>
                  {search ? 'No matches' : 'No voices for this language'}
                </span>
              </div>
            ) : (
              edgeFiltered.map(v => (
                <VoiceRow
                  key={v.name}
                  label={v.name.replace('Neural', '').replace(/-/g, ' ')}
                  sub={`${v.gender} · ${v.locale}`}
                  initial={v.gender === 'Female' ? 'F' : 'M'}
                  selected={edgeVoice === v.name}
                  onClick={() => onChangeEdgeVoice?.(v.name)}
                  gender={v.gender}
                />
              ))
            )}
          </>
        ) : (
          /* ── VoxLocal voices (cloned) ── */
          <>
            {/* Default voice */}
            <VoiceRow
              label="Default Voice"
              sub="System default"
              icon={<Volume2 size={12} style={{ color: '#888' }} />}
              selected={!selectedVoiceId}
              onClick={() => onSelectVoice?.('')}
            />

            {clonedFiltered.length === 0 ? (
              <div className="flex items-center justify-center py-6">
                <span className="text-xs" style={{ color: '#555' }}>
                  {search ? 'No matches' : 'No cloned voices yet'}
                </span>
              </div>
            ) : (
              clonedFiltered.map(voice => (
                <VoiceRow
                  key={voice.id}
                  label={voice.name}
                  sub={voice.tags || ''}
                  initial={voice.name.charAt(0).toUpperCase()}
                  selected={selectedVoiceId === voice.id}
                  isProject={projectVoiceId === voice.id}
                  onClick={() => onSelectVoice?.(voice.id)}
                />
              ))
            )}
          </>
        )}
      </div>

      {/* Bottom info / Clone button */}
      <div className="px-3 py-3 flex-shrink-0" style={{ borderTop: '1px solid #1e1e38' }}>
        {engine === ENGINE_CLOUD ? (
          <div className="text-center">
            <p className="text-xs" style={{ color: '#555' }}>
              {edgeFiltered.length} voices · Free · No GPU
            </p>
          </div>
        ) : (
          <a href="#voice-clone"
            onClick={e => { e.preventDefault(); window.dispatchEvent(new CustomEvent('navigate', { detail: 'voice-clone' })); }}
            className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-xs font-medium transition-all hover:brightness-110"
            style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', color: 'var(--accent)' }}>
            <Plus size={12} />
            Clone Voice
          </a>
        )}
      </div>
    </div>
  );
}


/* ── Reusable voice row ── */
function VoiceRow({ label, sub, icon, initial, selected, isProject, onClick, gender }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all group"
      style={{
        background: selected ? 'rgba(124,58,237,0.15)' : 'transparent',
        border: selected ? '1px solid rgba(124,58,237,0.3)' : '1px solid transparent',
      }}>
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
        style={{
          background: selected
            ? 'linear-gradient(135deg, var(--accent), #8b5cf6)'
            : gender === 'Female' ? '#2d1b4e' : '#1a1a2e',
        }}>
        {icon || (
          <span className="text-xs font-bold" style={{ color: selected ? '#fff' : gender === 'Female' ? '#c084fc' : '#666' }}>
            {initial || '?'}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate"
          style={{ color: selected ? '#e0e0e0' : '#999' }}>
          {label}
        </p>
        {sub && (
          <p className="text-xs truncate" style={{ color: '#555' }}>{sub}</p>
        )}
      </div>
      {selected && <Check size={12} style={{ color: 'var(--accent)' }} />}
      {isProject && !selected && <Star size={10} style={{ color: '#f59e0b' }} />}
    </button>
  );
}
