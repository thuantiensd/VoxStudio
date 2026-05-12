/**
 * API client cho VoxStudio backend.
 *
 * - Backend URL: env NEXT_PUBLIC_API_URL (default http://localhost:8000)
 * - JWT token: lưu localStorage key `voxstudio:web:token`
 * - 401 response → tự xoá token + redirect /sign-in
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const API_BASE = `${API_URL}/api/v1`;

const TOKEN_KEY = "voxstudio:web:token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string>) || {}),
  };
  if (!isFormData) headers["Content-Type"] = headers["Content-Type"] || "application/json";
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.detail || body?.message || detail;
    } catch {}
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, detail);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return (await res.text()) as unknown as T;
}

// ── Types ──────────────────────────────────────────────────
export type User = {
  id: number;
  email: string;
  name?: string;
  role: string;
  plan: string;
  email_verified?: boolean;
  plan_expires_at?: string | null;
  credit_balance?: number;
};

export type Plan = {
  id: string;
  name: string;
  price_usd: number;
  price_vnd: number;
  ltd_price_usd?: number;
  ltd_price_vnd?: number;
  ltd_slots_available?: number;
  limits?: Record<string, number>;
  features?: Record<string, unknown>;
};

export type Payment = {
  id: string;
  ref_code: string;
  kind?: "subscription" | "credits";
  plan_id: string;
  credits_amount?: number;
  amount_vnd: number;
  amount_usd: number;
  is_ltd: boolean;
  status: "pending" | "paid" | "cancelled";
  note: string | null;
  created_at: string | null;
  paid_at: string | null;
};

export type CreditPack = {
  id: string;
  name: string;
  base_credits: number;
  bonus_credits: number;
  bonus_percent: number;
  total_credits: number;
  price_vnd: number;
  price_usd: number;
  sort_order: number;
  is_active: boolean;
  is_popular: boolean;
};

export type Bank = {
  name: string;
  bin: string;
  account_no: string;
  account_name: string;
};

export type Voice = {
  id: string;
  name: string;
  language?: string | null;
  tags?: string[];
  created_at: string;
  ref_text?: string | null;
};

export type PremiumVoice = {
  slug: string;
  display_name: string;
  gender: "male" | "female" | string;
  language?: string;
  description?: string;
  preview_url?: string | null;
};

export type EdgeVoice = {
  name: string;
  locale: string;
  gender: string;
};

export type TtsResult = {
  audio_url: string;
  duration: number;
  sample_rate: number;
};

export type SttResult = {
  text: string;
  segments: Array<{
    start?: number;
    end?: number;
    text?: string;
  }>;
  language?: string | null;
};

export type DubbingProject = {
  id: string;
  status?: string;
  video_filename?: string;
  video_duration?: number;
  target_language?: string;
  source_language?: string;
  [key: string]: unknown;
};

export type UsageMonth = {
  dubbing_min: number;
  stt_min: number;
  tts_chars: number;
  translate_tokens: number;
  clone_min: number;
};

export type DubbingListProject = {
  id: string;
  title?: string | null;
  video_filename?: string | null;
  duration_sec?: number | null;
  source_language?: string | null;
  target_language?: string | null;
  status?: string | null;
  created_at?: string | null;
  meta?: Record<string, unknown>;
};

export type Job = {
  id: string;
  kind: string;
  status: string;
  progress?: number | null;
  current_step?: string | null;
  created_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
};

export type DownloadInfo = {
  platform?: string;
  title?: string;
  author?: string;
  thumbnail?: string;
  duration?: number;
  video_url?: string;
  watermark_url?: string;
  audio_url?: string;
  source?: string;
  [key: string]: unknown;
};

// ── Auth ───────────────────────────────────────────────────
export async function register(body: { email: string; password: string; name?: string }) {
  return api<{ token: string; user: User }>("/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function login(body: { email: string; password: string }) {
  return api<{ token: string; user: User }>("/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function me() {
  return api<{ user: User; plan: Plan; usage_month: UsageMonth; feature_flags: string[] }>("/auth/me");
}

export async function verifyOtp(code: string) {
  return api<{ ok: boolean; user: User }>("/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function resendVerification() {
  return api<{ ok: boolean }>("/auth/resend-verification", { method: "POST" });
}

export async function forgotPassword(email: string) {
  return api<{ ok: boolean }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(body: { email: string; code: string; new_password: string }) {
  return api<{ ok: boolean }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Billing ────────────────────────────────────────────────
export async function fetchBank() {
  return api<{ bank: Bank; configured: boolean }>("/billing/bank");
}

export async function checkoutPlan(body: { plan_id: string; is_ltd?: boolean }) {
  return api<{ payment: Payment; bank: Bank; qr_url: string | null }>("/billing/checkout", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function listMyPayments() {
  return api<{ payments: Payment[] }>("/billing/payments");
}

export async function getMyPayment(refCode: string) {
  return api<{ payment: Payment; bank: Bank; qr_url: string | null }>(
    `/billing/payments/${refCode}`,
  );
}

export async function cancelMyPayment(refCode: string) {
  return api<{ ok: boolean }>(`/billing/payments/${refCode}/cancel`, { method: "POST" });
}

// ── Plans (public) ─────────────────────────────────────────
export async function fetchPlans() {
  return api<{ plans: Plan[] }>("/plans");
}

// ── Credits ────────────────────────────────────────────────
export async function fetchCreditPacks() {
  return api<{ packs: CreditPack[] }>("/credits/packs");
}

export async function fetchCreditBalance() {
  return api<{ balance: number }>("/credits/balance");
}

export async function topupCredits(packId: string) {
  return api<{ payment: Payment; bank: Bank; qr_url: string | null }>(
    "/credits/topup",
    {
      method: "POST",
      body: JSON.stringify({ pack_id: packId }),
    },
  );
}

// ── Studio workspace ────────────────────────────────────────
export async function listVoices() {
  return api<{ voices: Voice[]; total: number }>("/voices");
}

export async function listPremiumVoices() {
  return api<{ voices: PremiumVoice[]; total: number }>("/voices/premium");
}

export async function listEdgeVoices() {
  return api<{ voices: EdgeVoice[] }>("/dubbing/edge-voices");
}

export async function generateTts(body: {
  text: string;
  voice_id?: string | null;
  language?: string | null;
  speed?: number;
  num_step?: number | null;
  guidance_scale?: number | null;
  t_shift?: number | null;
  layer_penalty_factor?: number | null;
  position_temperature?: number | null;
  class_temperature?: number | null;
  denoise?: boolean | null;
  preprocess_prompt?: boolean | null;
  postprocess_output?: boolean | null;
  audio_chunk_duration?: number | null;
}) {
  return api<TtsResult>("/tts/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function generateCloudTts(body: {
  text: string;
  voice?: string | null;
  language?: string | null;
  speed?: number;
}) {
  return api<TtsResult>("/tts/edge-generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type SrtTtsCue = { start: number; end: number; text: string };

export async function generateSrtTts(body: {
  cues: SrtTtsCue[];
  engine?: "edge" | "premium";
  voice?: string | null;
  voice_id?: string | null;
  language?: string | null;
  // Premium-only
  num_step?: number;
  guidance_scale?: number;
  t_shift?: number;
  layer_penalty_factor?: number;
  position_temperature?: number;
  class_temperature?: number;
  denoise?: boolean;
  preprocess_prompt?: boolean;
  postprocess_output?: boolean;
}) {
  return api<TtsResult & { n_cues: number; n_errors: number }>(
    "/tts/srt-generate",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export async function cloneVoice(body: {
  audio: File;
  name: string;
  ref_text?: string;
  tags?: string;
  consent: boolean;
}) {
  const form = new FormData();
  form.append("audio", body.audio);
  form.append("name", body.name);
  form.append("ref_text", body.ref_text || "");
  form.append("tags", body.tags || "");
  form.append("consent", String(body.consent));
  return api<Voice>("/voices/clone", {
    method: "POST",
    headers: {},
    body: form,
  });
}

// Preview clone — sinh audio thử với reference audio + text, KHÔNG lưu voice.
// Backend: POST /voices/preview (đúng endpoint desktop dùng).
export async function previewVoiceClone(body: {
  audio: File;
  text: string;
  ref_text?: string;
  language?: string;
  speed?: number;
  num_step?: number;
  guidance_scale?: number;
  t_shift?: number;
  layer_penalty_factor?: number;
  position_temperature?: number;
  class_temperature?: number;
  denoise?: boolean;
  preprocess_prompt?: boolean;
  postprocess_output?: boolean;
  audio_chunk_duration?: number;
}) {
  const form = new FormData();
  form.append("audio", body.audio);
  form.append("text", body.text);
  if (body.ref_text) form.append("ref_text", body.ref_text);
  if (body.language) form.append("language", body.language);
  if (body.speed != null) form.append("speed", String(body.speed));
  if (body.num_step != null) form.append("num_step", String(body.num_step));
  if (body.guidance_scale != null) form.append("guidance_scale", String(body.guidance_scale));
  if (body.t_shift != null) form.append("t_shift", String(body.t_shift));
  if (body.layer_penalty_factor != null) form.append("layer_penalty_factor", String(body.layer_penalty_factor));
  if (body.position_temperature != null) form.append("position_temperature", String(body.position_temperature));
  if (body.class_temperature != null) form.append("class_temperature", String(body.class_temperature));
  if (body.denoise != null) form.append("denoise", String(body.denoise));
  if (body.preprocess_prompt != null) form.append("preprocess_prompt", String(body.preprocess_prompt));
  if (body.postprocess_output != null) form.append("postprocess_output", String(body.postprocess_output));
  if (body.audio_chunk_duration != null) form.append("audio_chunk_duration", String(body.audio_chunk_duration));
  return api<TtsResult>("/voices/preview", {
    method: "POST",
    headers: {},
    body: form,
  });
}

export async function deleteVoice(voiceId: string) {
  return api<{ ok: boolean }>(`/voices/${voiceId}`, {
    method: "DELETE",
  });
}

// ── Translate (multi-provider) ──────────────────────
export type TranslateResult = {
  translations: string[];
  source?: string | null;
  target?: string | null;
  engine?: string | null;
};

export async function translateTexts(body: {
  texts: string[];
  target: string;
  source?: string;
  engine?: string;
  api_key?: string | null;
  model?: string | null;
}) {
  return api<TranslateResult>("/translate", {
    method: "POST",
    body: JSON.stringify({
      texts: body.texts,
      target: body.target,
      source: body.source || "auto",
      engine: body.engine || "google_free",
      api_key: body.api_key || null,
      model: body.model || null,
    }),
  });
}

export async function listTranslateEngines() {
  return api<{ engines: Array<{ id: string; name: string; needs_key: boolean }> }>("/translate/engines");
}

export async function transcribeAudio(body: {
  audio: File;
  language?: string;
}) {
  const form = new FormData();
  form.append("audio", body.audio);
  form.append("language", body.language || "auto");
  return api<SttResult>("/stt/transcribe", {
    method: "POST",
    headers: {},
    body: form,
  });
}

export async function createDubbingProject(body: {
  video: File;
  target_language: string;
  source_language?: string;
  voice_id?: string | null;
  enable_dubbing?: boolean;
  enable_subtitle?: boolean;
  onProgress?: (pct: number) => void;
}) {
  const form = new FormData();
  form.append("video", body.video);
  form.append("target_language", body.target_language);
  form.append("source_language", body.source_language || "auto");
  if (body.voice_id) form.append("voice_id", body.voice_id);
  form.append("enable_dubbing", String(body.enable_dubbing ?? true));
  form.append("enable_subtitle", String(body.enable_subtitle ?? true));

  // fetch() không expose upload progress — dùng XHR khi có onProgress callback
  // để hiện % upload thật cho user (file lớn qua RunPod proxy có thể chậm).
  if (body.onProgress) {
    return new Promise<DubbingProject>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/dubbing/projects`);
      const token = getToken();
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          body.onProgress!(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { reject(new ApiError(xhr.status, "Invalid JSON response")); }
        } else {
          let detail = xhr.statusText;
          try { detail = JSON.parse(xhr.responseText)?.detail || detail; } catch {}
          if (xhr.status === 401) setToken(null);
          reject(new ApiError(xhr.status, detail));
        }
      };
      xhr.onerror = () => reject(new ApiError(0, "Network error"));
      xhr.send(form);
    });
  }

  return api<DubbingProject>("/dubbing/projects", {
    method: "POST",
    headers: {},
    body: form,
  });
}

// ── Dubbing settings & project management ──────────
export async function getDubbingProject(id: string) {
  return api<DubbingProject>(`/dubbing/projects/${id}`);
}

export async function deleteDubbingProject(id: string) {
  return api<{ ok: boolean }>(`/dubbing/projects/${id}`, { method: "DELETE" });
}

export async function cancelDubbingProject(id: string) {
  return api<{ ok: boolean; project_id: string }>(`/dubbing/projects/${id}/cancel`, {
    method: "POST",
  });
}

export async function updateDubbingSettings(
  id: string,
  settings: Record<string, unknown>,
) {
  return api<DubbingProject>(`/dubbing/projects/${id}/settings`, {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export async function updateSubtitleStyle(
  id: string,
  style: Record<string, unknown>,
) {
  return api<DubbingProject>(`/dubbing/projects/${id}/subtitle-style`, {
    method: "PUT",
    body: JSON.stringify(style),
  });
}

export async function transcribeDubbingProject(id: string) {
  return api<{ ok: boolean }>(`/dubbing/projects/${id}/transcribe`, {
    method: "POST",
  });
}

export async function translateDubbingProject(
  id: string,
  options: { use_llm?: boolean; engine?: string } = {},
) {
  const params = new URLSearchParams();
  if (options.use_llm) params.set("use_llm", "true");
  if (options.engine && options.engine !== "google") params.set("engine", options.engine);
  const qs = params.toString();
  return api<{ ok: boolean }>(`/dubbing/projects/${id}/translate${qs ? `?${qs}` : ""}`, {
    method: "POST",
  });
}

/**
 * Trigger auto-dub pipeline cho project. Backend trả SSE stream, ta chỉ
 * cần xác nhận đã enqueue (200 OK) rồi bỏ kết nối — worker GPU sẽ tự chạy.
 *
 * Visual context params (optional, BYOK): enable_visual_context + engine +
 * model + key cho Pass-(-1) VLM phân tích keyframe.
 */
