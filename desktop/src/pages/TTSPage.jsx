import { useState, useEffect, useRef } from 'react';
import { Loader2, User, ChevronDown, ChevronUp, FolderUp, X, Check, Download, FileText, Cloud, Cpu } from 'lucide-react';
import { generateTTS, generateEdgeTTS, listVoices, listEdgeVoices, audioURL } from '../services/api';
import AudioPlayer from '../components/AudioPlayer';
import SpeedKnob from '../components/SpeedKnob';
import PageHeader, { Page, PageContent } from '../components/ui/PageHeader';
import Segmented from '../components/ui/Segmented';

const LANGUAGES = [
  { value: '', label: 'Auto Detect' },
  { value: 'vietnamese', label: 'Vietnamese' },
  { value: 'english', label: 'English' },
  { value: 'chinese', label: 'Chinese' },
  { value: 'japanese', label: 'Japanese' },
  { value: 'korean', label: 'Korean' },
  { value: 'french', label: 'French' },
  { value: 'spanish', label: 'Spanish' },
  { value: 'german', label: 'German' },
  { value: 'portuguese', label: 'Portuguese' },
  { value: 'russian', label: 'Russian' },
  { value: 'thai', label: 'Thai' },
  { value: 'arabic', label: 'Arabic' },
  { value: 'hindi', label: 'Hindi' },
  { value: 'italian', label: 'Italian' },
  { value: 'dutch', label: 'Dutch' },
  { value: 'turkish', label: 'Turkish' },
  { value: 'polish', label: 'Polish' },
  { value: 'indonesian', label: 'Indonesian' },
  { value: 'malay', label: 'Malay' },
];

const CHAR_LIMIT = 1000;
const CHAR_WARN = 500;
const SPEED_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5];
const TEXT_EXTS = ['.txt', '.srt', '.vtt', '.md', '.csv', '.tsv', '.json'];

const selectStyle = { background: 'var(--bg-card)', border: '1px solid #2a2a40', color: 'var(--text-primary)' };
const labelClass = "block text-sm mb-1.5";
const labelStyle = { color: 'var(--text-secondary)' };

function SliderControl({ label, value, onChange, min, max, step, description }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs" style={labelStyle}>{label}</span>
        <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full" />
      {description && (
        <p className="text-xs mt-0.5" style={{ color: '#555' }}>{description}</p>
      )}
    </div>
  );
}

// Map language value → Edge TTS locale prefix
const LOCALE_MAP = {
  vietnamese: 'vi', english: 'en', chinese: 'zh', japanese: 'ja', korean: 'ko',
  french: 'fr', spanish: 'es', german: 'de', portuguese: 'pt', russian: 'ru',
  thai: 'th', hindi: 'hi', arabic: 'ar', italian: 'it', dutch: 'nl',
  turkish: 'tr', polish: 'pl', indonesian: 'id', malay: 'ms',
};

