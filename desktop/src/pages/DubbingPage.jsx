import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload, Loader2, ArrowLeft, Film, Trash2, Download, Play, Pause, Languages,
  Mic, Subtitles, FileDown, ChevronRight, ChevronLeft, Wand2, Volume2,
  Settings2, Scissors, Crop, Monitor, Smartphone, Square, RectangleHorizontal,
  Undo2, Redo2,
} from 'lucide-react';
import {
  createDubbingProject, listDubbingProjects, getDubbingProject,
  deleteDubbingProject, transcribeProject, translateProject,
  updateProjectSettings, updateSubtitleStyle, subtitleDownloadURL,
  updateSegment, deleteSegment, splitSegment, mergeSegments, generateSegment,
  generateAllSegments, exportVideo, segmentAudioURL, dubbingVideoURL,
  exportDownloadURL, listVoices, dubbedTrackURL, separateVocals,
  accompanimentURL, vocalsURL, getGeminiStatus, setGeminiKey, autoDub,
} from '../services/api';
import Timeline from '../components/dubbing/Timeline';
import VoiceLibraryPanel from '../components/dubbing/VoiceLibraryPanel';
import ScriptEditor from '../components/dubbing/ScriptEditor';
import VoiceSettingsPanel from '../components/dubbing/VoiceSettingsPanel';
import SubtitleOverlay from '../components/dubbing/SubtitleOverlay';

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const ASPECT_RATIOS = [
  { value: 'original', label: 'Original', icon: Monitor, desc: 'Original dimensions' },
  { value: '16:9', label: '16:9', icon: RectangleHorizontal, desc: 'YouTube, ads' },
  { value: '9:16', label: '9:16', icon: Smartphone, desc: 'TikTok, Reels, Shorts' },
  { value: '4:5', label: '4:5', icon: RectangleHorizontal, desc: 'LinkedIn, Facebook ads' },
  { value: '1:1', label: '1:1', icon: Square, desc: 'Instagram posts' },
];

function getAspectStyle(ratio) {
  if (ratio === 'original') return {};
  const [w, h] = ratio.split(':').map(Number);
  return { aspectRatio: `${w}/${h}`, maxWidth: '100%', maxHeight: '100%', objectFit: 'cover' };
}

const LANGUAGES = [
  { value: 'auto', label: 'Auto Detect' },
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
  { value: 'hindi', label: 'Hindi' },
];
const TARGET_LANGUAGES = LANGUAGES.filter(l => l.value !== 'auto');
const selectStyle = { background: '#1a1a2e', border: '1px solid #252542', color: '#e0e0e0' };

export default function DubbingPage() {
  const [project, setProject] = useState(null);
  return project
    ? <ProjectEditor project={project} setProject={setProject} onBack={() => setProject(null)} />
    : <ProjectList onOpen={setProject} />;
}