export async function startDubbingAutoDub(
  projectId: string,
  options: {
    engine?: string;
    translate_api_key?: string | null;
    enable_visual_context?: boolean;
    visual_engine?: string | null;
    visual_model?: string | null;
    visual_api_key?: string | null;
  } = {},
): Promise<void> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const res = await fetch(`${API_BASE}/dubbing/projects/${projectId}/auto-dub`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      engine: options.engine || "google",
      translate_api_key: options.translate_api_key || null,
      enable_visual_context: !!options.enable_visual_context,
      visual_engine: options.visual_engine || null,
      visual_model: options.visual_model || null,
      visual_api_key: options.visual_api_key || null,
    }),
    signal: controller.signal,
  }).catch((err) => {
    if (err?.name === "AbortError") return null;
    throw err;
  });
  if (!res) return;
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.detail || body?.message || detail;
    } catch {}
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, detail);
  }
  // Đã 200 OK = job đã enqueue. Đóng stream để khỏi giữ kết nối.
  controller.abort();
}

/** List VLM-capable models per engine cho FE build dropdown. */
export type VisionModel = { id: string; label: string; default?: boolean };
export type VisionModelsResponse = {
  models: Record<string, VisionModel[]>;
};

export async function getVisionModels(): Promise<VisionModelsResponse> {
  return api<VisionModelsResponse>(`/dubbing/vision-models`);
}