// ── Shared settings hook ──
function useSharedSettings() {
  const [engine, setEngine] = useState('edge'); // 'edge' (VoxCloud) | 'omnivoice' (VoxLocal)
  const [voices, setVoices] = useState([]);
  const [edgeVoices, setEdgeVoices] = useState([]);
  const [voiceId, setVoiceId] = useState('');
  const [edgeVoice, setEdgeVoice] = useState('');
  const [language, setLanguage] = useState('');
  const [speed, setSpeed] = useState(1.0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [numStep, setNumStep] = useState(32);
  const [guidanceScale, setGuidanceScale] = useState(2.0);
  const [tShift, setTShift] = useState(0.1);
  const [layerPenaltyFactor, setLayerPenaltyFactor] = useState(5.0);
  const [positionTemperature, setPositionTemperature] = useState(5.0);
  const [classTemperature, setClassTemperature] = useState(0.0);
  const [denoise, setDenoise] = useState(true);
  const [preprocessPrompt, setPreprocessPrompt] = useState(true);
  const [postprocessOutput, setPostprocessOutput] = useState(true);
  const [audioChunkDuration, setAudioChunkDuration] = useState(15.0);

  useEffect(() => {
    listVoices().then(r => setVoices(r.voices || [])).catch(() => {});
    listEdgeVoices().then(r => setEdgeVoices(r.voices || [])).catch(() => {});
  }, []);

  const selectedVoice = voices.find(v => v.id === voiceId);

  // Filter edge voices by selected language
  const langPrefix = LOCALE_MAP[language] || '';
  const filteredEdgeVoices = langPrefix
    ? edgeVoices.filter(v => v.locale.startsWith(langPrefix))
    : edgeVoices;

  const ttsParams = () => ({
    voiceId, language: language || undefined, speed, numStep,
    guidanceScale, tShift, layerPenaltyFactor,
    positionTemperature, classTemperature,
    denoise, preprocessPrompt, postprocessOutput, audioChunkDuration,
  });

  return {
    engine, setEngine,
    voices, voiceId, setVoiceId,
    edgeVoices: filteredEdgeVoices, edgeVoice, setEdgeVoice,
    language, setLanguage,
    speed, setSpeed, selectedVoice, ttsParams,
    showAdvanced, setShowAdvanced,
    numStep, setNumStep, guidanceScale, setGuidanceScale,
    tShift, setTShift, layerPenaltyFactor, setLayerPenaltyFactor,
    positionTemperature, setPositionTemperature,
    classTemperature, setClassTemperature,
    denoise, setDenoise, preprocessPrompt, setPreprocessPrompt,
    postprocessOutput, setPostprocessOutput,
    audioChunkDuration, setAudioChunkDuration,
  };
}

// ── Shared settings UI ──
function SettingsPanel({ s }) {
  const isCloud = s.engine === 'edge';

  return (
    <>
      {/* Engine toggle: VoxCloud / VoxLocal */}
      <div className="flex gap-1 mb-4 p-1 rounded-lg" style={{ background: 'var(--bg-card)' }}>
        <button onClick={() => s.setEngine('edge')}
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors"
          style={{
            background: isCloud ? 'var(--accent)' : 'transparent',
            color: isCloud ? '#fff' : 'var(--text-secondary)',
          }}>
          <Cloud size={14} /> VoxCloud
        </button>
        <button onClick={() => s.setEngine('omnivoice')}
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors"
          style={{
            background: !isCloud ? 'var(--accent)' : 'transparent',
            color: !isCloud ? '#fff' : 'var(--text-secondary)',
          }}>
          <Cpu size={14} /> VoxLocal
        </button>
      </div>

      {/* Engine description */}
      <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
        {isCloud ? 'Free cloud TTS — no GPU needed, fast' : 'Local GPU TTS — high quality, requires GPU'}
      </p>

      {/* Voice + Language */}
      <div className="flex gap-4 mb-4">
        <div className="flex-1">
          <label className={labelClass} style={labelStyle}>Voice</label>
          {isCloud ? (
            <select value={s.edgeVoice} onChange={e => s.setEdgeVoice(e.target.value)}
              className="w-full p-2.5 rounded-lg text-sm" style={selectStyle}>
              <option value="">Auto Voice</option>
              {s.edgeVoices.map(v => (
                <option key={v.name} value={v.name}>
                  {v.name.replace('Neural', '')} ({v.gender})
                </option>
              ))}
            </select>
          ) : (
            <select value={s.voiceId} onChange={e => s.setVoiceId(e.target.value)}
              className="w-full p-2.5 rounded-lg text-sm" style={selectStyle}>
              <option value="">Default (no voice clone)</option>
              {s.voices.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex-1">
          <label className={labelClass} style={labelStyle}>Language</label>
          <select value={s.language} onChange={e => s.setLanguage(e.target.value)}
            className="w-full p-2.5 rounded-lg text-sm" style={selectStyle}>
            {LANGUAGES.map(l => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Voice preview (VoxLocal only) */}
      {!isCloud && s.voiceId && s.selectedVoice && (
        <div className="mb-4 p-3 rounded-lg flex items-start gap-3"
          style={{ background: 'var(--bg-surface)', border: '1px solid #2a2a40' }}>
          <User size={16} style={{ color: 'var(--accent)', marginTop: 2 }} />
          <div className="text-sm">
            <p className="font-medium">{s.selectedVoice.name}</p>
            {s.selectedVoice.ref_text && (
              <p className="mt-1 text-xs" style={labelStyle}>
                Ref: &ldquo;{s.selectedVoice.ref_text.length > 80 ? s.selectedVoice.ref_text.slice(0, 80) + '...' : s.selectedVoice.ref_text}&rdquo;
              </p>
            )}
          </div>
        </div>
      )}

      {/* Speed knob */}
      <div className="flex flex-col items-center gap-3 mb-5 p-4 rounded-lg"
        style={{ background: 'var(--bg-card)', border: '1px solid #2a2a40' }}>
        <SpeedKnob value={s.speed} onChange={s.setSpeed} min={0.5} max={1.5} step={0.05} />
        <div className="flex gap-2 flex-wrap justify-center">
          {SPEED_PRESETS.map(sp => (
            <button key={sp} onClick={() => s.setSpeed(sp)}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={{
                background: s.speed === sp ? 'var(--accent)' : 'var(--bg-surface)',
                color: s.speed === sp ? '#fff' : 'var(--text-secondary)',
                border: `1px solid ${s.speed === sp ? 'var(--accent)' : '#2a2a40'}`,
              }}>
              {sp}x
            </button>
          ))}
        </div>
      </div>

      {/* Advanced toggle (VoxLocal only) */}
      {!isCloud && (
        <>
          <button onClick={() => s.setShowAdvanced(!s.showAdvanced)}
            className="flex items-center gap-2 mb-4 text-sm transition-colors"
            style={{ color: 'var(--text-secondary)' }}>
            {s.showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            Advanced Settings
          </button>

          {s.showAdvanced && (
            <div className="mb-5 p-4 rounded-lg space-y-4"
              style={{ background: 'var(--bg-card)', border: '1px solid #2a2a40' }}>
              <div className="grid grid-cols-2 gap-4">
                <SliderControl label="Inference Steps" value={s.numStep}
                  onChange={v => s.setNumStep(Math.round(v))} min={4} max={64} step={1}
                  description="Higher = better quality, slower" />
                <SliderControl label="Guidance Scale (CFG)" value={s.guidanceScale.toFixed(1)}
                  onChange={s.setGuidanceScale} min={0} max={4} step={0.1}
                  description="How strongly to follow conditioning" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <SliderControl label="Time Shift (t_shift)" value={s.tShift.toFixed(2)}
                  onChange={s.setTShift} min={0} max={1} step={0.01}
                  description="Smaller = emphasize low-SNR regions" />
                <SliderControl label="Layer Penalty Factor" value={s.layerPenaltyFactor.toFixed(1)}
                  onChange={s.setLayerPenaltyFactor} min={0} max={20} step={0.5}
                  description="Penalty for layer-wise sampling order" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <SliderControl label="Position Temperature" value={s.positionTemperature.toFixed(1)}
                  onChange={s.setPositionTemperature} min={0} max={20} step={0.5}
                  description="Temperature for position selection" />
                <SliderControl label="Class Temperature" value={s.classTemperature.toFixed(2)}
                  onChange={s.setClassTemperature} min={0} max={2} step={0.05}
                  description="0 = greedy, >0 = stochastic sampling" />
              </div>
              <SliderControl label="Audio Chunk Duration (s)" value={s.audioChunkDuration.toFixed(1)}
                onChange={s.setAudioChunkDuration} min={5} max={30} step={0.5}
                description="Max duration per chunk for long text splitting" />
              <div className="flex gap-6 pt-1">
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={labelStyle}>
                  <input type="checkbox" checked={s.denoise} onChange={e => s.setDenoise(e.target.checked)} /> Denoise
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={labelStyle}>
                  <input type="checkbox" checked={s.preprocessPrompt} onChange={e => s.setPreprocessPrompt(e.target.checked)} /> Preprocess Prompt
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={labelStyle}>
                  <input type="checkbox" checked={s.postprocessOutput} onChange={e => s.setPostprocessOutput(e.target.checked)} /> Postprocess Output
                </label>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════
// Main page
// ══════════════════════════════════════════════════════
export default function TTSPage() {
  const [mode, setMode] = useState('single'); // 'single' | 'batch'
  const s = useSharedSettings();

  return (
    <Page>
      <PageHeader
        title="Text to Speech"
        subtitle="Tạo giọng nói từ văn bản · Chọn engine VoxCloud (Edge) hoặc VoxLocal (OmniVoice)"
      >
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'single', label: 'Single Text' },
            { value: 'batch',  label: 'Batch Files' },
          ]}
        />
      </PageHeader>
      <PageContent maxWidth={760}>
        {mode === 'single' ? <SingleMode s={s} /> : <BatchMode s={s} />}
      </PageContent>
    </Page>
  );
}

// ══════════════════════════════════════════════════════
// Single mode (original)
// ══════════════════════════════════════════════════════
function SingleMode({ s }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const charColor = text.length > CHAR_LIMIT
    ? 'var(--danger)'
    : text.length >= CHAR_WARN ? '#f0a030' : 'var(--text-secondary)';

  const generate = async () => {
    if (!text.trim() || text.length > CHAR_LIMIT) return;
    setLoading(true); setError(''); setResult(null);
    try {
      let r;
      if (s.engine === 'edge') {
        r = await generateEdgeTTS({ text, voice: s.edgeVoice || undefined, language: s.language || undefined, speed: s.speed });
      } else {
        r = await generateTTS({ text, ...s.ttsParams() });
      }
      setResult(r);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  return (
    <>
      {/* Text input */}
      <label className={labelClass} style={labelStyle}>Text</label>
      <textarea value={text} onChange={e => setText(e.target.value)}
        placeholder="Nhap noi dung can doc..."
        rows={8} className="w-full p-3 rounded-lg mb-1 text-sm resize-none"
        style={{ background: 'var(--bg-card)', border: '1px solid #2a2a40', color: 'var(--text-primary)' }} />
      <div className="flex justify-between text-xs mb-5">
        <span style={{ color: charColor }}>
          {text.length} / {CHAR_LIMIT} characters
          {text.length > CHAR_LIMIT && ' — exceeds limit'}
        </span>
      </div>

      <SettingsPanel s={s} />

      <button onClick={generate} disabled={loading || !text.trim() || text.length > CHAR_LIMIT}
        className="w-full py-3 rounded-lg font-medium text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
        style={{ background: 'var(--accent)' }}>
        {loading ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            <span>Generating audio</span>
            <span className="flex gap-1 ml-1">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          </>
        ) : 'Generate Audio'}
      </button>

      {error && (
        <div className="mt-4 p-3 rounded-lg text-sm" style={{ background: '#2a1a1a', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {result && (
        <div className="mt-5">
          <p className="text-sm mb-2" style={labelStyle}>Duration: {result.duration}s</p>
          <AudioPlayer src={audioURL(result.audio_url)} />
        </div>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════
// Batch mode
// ══════════════════════════════════════════════════════
function BatchMode({ s }) {
  const fileRef = useRef(null);
  const [files, setFiles] = useState([]); // { id, name, text, status, result, error }
  const [processing, setProcessing] = useState(false);
  const cancelRef = useRef(false);

  const readTextFile = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };

  const parseSRT = (raw) => {
    // SRT format: index\ntimecode\ntext\n\n
    return raw.split(/\n\s*\n/).map(block => {
      const lines = block.trim().split('\n');
      // Skip index line (number) and timecode line (contains -->)
      const textLines = lines.filter(l =>
        !/^\d+\s*$/.test(l.trim()) && !l.includes('-->')
      );
      return textLines.join(' ').trim();
    }).filter(Boolean).join('\n');
  };

  const parseVTT = (raw) => {
    // VTT format: WEBVTT header, then same as SRT but may have styles
    const blocks = raw.split(/\n\s*\n/);
    return blocks.map(block => {
      const lines = block.trim().split('\n');
      const textLines = lines.filter(l =>
        !/^WEBVTT/.test(l) &&
        !/^NOTE/.test(l) &&
        !/^STYLE/.test(l) &&
        !/^\d+\s*$/.test(l.trim()) &&
        !l.includes('-->') &&
        !/^Kind:|^Language:/.test(l)
      );
      // Strip VTT tags like <b>, <i>, <c.classname>
      return textLines.join(' ').replace(/<[^>]+>/g, '').trim();
    }).filter(Boolean).join('\n');
  };

  const extractText = (raw, ext) => {
    if (ext === '.srt') return parseSRT(raw);
    if (ext === '.vtt') return parseVTT(raw);
    return raw.trim();
  };

  const handleFiles = async (fileList) => {
    const newFiles = [];
    for (const file of fileList) {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (!TEXT_EXTS.includes(ext)) continue;
      try {
        const raw = await readTextFile(file);
        const text = extractText(raw, ext);
        if (!text.trim()) continue;
        newFiles.push({
          id: crypto.randomUUID(),
          name: file.name,
          text: text.trim(),
          status: 'pending',
          result: null,
          error: null,
        });
      } catch {}
    }
    setFiles(prev => [...prev, ...newFiles]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const items = e.dataTransfer.items;
    if (items) {
      const allFiles = [];
      const promises = [];
      for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          promises.push(collectFiles(entry, allFiles));
        }
      }
      Promise.all(promises).then(() => handleFiles(allFiles));
    } else {
      handleFiles(e.dataTransfer.files);
    }
  };

  const collectFiles = (entry, result) => {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file(f => { result.push(f); resolve(); });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        reader.readEntries(async (entries) => {
          for (const e of entries) {
            await collectFiles(e, result);
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  };

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const clearAll = () => {
    setFiles([]);
  };

  const startBatch = async () => {
    setProcessing(true);
    cancelRef.current = false;

    const params = s.ttsParams();
    const isCloud = s.engine === 'edge';

    for (let i = 0; i < files.length; i++) {
      if (cancelRef.current) break;
      const f = files[i];
      if (f.status === 'done') continue;

      setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: 'processing' } : x));

      try {
        let r;
        if (isCloud) {
          r = await generateEdgeTTS({ text: f.text, voice: s.edgeVoice || undefined, language: s.language || undefined, speed: s.speed });
        } else {
          r = await generateTTS({ text: f.text, ...params });
        }
        setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: 'done', result: r } : x));
      } catch (e) {
        setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: 'error', error: e.message } : x));
      }
    }

    setProcessing(false);
  };

  const stopBatch = () => {
    cancelRef.current = true;
  };

  const doneCount = files.filter(f => f.status === 'done').length;
  const errorCount = files.filter(f => f.status === 'error').length;
  const totalCount = files.length;

  return (
    <>
      {/* Drop zone */}
      <div
        className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer mb-5 transition-colors"
        style={{ borderColor: '#2a2a40', background: 'var(--bg-card)' }}
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
      >
        <input ref={fileRef} type="file" accept=".txt,.srt,.vtt,.md,.csv,.tsv,.json" multiple
          className="hidden"
          onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
        />
        <FolderUp size={32} className="mx-auto mb-3" style={{ color: 'var(--text-secondary)' }} />
        <p className="text-sm mb-1">Drop files or folder here, or click to browse</p>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Supports: {TEXT_EXTS.join(', ')} — Each file generates one audio
        </p>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <>
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm" style={labelStyle}>
              {totalCount} file{totalCount > 1 ? 's' : ''}
              {doneCount > 0 && <span style={{ color: 'var(--success)' }}> — {doneCount} done</span>}
              {errorCount > 0 && <span style={{ color: 'var(--danger)' }}> — {errorCount} failed</span>}
            </p>
            {!processing && (
              <button onClick={clearAll} className="text-xs px-3 py-1 rounded-lg"
                style={{ color: 'var(--danger)', background: 'var(--bg-surface)' }}>
                Clear All
              </button>
            )}
          </div>

          <div className="space-y-2 mb-5" style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {files.map(f => (
              <div key={f.id} className="flex items-center gap-3 p-3 rounded-lg"
                style={{ background: 'var(--bg-surface)', border: '1px solid #2a2a40' }}>
                {/* Status icon */}
                <div className="flex-shrink-0">
                  {f.status === 'pending' && <FileText size={16} style={{ color: 'var(--text-secondary)' }} />}
                  {f.status === 'processing' && <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />}
                  {f.status === 'done' && <Check size={16} style={{ color: 'var(--success)' }} />}
                  {f.status === 'error' && <X size={16} style={{ color: 'var(--danger)' }} />}
                </div>

                {/* File info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm truncate">{f.name}</p>
                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                      {f.status === 'done' && f.result && (
                        <a href={audioURL(f.result.audio_url)} download={f.name.replace(/\.[^.]+$/, '.wav')}
                          className="p-1.5 rounded-lg hover:opacity-80" style={{ color: 'var(--accent)' }}>
                          <Download size={14} />
                        </a>
                      )}
                      {!processing && (
                        <button onClick={() => removeFile(f.id)} className="p-1.5 rounded-lg hover:opacity-80"
                          style={{ color: 'var(--text-secondary)' }}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                    {f.text.length} chars{f.result && ` · ${f.result.duration}s`}
                    {f.error && <span style={{ color: 'var(--danger)' }}> — {f.error}</span>}
                  </p>
                  {f.status === 'done' && f.result && (
                    <div className="mt-2">
                      <AudioPlayer src={audioURL(f.result.audio_url)} filename={f.name.replace(/\.[^.]+$/, '.wav')} compact />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <SettingsPanel s={s} />

      {/* Batch action buttons */}
      {files.length > 0 && (
        <div className="flex gap-3">
          {processing ? (
            <button onClick={stopBatch}
              className="w-full py-3 rounded-lg font-medium text-white flex items-center justify-center gap-2"
              style={{ background: 'var(--danger)' }}>
              <X size={18} /> Stop
            </button>
          ) : (
            <>
              <button onClick={startBatch} disabled={files.every(f => f.status === 'done')}
                className="flex-1 py-3 rounded-lg font-medium text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
                style={{ background: 'var(--accent)' }}>
                <FolderUp size={18} />
                {doneCount > 0 && doneCount < totalCount ? 'Resume' : 'Generate All'} ({totalCount - doneCount} files)
              </button>
              {doneCount > 0 && (
                <a href="#" onClick={(e) => {
                    e.preventDefault();
                    files.filter(f => f.status === 'done' && f.result).forEach(f => {
                      const a = document.createElement('a');
                      a.href = audioURL(f.result.audio_url);
                      a.download = f.name.replace(/\.[^.]+$/, '.wav');
                      a.click();
                    });
                  }}
                  className="py-3 px-5 rounded-lg font-medium flex items-center gap-2"
                  style={{ background: 'var(--bg-card)', border: '1px solid #2a2a40', color: 'var(--text-primary)' }}>
                  <Download size={18} /> Download All
                </a>
              )}
            </>
          )}
        </div>
      )}

      {/* Progress bar */}
      {processing && totalCount > 0 && (
        <div className="mt-4">
          <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-card)' }}>
            <div className="h-full rounded-full transition-all" style={{
              background: 'var(--accent)',
              width: `${((doneCount + errorCount) / totalCount) * 100}%`,
            }} />
          </div>
          <p className="text-xs mt-2 text-center" style={labelStyle}>
            Processing {doneCount + errorCount + 1} / {totalCount}...
          </p>
        </div>
      )}
    </>
  );
}
