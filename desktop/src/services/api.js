const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const API_BASE = SERVER_URL + '/api/v1';

// ── Auth token injection ──────────────────────────
// Kept in sync with auth/AuthContext localStorage key.
const AUTH_STORAGE_KEY = 'voxstudio:auth';

function getAuthToken() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const { token } = JSON.parse(raw);
    return token || null;
  } catch {
    return null;
  }
}

function buildHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function request(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: buildHeaders(headers),
  });
  if (res.status === 401) {
    // Clear stale auth on unauthorized
    try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch {}
    throw new Error('Unauthorized — please sign in again');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'API Error');
  }
  return res;
}

export { SERVER_URL, API_BASE, getAuthToken };

// ── TTS ─────────────────────────────────────────────
export async function generateTTS({
  text, voiceId, language, speed, numStep,
  guidanceScale, tShift, layerPenaltyFactor,
  positionTemperature, classTemperature,
  denoise, preprocessPrompt, postprocessOutput,
  audioChunkDuration,
}) {
  const body = {
    text,
    voice_id: voiceId || null,
    language: language || null,
    speed: speed ?? 1.0,
    num_step: numStep ?? null,
    guidance_scale: guidanceScale ?? null,
    t_shift: tShift ?? null,
    layer_penalty_factor: layerPenaltyFactor ?? null,
    position_temperature: positionTemperature ?? null,
    class_temperature: classTemperature ?? null,
    denoise: denoise ?? null,
    preprocess_prompt: preprocessPrompt ?? null,
    postprocess_output: postprocessOutput ?? null,
    audio_chunk_duration: audioChunkDuration ?? null,
  };
  const res = await request('/tts/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export function audioURL(path) {
  return `${SERVER_URL}${path}`;
}

// ── Voices ──────────────────────────────────────────
export async function listVoices() {
  const res = await request('/voices');
  return res.json();
}

export async function previewVoice(audioFile, text, refText = '', params = {}) {
  const form = new FormData();
  form.append('audio', audioFile);
  form.append('text', text);
  if (refText) form.append('ref_text', refText);
  if (params.language) form.append('language', params.language);
  if (params.speed != null) form.append('speed', params.speed);
  if (params.numStep != null) form.append('num_step', params.numStep);
  if (params.guidanceScale != null) form.append('guidance_scale', params.guidanceScale);
  if (params.tShift != null) form.append('t_shift', params.tShift);
  if (params.layerPenaltyFactor != null) form.append('layer_penalty_factor', params.layerPenaltyFactor);
  if (params.positionTemperature != null) form.append('position_temperature', params.positionTemperature);
  if (params.classTemperature != null) form.append('class_temperature', params.classTemperature);
  if (params.denoise != null) form.append('denoise', params.denoise);
  if (params.preprocessPrompt != null) form.append('preprocess_prompt', params.preprocessPrompt);
  if (params.postprocessOutput != null) form.append('postprocess_output', params.postprocessOutput);
  if (params.audioChunkDuration != null) form.append('audio_chunk_duration', params.audioChunkDuration);
  const res = await request('/voices/preview', { method: 'POST', body: form });
  return res.json();
}

export async function cloneVoice(audioFile, name, refText = '', tags = '') {
  const form = new FormData();
  form.append('audio', audioFile);
  form.append('name', name);
  if (refText) form.append('ref_text', refText);
  if (tags) form.append('tags', tags);
  const res = await request('/voices/clone', { method: 'POST', body: form });
  return res.json();
}

export async function deleteVoice(voiceId) {
  const res = await request(`/voices/${voiceId}`, { method: 'DELETE' });
  return res.json();
}

// ── STT ─────────────────────────────────────────────
export async function transcribe(audioFile) {
  const form = new FormData();
  form.append('audio', audioFile);
  const res = await request('/stt/transcribe', { method: 'POST', body: form });
  return res.json();
}

// ── Dubbing ────────────────────────────────────────
export async function createDubbingProject(videoFile, targetLanguage, voiceId, sourceLanguage = 'auto', enableDubbing = true, enableSubtitle = false) {
  const form = new FormData();
  form.append('video', videoFile);
  form.append('target_language', targetLanguage);
  if (voiceId) form.append('voice_id', voiceId);
  form.append('source_language', sourceLanguage);
  form.append('enable_dubbing', enableDubbing);
  form.append('enable_subtitle', enableSubtitle);
  const res = await request('/dubbing/projects', { method: 'POST', body: form });
  return res.json();
}

export async function listDubbingProjects() {
  const res = await request('/dubbing/projects');
  return res.json();
}

export async function getDubbingProject(id) {
  const res = await request(`/dubbing/projects/${id}`);
  return res.json();
}

export async function deleteDubbingProject(id) {
  const res = await request(`/dubbing/projects/${id}`, { method: 'DELETE' });
  return res.json();
}

export function dubbingVideoURL(projectId) {
  return `${API_BASE}/dubbing/projects/${projectId}/video`;
}

export async function transcribeProject(id) {
  const res = await request(`/dubbing/projects/${id}/transcribe`, { method: 'POST' });
  return res.json();
}

export async function translateProject(id, useLLM = false, engine = 'google') {
  const params = new URLSearchParams();
  if (useLLM) params.set('use_llm', 'true');
  if (engine !== 'google') params.set('engine', engine);
  const qs = params.toString();
  const res = await request(`/dubbing/projects/${id}/translate${qs ? '?' + qs : ''}`, { method: 'POST' });
  return res.json();
}

export async function getGeminiStatus() {
  const res = await request('/dubbing/gemini-status');
  return res.json();
}

export async function setGeminiKey(apiKey) {
  const res = await request('/dubbing/gemini-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  });
  return res.json();
}

export async function updateProjectSettings(id, settings) {
  const res = await request(`/dubbing/projects/${id}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return res.json();
}

export async function updateSubtitleStyle(id, style) {
  const res = await request(`/dubbing/projects/${id}/subtitle-style`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(style),
  });
  return res.json();
}

export function subtitleDownloadURL(projectId, fmt = 'srt') {
  return `${API_BASE}/dubbing/projects/${projectId}/subtitles/${fmt}`;
}

export async function updateSegment(projectId, segId, data) {
  const res = await request(`/dubbing/projects/${projectId}/segments/${segId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteSegment(projectId, segId) {
  const res = await request(`/dubbing/projects/${projectId}/segments/${segId}`, { method: 'DELETE' });
  return res.json();
}

export async function splitSegment(projectId, segId, splitAt) {
  const res = await request(`/dubbing/projects/${projectId}/segments/${segId}/split`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ split_at: splitAt }),
  });
  return res.json();
}

export async function mergeSegments(projectId, segIds) {
  const res = await request(`/dubbing/projects/${projectId}/segments/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segment_ids: segIds }),
  });
  return res.json();
}

export async function generateSegment(projectId, segId) {
  const res = await request(`/dubbing/projects/${projectId}/segments/${segId}/generate`, { method: 'POST' });
  return res.json();
}

export function segmentAudioURL(projectId, segId) {
  return `${API_BASE}/dubbing/projects/${projectId}/segments/${segId}/audio`;
}

export function dubbedTrackURL(projectId) {
  return `${API_BASE}/dubbing/projects/${projectId}/dubbed-track`;
}

export async function generateAllSegments(projectId) {
  const res = await request(`/dubbing/projects/${projectId}/generate-all`, { method: 'POST' });
  return res.json();
}

export async function exportVideo(projectId, options = {}) {
  const res = await request(`/dubbing/projects/${projectId}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  return res.json();
}

export function exportDownloadURL(projectId) {
  return `${API_BASE}/dubbing/projects/${projectId}/export/download`;
}

// ── Vocal Separation ──────────────────────────────
export async function separateVocals(projectId) {
  const res = await request(`/dubbing/projects/${projectId}/separate-vocals`, { method: 'POST' });
  return res.json();
}

export function accompanimentURL(projectId) {
  return `${API_BASE}/dubbing/projects/${projectId}/accompaniment`;
}

export function vocalsURL(projectId) {
  return `${API_BASE}/dubbing/projects/${projectId}/vocals`;
}

// ── Edge TTS (VoxCloud) ───────────────────────────
export async function listEdgeVoices() {
  const res = await request('/dubbing/edge-voices');
  return res.json();
}

export async function generateEdgeTTS({ text, voice, language, speed }) {
  const res = await request('/tts/edge-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: voice || null, language: language || null, speed: speed ?? 1.0 }),
  });
  return res.json();
}

// ── Auto-Dub Pipeline ───────────────────────────────
export function autoDub(projectId, { engine = 'google', onProgress, onDone, onError } = {}) {
  const params = new URLSearchParams();
  if (engine !== 'google') params.set('engine', engine);
  const qs = params.toString();
  const url = `${API_BASE}/dubbing/projects/${projectId}/auto-dub${qs ? '?' + qs : ''}`;

  return fetch(url, { method: 'POST' }).then(res => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    function pump() {
      return reader.read().then(({ done, value }) => {
        if (done) {
          if (onDone) onDone();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.step === 'error' && onError) onError(data.label);
              else if (data.step === 'done' && onDone) onDone(data);
              else if (onProgress) onProgress(data);
            } catch {}
          }
        }
        return pump();
      });
    }
    return pump();
  });
}

// ── Health ──────────────────────────────────────────
export async function checkHealth() {
  try {
    const res = await fetch(`${SERVER_URL}/health`);
    return res.json();
  } catch {
    return { status: 'offline' };
  }
}