/**
 * Fetch một resource thuộc project (video, thumbnail, subtitle) kèm auth
 * và trả về Blob URL (object URL). Caller phải URL.revokeObjectURL khi xong.
 */
export async function fetchDubbingResourceBlobUrl(
  projectId: string,
  resource: "export/stream" | "export/download" | "video" | "thumbnail" | `subtitles/${string}`,
): Promise<string> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/dubbing/projects/${projectId}/${resource}`, { headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.detail || body?.message || detail;
    } catch {}
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, detail);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function getDubbingResourceUrl(
  projectId: string,
  resource: "export/stream" | "export/download" | "video" | "thumbnail" | `subtitles/${string}`,
): Promise<string> {
  const params = new URLSearchParams({ resource });
  const res = await api<{ url: string; expires_at: number }>(
    `/dubbing/projects/${projectId}/signed-url?${params.toString()}`,
  );
  return res.url.startsWith("http") ? res.url : `${API_URL}${res.url}`;
}

/**
 * Fetch subtitle text trực tiếp (SRT/VTT/ASS — text/plain).
 */
export async function fetchDubbingSubtitleText(
  projectId: string,
  fmt: "srt" | "vtt" | "ass",
): Promise<string> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/dubbing/projects/${projectId}/subtitles/${fmt}`, { headers });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return res.text();
}

