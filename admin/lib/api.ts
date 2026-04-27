/**
 * API client — gọi backend VoxStudio với admin JWT.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const API_BASE = `${API_URL}/api/v1`;

const TOKEN_KEY = "voxstudio-admin:token";

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

export async function api<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
    ...(init.headers as Record<string, string> || {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.detail || body?.message || detail;
    } catch {}
    if (res.status === 401) {
      setToken(null);
      if (typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
        location.href = "/login";
      }
    }
    throw new ApiError(res.status, detail);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return (await res.text()) as any;
}

// ── Typed helpers ─────────────────────────────────────────

export async function login(email: string, password: string) {
  const r = await api<{ token: string; user: any }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (r.user?.role !== "admin") {
    throw new ApiError(403, "Tài khoản này không có quyền admin");
  }
  setToken(r.token);
  return r.user;
}

export async function fetchMe() {
  return api<{ user: any; plan: any; usage_month: any; feature_flags: string[] }>("/auth/me");
}

export async function fetchStats() {
  return api<any>("/admin/stats");
}

export async function fetchHealth() {
  return api<any>("/admin/health");
}

export async function fetchUsers(params: {
  q?: string; plan?: string; banned?: "only" | "hide" | "";
  sort?: string; page?: number; per_page?: number;
} = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") qs.set(k, String(v));
  }
  return api<any>(`/admin/users?${qs.toString()}`);
}

export async function fetchUserDetail(id: number) {
  return api<any>(`/admin/users/${id}`);
}

export async function updateUser(id: number, patch: {
  plan?: string; is_banned?: boolean; role?: string;
}) {
  return api<any>(`/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function banUser(id: number) {
  return api<any>(`/admin/users/${id}`, { method: "DELETE" });
}

export async function purgeUser(id: number) {
  return api<any>(`/admin/users/${id}/purge?confirm=DELETE`, { method: "DELETE" });
}

export async function fetchAudit(params: {
  user_id?: number; action?: string; page?: number; per_page?: number;
} = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") qs.set(k, String(v));
  }
  return api<any>(`/admin/audit?${qs.toString()}`);
}

export async function fetchFlags() {
  return api<any>("/admin/feature-flags");
}

export async function upsertFlag(name: string, body: any) {
  return api<any>(`/admin/feature-flags/${name}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteFlag(name: string) {
  return api<any>(`/admin/feature-flags/${name}`, { method: "DELETE" });
}

export async function fetchJobs(params: {
  status?: string; kind?: string; user_id?: number;
  page?: number; per_page?: number;
} = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") qs.set(k, String(v));
  }
  return api<any>(`/admin/jobs?${qs.toString()}`);
}

export async function cancelJob(id: string) {
  return api<any>(`/admin/jobs/${id}/cancel`, { method: "POST" });
}

export async function fetchPlans() {
  return api<any>("/admin/plans");
}

export async function updatePlan(id: string, body: any) {
  return api<any>(`/admin/plans/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function fetchPayments(status: string = "pending", limit: number = 100) {
  const qs = new URLSearchParams({ status, limit: String(limit) });
  return api<{ payments: any[] }>(`/admin/payments?${qs.toString()}`);
}

export async function confirmPayment(refCode: string, note?: string) {
  return api<any>(`/admin/payments/${refCode}/confirm`, {
    method: "POST",
    body: JSON.stringify({ note: note || null }),
  });
}

export async function rejectPayment(refCode: string, note?: string) {
  return api<any>(`/admin/payments/${refCode}/reject`, {
    method: "POST",
    body: JSON.stringify({ note: note || null }),
  });
}
