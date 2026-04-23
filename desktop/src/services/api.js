import { AppError, fromResponse } from './errors';

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
  // Ngrok free domains chặn request bằng warning page cho tới khi click qua
  // 1 lần. Header này bypass warning cho mọi request từ app.
  headers['ngrok-skip-browser-warning'] = 'true';
  return headers;
}

async function request(path, options = {}) {
  const { headers = {}, ...rest } = options;
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: buildHeaders(headers),
    });
  } catch (e) {
    // AbortError bubbles up as-is
    if (e?.name === 'AbortError') throw e;
    // TypeError: Failed to fetch — DNS/CORS/offline
    throw new AppError(e?.message || 'Network error', {
      kind: 'network', cause: e,
    });
  }
  if (res.status === 401) {
    try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch {}
    throw new AppError('Unauthorized — please sign in again', {
      kind: 'auth', status: 401,
    });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw fromResponse(res, body?.detail || body?.message || null);
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

// ── Plans & /me expanded ────────────────────────────
export async function listPlans() {
  const res = await request('/plans');
  return res.json();
}

export async function fetchMe() {
  const res = await request('/auth/me');
  return res.json();
}

// ── Translate (multi-provider) ──────────────────────
export async function translateTexts({ texts, target, source = 'auto', engine = 'google_free', apiKey, model } = {}) {
  const res = await request('/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      texts, target, source, engine,
      api_key: apiKey || null,
      model: model || null,
    }),
  });
  return res.json();
}

export async function listTranslateEngines() {
  const res = await request('/translate/engines');
  return res.json();
}

// ── STT ─────────────────────────────────────────────
export async function transcribe(audioFile, { language } = {}) {
  const form = new FormData();
  form.append('audio', audioFile);
  if (language && language !== 'auto') form.append('language', language);
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

export function thumbnailURL(projectId) {
  return `${API_BASE}/dubbing/projects/${projectId}/thumbnail`;
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
export function autoDub(projectId, { engine = 'google', onProgress, onDone, onError, signal } = {}) {
  const params = new URLSearchParams();
  if (engine !== 'google') params.set('engine', engine);
  const qs = params.toString();
  const url = `${API_BASE}/dubbing/projects/${projectId}/auto-dub${qs ? '?' + qs : ''}`;

  return fetch(url, {
    method: 'POST',
    signal,
    headers: buildHeaders(),  // kèm Authorization Bearer + ngrok-skip
  }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: res.statusText }));
      throw fromResponse(res, body?.detail || body?.message || null);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastStep = null;

    function pump() {
      return reader.read().then(({ done, value }) => {
        if (done) {
          if (onDone) onDone();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.step) lastStep = data.step;
              if (data.step === 'error' && onError) {
                onError(new AppError(data.label || data.error || 'Pipeline error', {
                  kind: 'pipeline', data: { step: lastStep },
                }));
              } else if (data.step === 'canceled') {
                if (onError) onError(new AppError('Canceled', { kind: 'abort' }));
              } else if (data.step === 'done' && onDone) {
                onDone(data);
              } else if (onProgress) {
                onProgress(data);
              }
            } catch {}
          }
        }
        return pump();
      });
    }
    return pump();
  }).catch((e) => {
    if (e?.name === 'AbortError') throw e;
    if (e instanceof AppError) throw e;
    throw new AppError(e?.message || 'Auto-dub failed', {
      kind: 'network', cause: e,
    });
  });
}

/**
 * ingestFromURL — POST /dubbing/projects/from-url, đọc SSE progress stream.
 *
 * opts: { url, targetLanguage, sourceLanguage, enableDubbing, enableSubtitle,
 *         signal, onProgress(data), onDone(data), onError(err) }
 * Returns promise resolved khi SSE kết thúc hoặc reject khi error.
 */
export function ingestFromURL({
  url,
  targetLanguage = "vietnamese",
  sourceLanguage = "auto",
  enableDubbing = true,
  enableSubtitle = false,
  signal,
  onProgress,
  onDone,
  onError,
} = {}) {
  const body = {
    url,
    target_language: targetLanguage,
    source_language: sourceLanguage,
    enable_dubbing: enableDubbing,
    enable_subtitle: enableSubtitle,
  };
  return fetch(`${API_BASE}/dubbing/projects/from-url`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
    },
    body: JSON.stringify(body),
  }).then(async (res) => {
    if (!res.ok) {
      const data = await res.json().catch(() => ({ detail: res.statusText }));
      throw fromResponse(res, data?.detail || null);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    function pump() {
      return reader.read().then(({ done, value }) => {
        if (done) {
          if (onDone) onDone();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.step === "error" && onError) {
              onError(new AppError(data.label || "Ingest failed", {
                kind: "network", data,
              }));
              return;
            } else if (data.step === "done") {
              if (onDone) onDone(data);
            } else if (onProgress) {
              onProgress(data);
            }
          } catch {}
        }
        return pump();
      });
    }
    return pump();
  }).catch((e) => {
    if (e?.name === "AbortError") throw e;
    if (e instanceof AppError) throw e;
    throw new AppError(e?.message || "Ingest failed", {
      kind: "network", cause: e,
    });
  });
}

// ── Social download (TikTok / Douyin / YouTube / FB / IG / Bilibili …)
/**
 * downloadFetchInfo — POST /download/info để lấy metadata + preview.
 */
export async function downloadFetchInfo(url, { signal, engine = "auto" } = {}) {
  const res = await fetch(`${API_BASE}/download/info`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
    },
    body: JSON.stringify({ url, engine }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: res.statusText }));
    throw fromResponse(res, data?.detail || null);
  }
  return res.json();
}

/**
 * downloadToProject — POST /download/to-project, SSE stream progress.
 * opts: { url, targetLanguage, sourceLanguage, enableDubbing, enableSubtitle,
 *         useWatermark, signal, onProgress, onDone, onError }
 */
export function downloadToProject({
  url,
  targetLanguage = "vietnamese",
  sourceLanguage = "auto",
  enableDubbing = true,
  enableSubtitle = false,
  useWatermark = false,
  engine = "auto",
  maxHeight = 1080,
  signal,
  onProgress,
  onDone,
  onError,
} = {}) {
  const body = {
    url,
    target_language: targetLanguage,
    source_language: sourceLanguage,
    enable_dubbing: enableDubbing,
    enable_subtitle: enableSubtitle,
    use_watermark: useWatermark,
    engine,
    max_height: maxHeight,
  };
  return fetch(`${API_BASE}/download/to-project`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
    },
    body: JSON.stringify(body),
  }).then(async (res) => {
    if (!res.ok) {
      const data = await res.json().catch(() => ({ detail: res.statusText }));
      throw fromResponse(res, data?.detail || null);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    function pump() {
      return reader.read().then(({ done, value }) => {
        if (done) { if (onDone) onDone(); return; }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.step === "error" && onError) {
              onError(new AppError(data.label || "Download failed", {
                kind: "network", data,
              }));
              return;
            } else if (data.step === "done") {
              if (onDone) onDone(data);
            } else if (onProgress) {
              onProgress(data);
            }
          } catch {}
        }
        return pump();
      });
    }
    return pump();
  }).catch((e) => {
    if (e?.name === "AbortError") throw e;
    if (e instanceof AppError) throw e;
    throw new AppError(e?.message || "Download failed", {
      kind: "network", cause: e,
    });
  });
}

export async function cancelAutoDub(projectId) {
  try {
    await fetch(`${API_BASE}/dubbing/projects/${projectId}/cancel`, { method: 'POST' });
  } catch {}
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