// ══════════════════════════════════════════════════════
// Project List
// ══════════════════════════════════════════════════════
function ProjectList({ onOpen }) {
  const fileRef = useRef(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('vietnamese');
  const [voiceId, setVoiceId] = useState('');
  const [voices, setVoices] = useState([]);

  useEffect(() => {
    listDubbingProjects().then(r => setProjects(r.projects || [])).catch(() => {}).finally(() => setLoading(false));
    listVoices().then(r => setVoices(r.voices || [])).catch(() => {});
  }, []);

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const p = await createDubbingProject(file, targetLang, voiceId || undefined, sourceLang, true, true);
      onOpen(p);
    } catch (e) { alert('Upload failed: ' + e.message); }
    setUploading(false);
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!confirm('Delete this project?')) return;
    await deleteDubbingProject(id);
    setProjects(prev => prev.filter(p => p.id !== id));
  };

  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      <div style={{ maxWidth: 640, width: '100%' }}>
        <h2 className="text-xl font-semibold mb-6" style={{ color: '#e0e0e0' }}>STT Studio</h2>

        {/* Settings */}
        <div className="flex gap-3 mb-5">
          <div className="flex-1">
            <label className="block text-xs mb-1" style={{ color: '#555' }}>Source Language</label>
            <select value={sourceLang} onChange={e => setSourceLang(e.target.value)}
              className="w-full p-2 rounded-lg text-sm" style={selectStyle}>
              {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs mb-1" style={{ color: '#555' }}>Target Language</label>
            <select value={targetLang} onChange={e => setTargetLang(e.target.value)}
              className="w-full p-2 rounded-lg text-sm" style={selectStyle}>
              {TARGET_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs mb-1" style={{ color: '#555' }}>Voice</label>
            <select value={voiceId} onChange={e => setVoiceId(e.target.value)}
              className="w-full p-2 rounded-lg text-sm" style={selectStyle}>
              <option value="">Default</option>
              {voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        </div>

        {/* Upload */}
        <div className="rounded-xl p-12 text-center cursor-pointer mb-6 transition-all hover:border-opacity-80"
          style={{ border: '2px dashed #252542', background: 'rgba(255,255,255,0.02)' }}
          onClick={() => !uploading && fileRef.current?.click()}>
          <input ref={fileRef} type="file" accept="video/*" className="hidden"
            onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} />
          {uploading ? (
            <><Loader2 size={32} className="mx-auto mb-3 animate-spin" style={{ color: 'var(--accent)' }} />
            <p className="text-sm" style={{ color: '#888' }}>Processing video...</p></>
          ) : (
            <><Upload size={32} className="mx-auto mb-3" style={{ color: '#444' }} />
            <p className="text-sm mb-1" style={{ color: '#888' }}>Drop video or click to upload</p>
            <p className="text-xs" style={{ color: '#444' }}>MP4, MOV, AVI, MKV</p></>
          )}
        </div>

        {/* Projects */}
        {loading ? (
          <div className="flex items-center gap-2 text-xs" style={{ color: '#555' }}>
            <Loader2 size={12} className="animate-spin" /> Loading...
          </div>
        ) : projects.length > 0 && (
          <div>
            <p className="text-xs mb-2" style={{ color: '#444' }}>Recent projects</p>
            <div className="space-y-1">
              {projects.map(p => (
                <div key={p.id} onClick={() => onOpen(p)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all group"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e38' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}>
                  <Film size={14} style={{ color: 'var(--accent)' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: '#ccc' }}>{p.video_filename}</p>
                    <p className="text-xs" style={{ color: '#444' }}>
                      {Math.round(p.video_duration)}s — {p.segments?.length || 0} segments
                    </p>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded"
                    style={{ background: p.status === 'done' ? '#22c55e22' : '#1a1a2e',
                             color: p.status === 'done' ? '#22c55e' : '#555' }}>
                    {p.status}
                  </span>
                  <button onClick={(e) => handleDelete(p.id, e)} className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: '#ef4444' }}>
                    <Trash2 size={12} />
                  </button>
                  <ChevronRight size={14} style={{ color: '#333' }} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// Project Editor — 3-Panel Layout
// ══════════════════════════════════════════════════════
function ProjectEditor({ project: initialProject, setProject: setParentProject, onBack }) {
  const [project, setProject] = useState(initialProject);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  // Save current state before changing project (for undo)
  const setProjectWithHistory = useCallback((newProject) => {
    setProject(prev => {
      setUndoStack(stack => [...stack.slice(-30), prev]); // keep max 30
      setRedoStack([]);
      return typeof newProject === 'function' ? newProject(prev) : newProject;
    });
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    setRedoStack(stack => [...stack, project]);
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(stack => stack.slice(0, -1));
    setProject(prev);
    // Persist to backend
    updateProjectSettings(prev.id, { segments: prev.segments }).catch(() => {});
  }, [undoStack, project]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    setUndoStack(stack => [...stack, project]);
    const next = redoStack[redoStack.length - 1];
    setRedoStack(stack => stack.slice(0, -1));
    setProject(next);
    updateProjectSettings(next.id, { segments: next.segments }).catch(() => {});
  }, [redoStack, project]);

  const [selectedSegId, setSelectedSegId] = useState(null);
  const [selectedSegIds, setSelectedSegIds] = useState(new Set());
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [voices, setVoices] = useState([]);
  const [ttsEngine, setTtsEngine] = useState(project.tts_engine || 'edge');
  const [edgeVoice, setEdgeVoice] = useState(project.edge_voice || '');
  const [transcribing, setTranscribing] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [geminiAvailable, setGeminiAvailable] = useState(false);
  const [showTranslateMenu, setShowTranslateMenu] = useState(false);
  const [showGeminiKeyInput, setShowGeminiKeyInput] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [separatingVocals, setSeparatingVocals] = useState(false);
  const [autoDubbing, setAutoDubbing] = useState(false);
  const [autoDubProgress, setAutoDubProgress] = useState(null); // {step, label, progress}
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(project.aspect_ratio || 'original');
  const [trimStart, setTrimStart] = useState(project.trim_start ?? 0);
  const [trimEnd, setTrimEnd] = useState(project.trim_end ?? project.video_duration);
  const [showAspectMenu, setShowAspectMenu] = useState(false);
  const [originalVolume, setOriginalVolume] = useState(0.3);
  const [dubbedVolume, setDubbedVolume] = useState(1.0);
  const [muteOriginal, setMuteOriginal] = useState(false);
  const [muteDubbed, setMuteDubbed] = useState(false);
  const [accompVolume, setAccompVolume] = useState(0.8);
  const [muteAccomp, setMuteAccomp] = useState(false);
  const videoRef = useRef(null);
  const dubbedAudioRef = useRef(null);
  const accompAudioRef = useRef(null);

  const segments = project.segments || [];
  const doneCount = segments.filter(s => s.status === 'done').length;
  const hasTranslations = segments.some(s => s.translated_text?.trim());
  const enableDubbing = project.enable_dubbing ?? true;
  const enableSubtitle = project.enable_subtitle ?? true;
  const selectedSeg = segments.find(s => s.id === selectedSegId) || null;
  const hasSegments = segments.length > 0;
  const subtitleStyle = project.subtitle_style || {
    font_family: 'Arial', font_size: 24, font_color: '#FFFFFF', font_bold: false,
    font_italic: false, bg_color: '#000000', bg_opacity: 0.6, outline_color: '#000000',
    outline_width: 2, shadow_offset: 1, position: 'bottom', margin_v: 30,
  };

  // Load cloned voices (for VoxLocal)
  useEffect(() => {
    listVoices().then(r => setVoices(r.voices || [])).catch(() => {});
    getGeminiStatus().then(r => setGeminiAvailable(r.available)).catch(() => {});
  }, []);

  // Auto-select first segment when project loads
  useEffect(() => {
    if (segments.length > 0 && !selectedSegId) {
      setSelectedSegId(segments[0].id);
    }
  }, [segments.length]);

  // Auto-dub: tự động chạy pipeline khi mở project mới (chưa có segments)
  const autoDubTriggered = useRef(false);
  useEffect(() => {
    if (!autoDubTriggered.current && segments.length === 0 && !autoDubbing && project.status === 'created') {
      autoDubTriggered.current = true;
      const engine = geminiAvailable ? 'gemini' : 'google';
      handleAutoDub(engine);
    }
  }, [project.status, segments.length, geminiAvailable]);

  // Video time tracking + continuous dubbed track sync
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const dubbedEl = new Audio();
    dubbedEl.src = dubbedTrackURL(project.id);
    dubbedEl.preload = 'auto';
    dubbedAudioRef.current = dubbedEl;

    const onTime = () => {
      setCurrentTime(v.currentTime);
      // Keep dubbed track in sync with video (correct drift > 0.3s)
      if (!dubbedEl.paused && Math.abs(dubbedEl.currentTime - v.currentTime) > 0.3) {
        dubbedEl.currentTime = v.currentTime;
      }
    };
    const onPlay = () => {
      setIsPlaying(true);
      if (!muteDubbed) {
        dubbedEl.currentTime = v.currentTime;
        dubbedEl.play().catch(() => {});
      }
    };
    const onPause = () => {
      setIsPlaying(false);
      dubbedEl.pause();
    };
    const onSeeked = () => {
      dubbedEl.currentTime = v.currentTime;
    };

    v.addEventListener('timeupdate', onTime);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', onSeeked);
      dubbedEl.pause();
      dubbedEl.src = '';
    };
  }, [muteDubbed, project.id]);

  // Accompaniment track sync (plays background music/SFX without original voice)
  useEffect(() => {
    if (!project.has_accompaniment) return;
    const v = videoRef.current;
    if (!v) return;

    const accompEl = new Audio();
    accompEl.src = accompanimentURL(project.id);
    accompEl.preload = 'auto';
    accompEl.volume = muteAccomp ? 0 : accompVolume;
    accompAudioRef.current = accompEl;

    const onPlay = () => {
      if (!muteAccomp) {
        accompEl.currentTime = v.currentTime;
        accompEl.play().catch(() => {});
      }
    };
    const onPause = () => accompEl.pause();
    const onSeeked = () => { accompEl.currentTime = v.currentTime; };
    const onTime = () => {
      if (!accompEl.paused && Math.abs(accompEl.currentTime - v.currentTime) > 0.3) {
        accompEl.currentTime = v.currentTime;
      }
    };

    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('timeupdate', onTime);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('timeupdate', onTime);
      accompEl.pause();
      accompEl.src = '';
    };
  }, [muteAccomp, project.id, project.has_accompaniment]);

  // Sync volumes
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = muteOriginal ? 0 : originalVolume;
  }, [originalVolume, muteOriginal]);

  useEffect(() => {
    if (dubbedAudioRef.current) dubbedAudioRef.current.volume = muteDubbed ? 0 : dubbedVolume;
  }, [dubbedVolume, muteDubbed]);

  useEffect(() => {
    if (accompAudioRef.current) accompAudioRef.current.volume = muteAccomp ? 0 : accompVolume;
  }, [accompVolume, muteAccomp]);

  const refresh = async () => { try { const p = await getDubbingProject(project.id); setProject(p); } catch {} };

  // ── Handlers ──
  const handleTranscribe = async () => {
    setTranscribing(true);
    try {
      const p = await transcribeProject(project.id);
      setProject(p);
      setTranslating(true);
      try { const p2 = await translateProject(p.id, false, geminiAvailable ? 'gemini' : 'google'); setProject(p2); } catch {}
      setTranslating(false);
    } catch (e) { alert('Transcribe failed: ' + e.message); }
    setTranscribing(false);
  };

  const handleTranslate = async (engine = 'google') => {
    setTranslating(true);
    setShowTranslateMenu(false);
    try {
      const p = await translateProject(project.id, false, engine);
      setProject(p);
    } catch (e) { alert('Translation failed: ' + e.message); }
    setTranslating(false);
  };

  const handleSaveGeminiKey = async () => {
    if (!geminiKeyInput.trim()) return;
    try {
      await setGeminiKey(geminiKeyInput.trim());
      setGeminiAvailable(true);
      setShowGeminiKeyInput(false);
      setGeminiKeyInput('');
    } catch (e) { alert('Failed to save key: ' + e.message); }
  };

  const handleUpdateSegment = async (segId, data) => {
    setProject(p => ({ ...p, segments: p.segments.map(s => s.id === segId ? { ...s, ...data } : s) }));
    try { await updateSegment(project.id, segId, data); } catch {}
  };

  const handleDeleteSegment = async (segId) => {
    if (!confirm('Delete segment?')) return;
    try { const p = await deleteSegment(project.id, segId); setProjectWithHistory(p); if (segId === selectedSegId) setSelectedSegId(null); } catch {}
  };

  const handleSegmentTimeChange = async (segId, newStart, newEnd) => {
    // Optimistic update
    setProject(p => ({
      ...p,
      segments: p.segments.map(s => s.id === segId ? { ...s, start: newStart, end: newEnd } : s),
    }));
    try { await updateSegment(project.id, segId, { start: newStart, end: newEnd }); } catch {}
  };

  const handleMergeSegments = async (segIds) => {
    try { const p = await mergeSegments(project.id, segIds); setProjectWithHistory(p); } catch (e) { alert('Merge failed: ' + e.message); }
  };

  const handleSplitSegment = async (segId, at) => {
    try { const p = await splitSegment(project.id, segId, at); setProjectWithHistory(p); } catch (e) { alert('Split failed: ' + (e?.message || JSON.stringify(e))); }
  };

  const handleGenerateOne = async (segId) => {
    try { const p = await generateSegment(project.id, segId); setProject(p); } catch (e) { alert('Generate failed: ' + e.message); }
  };

  const handleGenerateAll = async () => {
    setGenerating(true);
    try {
      const r = await generateAllSegments(project.id);
      setProject(r.project);
      // Reload dubbed track so the new continuous audio is picked up
      if (dubbedAudioRef.current) {
        dubbedAudioRef.current.src = dubbedTrackURL(project.id) + '?t=' + Date.now();
        dubbedAudioRef.current.load();
      }
    } catch (e) { alert('Generate failed: ' + e.message); }
    setGenerating(false);
  };

  const handleTrimChange = useCallback((start, end) => {
    setTrimStart(start);
    setTrimEnd(end);
    updateProjectSettings(project.id, { trim_start: start, trim_end: end }).catch(() => {});
  }, [project.id]);

  const handleSeparateVocals = async () => {
    setSeparatingVocals(true);
    try {
      const p = await separateVocals(project.id);
      setProject(p);
      // After separation: mute original video audio (has vocals), play accompaniment instead
      setMuteOriginal(true);
      setMuteAccomp(false);
      setAccompVolume(0.7);
    } catch (e) { alert('Vocal separation failed: ' + e.message); }
    setSeparatingVocals(false);
  };

  const handleAutoDub = async (engine = 'google') => {
    setAutoDubbing(true);
    setAutoDubProgress({ step: 'starting', label: 'Khởi động pipeline...', progress: 0 });
    try {
      await autoDub(project.id, {
        engine,
        onProgress: (data) => setAutoDubProgress(data),
        onDone: async () => {
          setAutoDubProgress({ step: 'done', label: 'Hoàn tất!', progress: 100 });
          await refresh();
          setTimeout(() => {
            setAutoDubbing(false);
            setAutoDubProgress(null);
          }, 2000);
        },
        onError: (msg) => {
          setAutoDubProgress({ step: 'error', label: msg, progress: -1 });
          setTimeout(() => {
            setAutoDubbing(false);
            setAutoDubProgress(null);
          }, 5000);
        },
      });
    } catch (e) {
      alert('Auto Dub failed: ' + e.message);
      setAutoDubbing(false);
      setAutoDubProgress(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportVideo(project.id, {
        keep_original_audio: !muteOriginal && originalVolume > 0,
        original_audio_volume: originalVolume,
      });
      await refresh();
    } catch (e) { alert('Export failed: ' + e.message); }
    setExporting(false);
  };

  // Export + Download in one click
  const handleDownload = async () => {
    if (project.status === 'done') {
      // Already exported, just download
      window.open(exportDownloadURL(project.id), '_blank');
      return;
    }
    // Export first, then download
    setExporting(true);
    try {
      await exportVideo(project.id, {
        keep_original_audio: !muteOriginal && originalVolume > 0,
        original_audio_volume: originalVolume,
      });
      await refresh();
      window.open(exportDownloadURL(project.id), '_blank');
    } catch (e) { alert('Export failed: ' + e.message); }
    setExporting(false);
  };

  const seekVideo = useCallback((t) => {
    if (videoRef.current) { videoRef.current.currentTime = t; videoRef.current.play().catch(() => {}); }
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }, []);

  // Navigate segments (↑↓ or Tab in textarea)
  const navigateSegment = useCallback((direction) => {
    if (!segments.length) return;
    const idx = segments.findIndex(s => s.id === selectedSegId);
    const next = Math.max(0, Math.min(segments.length - 1, idx + direction));
    const seg = segments[next];
    setSelectedSegId(seg.id);
    setSelectedSegIds(new Set());
    seekVideo(seg.start);
  }, [segments, selectedSegId, seekVideo]);

  // Multi-select with Shift+Click
  const handleMultiSelect = useCallback((id, shiftKey) => {
    if (!shiftKey) {
      setSelectedSegId(id);
      setSelectedSegIds(new Set());
      return;
    }
    setSelectedSegIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Always include the primary selected
      if (selectedSegId) next.add(selectedSegId);
      next.add(id);
      return next;
    });
    setSelectedSegId(id);
  }, [selectedSegId]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e) => {
      // Don't capture when typing in input/textarea
      const tag = e.target.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      // Space = play/pause (always, even in textarea — CapCut style)
      if (e.code === 'Space' && !isTyping) {
        e.preventDefault();
        togglePlay();
        return;
      }

      if (isTyping) return;

      // ↑↓ = navigate segments
      if (e.key === 'ArrowUp') { e.preventDefault(); navigateSegment(-1); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); navigateSegment(1); return; }

      // ←→ = seek ±1s
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (videoRef.current) videoRef.current.currentTime += 1;
        return;
      }

      // K = split at playhead
      if (e.key === 'k' || e.key === 'K') {
        if (selectedSeg && currentTime > selectedSeg.start && currentTime < selectedSeg.end) {
          handleSplitSegment(selectedSeg.id, currentTime);
        }
        return;
      }

      // G = generate selected
      if (e.key === 'g' || e.key === 'G') {
        if (selectedSeg) handleGenerateOne(selectedSeg.id);
        return;
      }

      // Delete/Backspace = delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedSeg) handleDeleteSegment(selectedSeg.id);
        return;
      }

      // Ctrl+Enter = generate all
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleGenerateAll();
        return;
      }

      // Ctrl+Z = undo, Ctrl+Shift+Z / Ctrl+Y = redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // +/- = zoom timeline (handled by Timeline component via Ctrl+Scroll)
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [togglePlay, navigateSegment, selectedSeg, currentTime, handleSplitSegment, handleGenerateOne, handleDeleteSegment, handleGenerateAll, handleUndo, handleRedo]);

  // Close translate menu on outside click
  useEffect(() => {
    if (!showTranslateMenu) return;
    const close = () => setShowTranslateMenu(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showTranslateMenu]);

  const handleTimelineSelect = (id) => {
    setSelectedSegId(id);
    setSelectedSegIds(new Set());
    const seg = segments.find(s => s.id === id);
    if (seg) seekVideo(seg.start);
  };

  const handleSelectSegment = (id) => {
    setSelectedSegId(id);
    setSelectedSegIds(new Set());
  };

  const canExport = (enableDubbing && doneCount > 0) || (enableSubtitle && hasTranslations);
  const selectedVoiceName = selectedSeg?.voice_id
    ? voices.find(v => v.id === selectedSeg.voice_id)?.name
    : selectedVoiceId
      ? voices.find(v => v.id === selectedVoiceId)?.name
      : null;

  return (
    <div className="flex flex-col" style={{ background: '#0c0c1d', height: '100vh', overflow: 'hidden' }}>

      {/* ── Top Bar ── */}
      <div className="flex items-center gap-2 px-3 h-11 flex-shrink-0"
        style={{ background: '#111128', borderBottom: '1px solid #1a1a35' }}>
        <button onClick={onBack} className="p-1.5 rounded hover:opacity-80" style={{ color: '#555' }}>
          <ArrowLeft size={15} />
        </button>
        <div className="w-px h-5" style={{ background: '#1a1a35' }} />
        <p className="text-sm truncate" style={{ color: '#bbb', maxWidth: 200 }}>{project.video_filename}</p>
        <div className="w-px h-5" style={{ background: '#1a1a35' }} />

        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5">
          <button onClick={handleUndo} disabled={undoStack.length === 0}
            className="p-1.5 rounded transition-all hover:brightness-125"
            style={{ color: undoStack.length > 0 ? '#ccc' : '#444' }}
            title="Undo (Ctrl+Z)">
            <Undo2 size={14} />
          </button>
          <button onClick={handleRedo} disabled={redoStack.length === 0}
            className="p-1.5 rounded transition-all hover:brightness-125"
            style={{ color: redoStack.length > 0 ? '#ccc' : '#444' }}
            title="Redo (Ctrl+Shift+Z)">
            <Redo2 size={14} />
          </button>
        </div>
        <div className="w-px h-5" style={{ background: '#1a1a35' }} />

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-1">
          {!hasSegments ? (
            <TopBtn onClick={handleTranscribe} loading={transcribing}
              icon={<Wand2 size={12} />} label="Auto Script" accent />
          ) : (
            <>
              <TopBtn onClick={handleTranscribe} loading={transcribing}
                icon={<Mic size={12} />} label="Re-transcribe" />
              <div className="relative">
                <div className="flex items-center">
                  <TopBtn onClick={() => handleTranslate(geminiAvailable ? 'gemini' : 'google')} loading={translating}
                    icon={<Languages size={12} />} label={geminiAvailable ? 'Gemini Translate' : 'Translate'} />
                  <button onClick={e => { e.stopPropagation(); setShowTranslateMenu(!showTranslateMenu); }}
                    className="px-1 py-1 rounded-r text-xs hover:brightness-125"
                    style={{ background: '#1a1a35', color: '#888', marginLeft: -2 }}>▾</button>
                </div>
                {showTranslateMenu && (
                  <div className="absolute top-full left-0 mt-1 rounded-lg shadow-xl z-50 py-1 min-w-[180px]"
                    style={{ background: '#1a1a35', border: '1px solid #2a2a4a' }}>
                    <button onClick={() => handleTranslate('google')}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5" style={{ color: '#ccc' }}>
                      🌐 Google Translate
                    </button>
                    <button onClick={() => handleTranslate('qwen')}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5" style={{ color: '#ccc' }}>
                      🤖 Qwen (Local LLM)
                    </button>
                    {geminiAvailable ? (
                      <button onClick={() => handleTranslate('gemini')}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5" style={{ color: '#ccc' }}>
                        ✨ Gemini (ngữ cảnh phim)
                      </button>
                    ) : (
                      <button onClick={() => { setShowTranslateMenu(false); setShowGeminiKeyInput(true); }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5" style={{ color: '#666' }}>
                        🔑 Cài Gemini API Key...
                      </button>
                    )}
                  </div>
                )}
              </div>
              <TopBtn onClick={handleSeparateVocals} loading={separatingVocals}
                icon={<Scissors size={12} />}
                label={project.has_accompaniment ? 'Vocals ✓' : 'Tách Voice'} />
              {hasTranslations && (
                <TopBtn onClick={handleGenerateAll} loading={generating}
                  icon={<Volume2 size={12} />}
                  label={`Generate All (${segments.filter(s => s.translated_text?.trim()).length})`} accent />
              )}
            </>
          )}
          {/* Auto Dub — one-click full pipeline */}
          {!hasSegments && (
            <TopBtn onClick={() => handleAutoDub(geminiAvailable ? 'gemini' : 'google')}
              loading={autoDubbing}
              icon={<Wand2 size={12} />}
              label="⚡ Auto Dub" accent />
          )}
        </div>

        {/* Auto-Dub progress bar */}
        {autoDubProgress && (
          <div className="absolute bottom-0 left-0 right-0 h-6 flex items-center px-3 gap-2"
            style={{ background: '#0d0d1a', borderTop: '1px solid #1a1a35' }}>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#1a1a35' }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.max(0, autoDubProgress.progress)}%`,
                  background: autoDubProgress.step === 'error' ? '#f44' :
                    autoDubProgress.step === 'done' ? '#4f4' : '#6366f1',
                }} />
            </div>
            <span className="text-[10px] whitespace-nowrap" style={{ color: '#888' }}>
              {autoDubProgress.label}
              {autoDubProgress.detail ? ` (${autoDubProgress.detail})` : ''}
            </span>
          </div>
        )}

        {/* Right side: export + download */}
        <div className="flex items-center gap-1.5">
          {enableSubtitle && hasTranslations && (
            <>
              <TopLink href={subtitleDownloadURL(project.id, 'srt')} label=".SRT" />
              <TopLink href={subtitleDownloadURL(project.id, 'ass')} label=".ASS" />
            </>
          )}
          {canExport && (
            <button onClick={handleDownload} disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all hover:brightness-110"
              style={{ background: exporting ? '#555' : '#22c55e', color: '#fff' }}>
              {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              {exporting ? 'Exporting...' : project.status === 'done' ? 'Download' : 'Export & Download'}
            </button>
          )}
          <StatusBadge status={project.status} />
        </div>
      </div>

      {/* ── 3-Panel Main Area ── */}
      <div className="flex flex-1 min-h-0">

        {/* LEFT: Voice Library (collapsible) */}
        {leftCollapsed ? (
          <button onClick={() => setLeftCollapsed(false)}
            className="flex flex-col items-center py-4 gap-2 flex-shrink-0 hover:opacity-80 transition-opacity"
            style={{ width: 36, background: '#0f0f24', borderRight: '1px solid #1e1e38' }}
            title="Expand Voice Library">
            <Mic size={14} style={{ color: 'var(--accent)' }} />
            <span className="text-xs" style={{ color: '#555', writingMode: 'vertical-rl' }}>Voices</span>
          </button>
        ) : (
          <div className="flex flex-shrink-0 relative">
            <VoiceLibraryPanel
              selectedVoiceId={selectedVoiceId}
              onSelectVoice={setSelectedVoiceId}
              projectVoiceId={project.voice_id}
              ttsEngine={ttsEngine}
              onChangeEngine={eng => {
                setTtsEngine(eng);
                updateProjectSettings(project.id, { tts_engine: eng }).then(setProject).catch(() => {});
              }}
              edgeVoice={edgeVoice}
              onChangeEdgeVoice={v => {
                setEdgeVoice(v);
                updateProjectSettings(project.id, { edge_voice: v || null }).then(setProject).catch(() => {});
              }}
              targetLanguage={project.target_language}
            />
            {/* Collapse button */}
            <button onClick={() => setLeftCollapsed(true)}
              className="absolute top-2 right-2 p-1 rounded hover:opacity-80 z-10"
              style={{ color: '#555', background: 'rgba(15,15,36,0.8)' }}
              title="Collapse">
              <ChevronLeft size={12} />
            </button>
          </div>
        )}

        {/* CENTER: Video + Script */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Video */}
          <div className="relative flex items-center justify-center overflow-hidden"
            style={{ background: '#0a0a18', flex: '1 1 50%', minHeight: 200 }}>
            {/* Video with aspect ratio crop */}
            <div className="relative rounded-lg overflow-hidden" style={{
              zIndex: 1,
              ...(aspectRatio !== 'original'
                ? { aspectRatio: aspectRatio.replace(':', '/'), maxWidth: '100%', maxHeight: '100%' }
                : { maxWidth: '100%', maxHeight: '100%' }),
            }}>
              <video ref={videoRef} src={dubbingVideoURL(project.id)}
                className="w-full h-full"
                style={{ objectFit: aspectRatio === 'original' ? 'contain' : 'cover' }}
                onClick={() => togglePlay()}
                onDoubleClick={() => videoRef.current?.requestFullscreen?.()}
              />
            </div>

            {/* Aspect ratio selector (top-right) */}
            <div className="absolute top-2 right-2" style={{ zIndex: 20 }}>
              <button onClick={() => setShowAspectMenu(m => !m)}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-all hover:brightness-125"
                style={{ background: 'rgba(0,0,0,0.6)', color: '#ccc', backdropFilter: 'blur(4px)' }}>
                <Crop size={12} />
                {aspectRatio === 'original' ? 'Original' : aspectRatio}
              </button>
              {showAspectMenu && (
                <div className="absolute right-0 mt-1 rounded-lg shadow-xl overflow-hidden"
                  style={{ background: '#1a1a2e', border: '1px solid #2a2a45', width: 200 }}>
                  {ASPECT_RATIOS.map(ar => {
                    const Icon = ar.icon;
                    const active = aspectRatio === ar.value;
                    return (
                      <button key={ar.value}
                        onClick={() => {
                          setAspectRatio(ar.value);
                          setShowAspectMenu(false);
                          updateProjectSettings(project.id, { aspect_ratio: ar.value }).then(setProject).catch(() => {});
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:brightness-125 transition-all"
                        style={{ background: active ? 'rgba(124,58,237,0.2)' : 'transparent' }}>
                        <Icon size={14} style={{ color: active ? 'var(--accent)' : '#666' }} />
                        <div>
                          <span className="text-xs font-medium" style={{ color: active ? '#fff' : '#ccc' }}>
                            {ar.label}
                          </span>
                          <span className="text-xs ml-2" style={{ color: '#555' }}>{ar.desc}</span>
                        </div>
                        {active && <span className="ml-auto text-xs" style={{ color: 'var(--accent)' }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Custom play overlay when paused */}
            {!isPlaying && (
              <div className="absolute inset-0 flex items-center justify-center"
                style={{ zIndex: 2, pointerEvents: 'none' }}>
                <div className="rounded-full flex items-center justify-center"
                  style={{ width: 48, height: 48, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                  <Play size={20} style={{ color: '#fff', marginLeft: 2 }} />
                </div>
              </div>
            )}
            {/* Subtitle overlay */}
            {enableSubtitle && hasTranslations && (
              <SubtitleOverlay segments={segments} currentTime={currentTime} style={subtitleStyle} />
            )}
            {/* Bottom controls bar */}
            <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 px-3 py-1.5"
              style={{ zIndex: 15, background: 'linear-gradient(transparent, rgba(0,0,0,0.7))' }}>
              <button onClick={() => togglePlay()}
                className="p-1 rounded hover:opacity-80" style={{ color: '#fff' }}>
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>
              {/* Seek bar */}
              <input type="range" min={0} max={project.video_duration || 60} step={0.1}
                value={currentTime}
                onChange={e => { const t = parseFloat(e.target.value); seekVideo(t); }}
                className="flex-1" style={{ accentColor: 'var(--accent)', height: 4 }}
              />
              <span className="text-xs font-mono" style={{ color: '#ccc', fontSize: 10 }}>
                {fmtTime(currentTime)} / {fmtTime(project.video_duration || 0)}
              </span>
              <button onClick={() => videoRef.current?.requestFullscreen?.()}
                className="p-1 rounded hover:opacity-80" style={{ color: '#aaa' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Audio Mixer */}
          {enableDubbing && doneCount > 0 && (
            <div className="flex items-center gap-4 px-4 py-1.5 flex-shrink-0"
              style={{ background: '#0d0d1e', borderTop: '1px solid #1a1a30', borderBottom: '1px solid #1a1a30' }}>
              {/* Original audio */}
              <div className="flex items-center gap-2">
                <button onClick={() => setMuteOriginal(m => !m)}
                  className="text-xs px-1.5 py-0.5 rounded transition-all"
                  style={{ background: muteOriginal ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
                           color: muteOriginal ? '#ef4444' : '#888', fontSize: 10 }}>
                  {muteOriginal ? 'M' : '🔊'}
                </button>
                <span className="text-xs" style={{ color: '#666', width: 50 }}>Original</span>
                <input type="range" min={0} max={1} step={0.05}
                  value={muteOriginal ? 0 : originalVolume}
                  onChange={e => { setMuteOriginal(false); setOriginalVolume(parseFloat(e.target.value)); }}
                  className="w-20" style={{ accentColor: '#888' }} />
                <span className="text-xs font-mono" style={{ color: '#555', width: 28 }}>
                  {muteOriginal ? '0' : Math.round(originalVolume * 100)}%
                </span>
              </div>
              {/* Dubbed audio */}
              <div className="flex items-center gap-2">
                <button onClick={() => setMuteDubbed(m => !m)}
                  className="text-xs px-1.5 py-0.5 rounded transition-all"
                  style={{ background: muteDubbed ? 'rgba(239,68,68,0.15)' : 'rgba(124,58,237,0.15)',
                           color: muteDubbed ? '#ef4444' : 'var(--accent)', fontSize: 10 }}>
                  {muteDubbed ? 'M' : '🎙'}
                </button>
                <span className="text-xs" style={{ color: '#666', width: 50 }}>Dubbed</span>
                <input type="range" min={0} max={1} step={0.05}
                  value={muteDubbed ? 0 : dubbedVolume}
                  onChange={e => { setMuteDubbed(false); setDubbedVolume(parseFloat(e.target.value)); }}
                  className="w-20" style={{ accentColor: 'var(--accent)' }} />
                <span className="text-xs font-mono" style={{ color: '#555', width: 28 }}>
                  {muteDubbed ? '0' : Math.round(dubbedVolume * 100)}%
                </span>
              </div>
              {/* Accompaniment (background music/SFX) — only shown after vocal separation */}
              {project.has_accompaniment && (
                <div className="flex items-center gap-2">
                  <button onClick={() => setMuteAccomp(m => !m)}
                    className="text-xs px-1.5 py-0.5 rounded transition-all"
                    style={{ background: muteAccomp ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
                             color: muteAccomp ? '#ef4444' : '#22c55e', fontSize: 10 }}>
                    {muteAccomp ? 'M' : '🎵'}
                  </button>
                  <span className="text-xs" style={{ color: '#666', width: 50 }}>BG Music</span>
                  <input type="range" min={0} max={1} step={0.05}
                    value={muteAccomp ? 0 : accompVolume}
                    onChange={e => { setMuteAccomp(false); setAccompVolume(parseFloat(e.target.value)); }}
                    className="w-20" style={{ accentColor: '#22c55e' }} />
                  <span className="text-xs font-mono" style={{ color: '#555', width: 28 }}>
                    {muteAccomp ? '0' : Math.round(accompVolume * 100)}%
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Script Editor */}
          <ScriptEditor
            segments={segments}
            voices={voices}
            selectedSegId={selectedSegId}
            selectedSegIds={selectedSegIds}
            onSelectSegment={handleSelectSegment}
            onMultiSelect={handleMultiSelect}
            onUpdateSegment={handleUpdateSegment}
            onSeekVideo={seekVideo}
            currentTime={currentTime}
            onNavigateSegment={navigateSegment}
          />
        </div>

        {/* RIGHT: Voice Settings (collapsible) */}
        {rightCollapsed ? (
          <button onClick={() => setRightCollapsed(false)}
            className="flex flex-col items-center py-4 gap-2 flex-shrink-0 hover:opacity-80 transition-opacity"
            style={{ width: 36, background: '#0f0f24', borderLeft: '1px solid #1e1e38' }}
            title="Expand Voice Settings">
            <Settings2 size={14} style={{ color: 'var(--accent)' }} />
            <span className="text-xs" style={{ color: '#555', writingMode: 'vertical-rl' }}>Settings</span>
          </button>
        ) : (
          <div className="flex flex-shrink-0 relative">
            {/* Collapse button */}
            <button onClick={() => setRightCollapsed(true)}
              className="absolute top-2 left-2 p-1 rounded hover:opacity-80 z-10"
              style={{ color: '#555', background: 'rgba(15,15,36,0.8)' }}
              title="Collapse">
              <ChevronRight size={12} />
            </button>
            <VoiceSettingsPanel
              segment={selectedSeg}
              voiceName={selectedVoiceName}
              onUpdate={selectedSeg ? (d) => handleUpdateSegment(selectedSeg.id, d) : null}
              onGenerate={enableDubbing && selectedSeg ? () => handleGenerateOne(selectedSeg.id) : null}
              onDelete={selectedSeg ? () => handleDeleteSegment(selectedSeg.id) : null}
              onSplit={selectedSeg ? (at) => handleSplitSegment(selectedSeg.id, at) : null}
              audioUrl={selectedSeg?.status === 'done' ? segmentAudioURL(project.id, selectedSeg.id) : null}
              showDubbing={enableDubbing}
            />
          </div>
        )}
      </div>

      {/* ── Timeline ── */}
      {hasSegments && (
        <Timeline
          segments={segments}
          duration={project.video_duration}
          selectedId={selectedSegId}
          onSelect={handleTimelineSelect}
          onSeek={seekVideo}
          currentTime={currentTime}
          trimStart={trimStart}
          trimEnd={trimEnd}
          onTrimChange={handleTrimChange}
          onSplitAtPlayhead={selectedSeg ? () => {
            const splitAt = (currentTime > selectedSeg.start && currentTime < selectedSeg.end)
              ? currentTime
              : (selectedSeg.start + selectedSeg.end) / 2;
            handleSplitSegment(selectedSeg.id, splitAt);
          } : null}
          hasAccompaniment={!!project.has_accompaniment}
          muteOriginal={muteOriginal}
          onToggleMuteOriginal={() => setMuteOriginal(m => !m)}
          muteDubbed={muteDubbed}
          onToggleMuteDubbed={() => setMuteDubbed(m => !m)}
          muteAccomp={muteAccomp}
          onToggleMuteAccomp={() => setMuteAccomp(m => !m)}
          onSegmentTimeChange={handleSegmentTimeChange}
          onDeleteSegment={handleDeleteSegment}
          onMergeSegments={handleMergeSegments}
        />
      )}

      {/* Gemini API Key Modal */}
      {showGeminiKeyInput && (
        <div className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowGeminiKeyInput(false)}>
          <div className="rounded-xl p-5 w-[420px]"
            style={{ background: '#1a1a2e', border: '1px solid #2a2a4a' }}
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-1" style={{ color: '#fff' }}>
              ✨ Gemini API Key
            </h3>
            <p className="text-xs mb-3" style={{ color: '#666' }}>
              Dùng Gemini để dịch đúng ngữ cảnh phim — xưng hô anh/em, chị/em, tao/mày...
              <br />Free tier: 15 requests/phút, 1M tokens/ngày.
            </p>
            <button onClick={() => { try { window.open('https://aistudio.google.com/app/apikey', '_blank'); } catch {} }}
              className="text-xs underline mb-3 inline-block cursor-pointer" style={{ color: 'var(--accent)', background: 'none', border: 'none' }}>
              Lấy API key tại Google AI Studio →
            </button>
            <div className="flex gap-2">
              <input type="password" value={geminiKeyInput}
                onChange={e => setGeminiKeyInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveGeminiKey()}
                placeholder="AIzaSy..."
                className="flex-1 px-3 py-2 rounded-lg text-xs outline-none"
                style={{ background: '#0d0d1a', border: '1px solid #2a2a4a', color: '#fff' }}
                autoFocus />
              <button onClick={handleSaveGeminiKey}
                className="px-4 py-2 rounded-lg text-xs font-medium"
                style={{ background: 'var(--accent)', color: '#fff' }}>
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small components ──
function StatusBadge({ status }) {
  const isDone = status === 'done';
  return (
    <span className="text-xs px-2 py-0.5 rounded"
      style={{
        background: isDone ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)',
        color: isDone ? '#22c55e' : '#555',
      }}>
      {status}
    </span>
  );
}

function TopBtn({ onClick, loading, icon, label, accent }) {
  return (
    <button onClick={onClick} disabled={loading}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium disabled:opacity-40 transition-all hover:brightness-110"
      style={{
        background: accent ? 'linear-gradient(135deg, var(--accent), #8b5cf6)' : 'rgba(255,255,255,0.05)',
        color: accent ? '#fff' : '#888',
        border: accent ? 'none' : '1px solid #252542',
      }}>
      {loading ? <Loader2 size={12} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

function TopLink({ href, label }) {
  return (
    <a href={href} download
      className="flex items-center gap-1 px-2 py-1.5 rounded text-xs transition-all hover:brightness-110"
      style={{ color: '#666', background: 'rgba(255,255,255,0.03)', border: '1px solid #252542' }}>
      <FileDown size={10} /> {label}
    </a>
  );
}