export async function listDubbingProjects(limit = 20, offset = 0) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return api<{ projects: DubbingListProject[] }>(`/dubbing/projects?${params.toString()}`);
}

export async function listJobs(limit = 20) {
  const params = new URLSearchParams({ limit: String(limit) });
  return api<{ jobs: Job[] }>(`/jobs?${params.toString()}`);
}

export async function fetchDownloadInfo(body: { url: string; engine?: string }) {
  return api<DownloadInfo>("/download/info", {
    method: "POST",
    body: JSON.stringify({
      url: body.url,
      engine: body.engine || "auto",
    }),
  });
}

export async function downloadToProject(body: {
  url: string;
  target_language?: string;
  source_language?: string;
  enable_dubbing?: boolean;
  enable_subtitle?: boolean;
  use_watermark?: boolean;
  engine?: string;
  max_height?: number;
}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/download/to-project`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      url: body.url,
      target_language: body.target_language || "vietnamese",
      source_language: body.source_language || "auto",
      enable_dubbing: body.enable_dubbing ?? true,
      enable_subtitle: body.enable_subtitle ?? true,
      use_watermark: body.use_watermark ?? false,
      engine: body.engine || "auto",
      max_height: body.max_height || 1080,
    }),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = data?.detail || data?.message || detail;
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return res;
}

/* ────────────────────────────────────────────────────────────────
 * User API Keys (BYOK, server-side encrypted)
 * ──────────────────────────────────────────────────────────────── */

export type UserApiKeyInfo = {
  provider: string;
  has_key: boolean;
  test_status: "untested" | "ok" | "invalid" | "error";
  test_message: string;
  last_tested_at: string | null;
  updated_at: string | null;
};

export type UserKeysResponse = {
  supported_providers: string[];
  keys: UserApiKeyInfo[];
};

export async function listUserApiKeys(): Promise<UserKeysResponse> {
  return api<UserKeysResponse>("/user/api-keys");
}

export async function setUserApiKey(provider: string, apiKey: string) {
  return api<{ ok: boolean; key: UserApiKeyInfo }>(
    `/user/api-keys/${encodeURIComponent(provider)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey }),
    },
  );
}

export async function testUserApiKey(
  provider: string,
  apiKey?: string,
): Promise<{ ok: boolean; message: string }> {
  const body = apiKey ? { api_key: apiKey } : null;
  return api<{ ok: boolean; message: string }>(
    `/user/api-keys/${encodeURIComponent(provider)}/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
}

export async function deleteUserApiKey(provider: string) {
  return api<{ ok: boolean; deleted: boolean }>(
    `/user/api-keys/${encodeURIComponent(provider)}`,
    { method: "DELETE" },
  );
}
