import { useState, useRef } from 'react';
import { Upload, Loader2, Check, Play, Save, X, ChevronDown, ChevronUp } from 'lucide-react';
import { cloneVoice, transcribe, previewVoice, audioURL } from '../services/api';
import SpeedKnob from '../components/SpeedKnob';
import AudioPlayer from '../components/AudioPlayer';

const inputStyle = { background: 'var(--bg-card)', border: '1px solid #2a2a40', color: 'var(--text-primary)' };
const selectStyle = { background: 'var(--bg-card)', border: '1px solid #2a2a40', color: 'var(--text-primary)' };
const labelStyle = { color: 'var(--text-secondary)' };

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

const SPEED_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5];

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

export default function VoiceClonePage() {
  const fileRef = useRef(null);

  // Step 1: Upload
  const [file, setFile] = useState(null);
  const [audioSrc, setAudioSrc] = useState(null);
  const [refText, setRefText] = useState('');
  const [transcribing, setTranscribing] = useState(false);

  // Step 2: Preview
  const [testText, setTestText] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewAudioUrl, setPreviewAudioUrl] = useState(null);

  // TTS Settings
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

  // Step 3: Save
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedName, setSavedName] = useState('');

  const [error, setError] = useState('');

  const handleFile = async (f) => {
    setFile(f);
    setError('');
    setPreviewAudioUrl(null);
    setShowSave(false);
    setSaved(false);
    setAudioSrc(URL.createObjectURL(f));
    // Auto-transcribe
    setTranscribing(true);
    try {
      const r = await transcribe(f);
      setRefText(r.text || '');
    } catch {
      // User can type manually
    }
    setTranscribing(false);
  };

  const handlePreview = async () => {
    if (!file || !testText.trim()) return;
    setPreviewing(true);
    setError('');
    setPreviewAudioUrl(null);
    try {
      const r = await previewVoice(file, testText, refText, {
        language: language || undefined,
        speed,
        numStep,
        guidanceScale,
        tShift,
        layerPenaltyFactor,
        positionTemperature,
        classTemperature,
        denoise,
        preprocessPrompt,
        postprocessOutput,
        audioChunkDuration,
      });
      setPreviewAudioUrl(audioURL(r.audio_url));
    } catch (e) {
      setError('Preview failed: ' + e.message);
    }
    setPreviewing(false);
  };

  const handleSave = async () => {
    if (!file || !name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await cloneVoice(file, name.trim(), refText);
      setSaved(true);
      setSavedName(name.trim());
      setShowSave(false);
    } catch (e) {
      setError('Save failed: ' + e.message);
    }
    setSaving(false);
  };

  const reset = () => {
    setFile(null);
    setAudioSrc(null);
    setRefText('');
    setTestText('');
    setPreviewing(false);
    setPreviewAudioUrl(null);
    setShowSave(false);
    setName('');
    setSaved(false);
    setSavedName('');
    setError('');
    setLanguage('');
    setSpeed(1.0);
    setShowAdvanced(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const hasFile = !!file;
  const hasPreview = !!previewAudioUrl;

  return (
    <div className="p-6 mx-auto" style={{ maxWidth: '720px', width: '100%' }}>
      <h2 className="text-2xl font-bold mb-6">Voice Clone</h2>

      {/* ── Step 1: Upload Reference Audio ── */}
      <div className="rounded-xl p-5 mb-4" style={{ background: 'var(--bg-card)', border: '1px solid #2a2a40' }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-bold px-2 py-0.5 rounded-full"
            style={{ background: hasFile ? 'var(--accent)' : 'rgba(255,255,255,0.1)', color: '#fff' }}>1</span>
          <span className="text-sm font-medium">Reference Audio</span>
          {hasFile && <span className="text-xs ml-auto truncate" style={labelStyle}>{file.name}</span>}
        </div>

        {!hasFile ? (
          <div className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors"
            style={{ borderColor: '#2a2a40' }}
            onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept="audio/*" className="hidden"
              onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <Upload size={28} className="mx-auto mb-2" style={{ color: '#555' }} />
            <p className="text-sm mb-0.5" style={{ color: '#888' }}>Upload audio (3-10s recommended)</p>
            <p className="text-xs" style={{ color: '#555' }}>WAV, MP3, FLAC</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Audio player */}
            <AudioPlayer
              src={audioSrc}
              filename={file?.name || 'reference.wav'}
              compact
              onTrim={(newFile, newUrl) => {
                setFile(newFile);
                setAudioSrc(newUrl);
                setPreviewAudioUrl(null);
                setShowSave(false);
                setSaved(false);
              }}
            />

            {/* Reference text */}
            <div>
              <label className="block text-xs mb-1" style={labelStyle}>
                Reference Text {transcribing && <Loader2 size={10} className="inline animate-spin ml-1" />}
              </label>
              <textarea value={refText} onChange={e => setRefText(e.target.value)}
                placeholder="Auto-filled by Whisper, or type manually..."
                rows={2}
                className="w-full p-2.5 rounded-lg text-sm resize-none"
                style={inputStyle} />
            </div>

            <button onClick={reset} className="text-xs flex items-center gap-1 hover:opacity-80"
              style={{ color: '#666' }}>
              <X size={12} /> Change audio
            </button>
          </div>
        )}
      </div>

      {/* ── Step 2: Test Voice ── */}
      {hasFile && (
        <div className="rounded-xl p-5 mb-4" style={{ background: 'var(--bg-card)', border: '1px solid #2a2a40' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: hasPreview ? 'var(--accent)' : 'rgba(255,255,255,0.1)', color: '#fff' }}>2</span>
            <span className="text-sm font-medium">Test Voice</span>
          </div>

          <textarea value={testText} onChange={e => setTestText(e.target.value)}
            placeholder="Enter text to test with this voice..."
            rows={3}
            className="w-full p-3 rounded-lg text-sm resize-none mb-3"
            style={inputStyle} />

          {/* Language */}
          <div className="mb-3">
            <label className="block text-xs mb-1" style={labelStyle}>Language</label>
            <select value={language} onChange={e => setLanguage(e.target.value)}
              className="w-full p-2.5 rounded-lg text-sm" style={selectStyle}>
              {LANGUAGES.map(l => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>

          {/* Speed */}
          <div className="flex flex-col items-center gap-2 mb-3 p-3 rounded-lg"
            style={{ background: 'var(--bg-surface)', border: '1px solid #1e1e38' }}>
            <SpeedKnob value={speed} onChange={setSpeed} min={0.5} max={1.5} step={0.05} />
            <div className="flex gap-1.5 flex-wrap justify-center">
              {SPEED_PRESETS.map(sp => (
                <button key={sp} onClick={() => setSpeed(sp)}
                  className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
                  style={{
                    background: speed === sp ? 'var(--accent)' : 'var(--bg-card)',
                    color: speed === sp ? '#fff' : 'var(--text-secondary)',
                    border: `1px solid ${speed === sp ? 'var(--accent)' : '#2a2a40'}`,
                  }}>
                  {sp}x
                </button>
              ))}
            </div>
          </div>

          {/* Advanced Settings */}
          <button onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 mb-3 text-xs transition-colors"
            style={{ color: 'var(--text-secondary)' }}>
            {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Advanced Settings
          </button>

          {showAdvanced && (
            <div className="mb-3 p-3 rounded-lg space-y-3"
              style={{ background: 'var(--bg-surface)', border: '1px solid #1e1e38' }}>
              <div className="grid grid-cols-2 gap-3">
                <SliderControl label="Inference Steps" value={numStep}
                  onChange={v => setNumStep(Math.round(v))} min={4} max={64} step={1}
                  description="Higher = better quality, slower" />
                <SliderControl label="Guidance Scale (CFG)" value={guidanceScale.toFixed(1)}
                  onChange={setGuidanceScale} min={0} max={4} step={0.1}
                  description="How strongly to follow conditioning" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SliderControl label="Time Shift (t_shift)" value={tShift.toFixed(2)}
                  onChange={setTShift} min={0} max={1} step={0.01}
                  description="Smaller = emphasize low-SNR regions" />
                <SliderControl label="Layer Penalty Factor" value={layerPenaltyFactor.toFixed(1)}
                  onChange={setLayerPenaltyFactor} min={0} max={20} step={0.5}
                  description="Penalty for layer-wise sampling order" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SliderControl label="Position Temperature" value={positionTemperature.toFixed(1)}
                  onChange={setPositionTemperature} min={0} max={20} step={0.5}
                  description="Temperature for position selection" />
                <SliderControl label="Class Temperature" value={classTemperature.toFixed(2)}
                  onChange={setClassTemperature} min={0} max={2} step={0.05}
                  description="0 = greedy, >0 = stochastic sampling" />
              </div>
              <SliderControl label="Audio Chunk Duration (s)" value={audioChunkDuration.toFixed(1)}
                onChange={setAudioChunkDuration} min={5} max={30} step={0.5}
                description="Max duration per chunk for long text splitting" />
              <div className="flex gap-5 pt-1">
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={labelStyle}>
                  <input type="checkbox" checked={denoise} onChange={e => setDenoise(e.target.checked)} /> Denoise
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={labelStyle}>
                  <input type="checkbox" checked={preprocessPrompt} onChange={e => setPreprocessPrompt(e.target.checked)} /> Preprocess Prompt
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={labelStyle}>
                  <input type="checkbox" checked={postprocessOutput} onChange={e => setPostprocessOutput(e.target.checked)} /> Postprocess Output
                </label>
              </div>
            </div>
          )}

          <button onClick={handlePreview} disabled={previewing || !testText.trim()}
            className="w-full py-2.5 rounded-lg font-medium text-white flex items-center justify-center gap-2 disabled:opacity-40 transition-all hover:brightness-110"
            style={{ background: 'linear-gradient(135deg, var(--accent), #8b5cf6)', boxShadow: '0 2px 12px rgba(124,58,237,0.2)' }}>
            {previewing
              ? <><Loader2 size={16} className="animate-spin" /> Generating preview...</>
              : <><Play size={16} /> Generate Preview</>
            }
          </button>

          {/* Preview result */}
          {hasPreview && (
            <div className="mt-3">
              <label className="block text-xs mb-1.5 font-medium" style={labelStyle}>Preview Result</label>
              <AudioPlayer src={previewAudioUrl} filename="voice_preview.wav" />
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Save Voice ── */}
      {hasPreview && !saved && (
        <div className="rounded-xl p-5 mb-4" style={{ background: 'var(--bg-card)', border: '1px solid #2a2a40' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}>3</span>
            <span className="text-sm font-medium">Save Voice</span>
            <span className="text-xs ml-auto" style={labelStyle}>Optional — skip if you don't want to keep it</span>
          </div>

          {!showSave ? (
            <div className="flex gap-2">
              <button onClick={() => setShowSave(true)}
                className="flex-1 py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-all hover:brightness-110"
                style={{ background: 'var(--accent)', color: '#fff' }}>
                <Save size={14} /> Save This Voice
              </button>
              <button onClick={reset}
                className="px-4 py-2.5 rounded-lg text-sm transition-all"
                style={{ background: 'rgba(255,255,255,0.05)', color: '#888', border: '1px solid #2a2a40' }}>
                Discard
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="Voice name (e.g. My Voice, Vietnamese Female...)"
                className="w-full p-2.5 rounded-lg text-sm"
                style={inputStyle}
                autoFocus />
              <div className="flex gap-2">
                <button onClick={handleSave} disabled={saving || !name.trim()}
                  className="flex-1 py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-40"
                  style={{ background: 'var(--accent)', color: '#fff' }}>
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : <><Save size={14} /> Confirm Save</>}
                </button>
                <button onClick={() => setShowSave(false)}
                  className="px-4 py-2.5 rounded-lg text-sm"
                  style={{ background: 'rgba(255,255,255,0.05)', color: '#888', border: '1px solid #2a2a40' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Saved confirmation ── */}
      {saved && (
        <div className="rounded-xl p-5 mb-4 text-center" style={{ background: 'var(--bg-card)', border: '1px solid #22c55e33' }}>
          <Check size={40} className="mx-auto mb-2" style={{ color: 'var(--success)' }} />
          <p className="text-sm font-medium mb-1">Voice "{savedName}" saved!</p>
          <p className="text-xs mb-4" style={labelStyle}>Ready to use in TTS page</p>
          <button onClick={reset}
            className="px-5 py-2 rounded-lg text-sm font-medium transition-all hover:brightness-110"
            style={{ background: 'var(--accent)', color: '#fff' }}>
            Clone Another
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 rounded-lg text-sm" style={{ background: '#2a1a1a', color: 'var(--danger)' }}>
          {error}
        </div>
      )}
    </div>
  );
}
