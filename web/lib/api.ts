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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) || {}),
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

export type CreditTransaction = {
  id: number;
  kind: string;
  delta: number;
  balance_after: number;
  ref_id: string | null;
  note: string | null;
  created_at: string | null;
};

export type Bank = {
  name: string;
  bin: string;
  account_no: string;
  account_name: string;
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
  return api<{ user: User; plan: Plan; usage_month: unknown; feature_flags: string[] }>("/auth/me");
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

export async function listMyCreditTransactions() {
  return api<{ transactions: CreditTransaction[] }>("/credits/transactions");
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
