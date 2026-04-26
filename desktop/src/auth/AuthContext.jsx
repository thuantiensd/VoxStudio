import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { SERVER_URL } from "../services/api";
import { clearCurrentUser } from "../services/keyvault";
import { clearUserLocalStorage } from "../services/userScope";
import { setSentryUser } from "../sentry";

/**
 * Auth context — gọi API, lưu JWT + user trong localStorage.
 *
 * App BẮT BUỘC đăng nhập. ProtectedRoute ở App.jsx redirect về /login khi
 * isAuthenticated=false. Context chỉ để các page lấy user.name / user.email
 * và trigger logout.
 */

const STORAGE_KEY = "voxstudio:auth";
const AuthContext = createContext(null);

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(value) {
  try {
    if (value) {
      const json = JSON.stringify(value);
      localStorage.setItem(STORAGE_KEY, json);
      console.log("[AuthContext] writeStored OK — token len:", value.token?.length || 0,
                  "user:", value.user?.email);
    } else {
      localStorage.removeItem(STORAGE_KEY);
      console.log("[AuthContext] writeStored cleared");
    }
  } catch (e) {
    console.error("[AuthContext] writeStored FAILED:", e);
  }
}

async function callAuth(path, body) {
  const res = await fetch(`${SERVER_URL}/api/v1/auth${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.detail || `Lỗi ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => readStored());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    writeStored(auth);
    // Tag Sentry user context khi auth thay đổi
    setSentryUser(auth?.user?.id || null);
  }, [auth]);

  // Re-validate token on mount — server restart/JWT_SECRET đổi → clear stale
  useEffect(() => {
    if (!auth?.token) return;
    (async () => {
      try {
        const res = await fetch(`${SERVER_URL}/api/v1/auth/me`, {
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "ngrok-skip-browser-warning": "true",
          },
        });
        if (res.status === 401) {
          setAuth(null);  // token invalid/expired → logout silently
        } else if (res.ok) {
          const data = await res.json();
          if (data?.user) setAuth((a) => ({ ...a, user: data.user }));
        }
      } catch {
        // Network error — giữ nguyên session, thử lại sau
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async ({ email, password }) => {
    setLoading(true);
    try {
      const data = await callAuth("/login", { email, password });
      console.log("[AuthContext] login response keys:", Object.keys(data || {}),
                  "token:", typeof data?.token, "len:", data?.token?.length || 0);
      // Persist NGAY (sync) trước khi setAuth — tránh race với child effects
      // (QuotaMonitor v.v.) đọc localStorage trước khi useEffect[auth] kịp ghi.
      writeStored({ user: data.user, token: data.token });
      setAuth({ user: data.user, token: data.token });
      return data.user;
    } finally {
      setLoading(false);
    }
  }, []);

  const signup = useCallback(async ({ name, email, password }) => {
    setLoading(true);
    try {
      const data = await callAuth("/register", { email, password, name });
      writeStored({ user: data.user, token: data.token });  // sync persist
      setAuth({ user: data.user, token: data.token });
      return data.user;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    // Stateless JWT — chỉ cần xoá local
    fetch(`${SERVER_URL}/api/v1/auth/logout`, {
      method: "POST",
      headers: {
        Authorization: auth?.token ? `Bearer ${auth.token}` : "",
        "ngrok-skip-browser-warning": "true",
      },
    }).catch(() => {});
    writeStored(null);  // sync clear ngay
    // Clear sạch data của user trước khi xoá auth (lúc này uid còn đọc được)
    try {
      await clearCurrentUser();
      clearUserLocalStorage();
    } catch (e) {
      console.warn("[logout] cleanup error:", e);
    }
    setAuth(null);
  }, [auth?.token]);

  const updateUser = useCallback(
    (patch) => setAuth((prev) => (prev ? { ...prev, user: { ...prev.user, ...patch } } : prev)),
    [],
  );

  /** Re-fetch /auth/me và merge user object — dùng khi user vừa verify
   *  email, đổi mật khẩu, hoặc cần resync account state từ server. */
  const refreshUser = useCallback(async () => {
    if (!auth?.token) return null;
    try {
      const res = await fetch(`${SERVER_URL}/api/v1/auth/me`, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "ngrok-skip-browser-warning": "true",
        },
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.user) {
        const next = { ...auth, user: data.user };
        writeStored(next);
        setAuth(next);
        return data.user;
      }
    } catch {}
    return null;
  }, [auth]);

  return (
    <AuthContext.Provider
      value={{
        user: auth?.user || null,
        token: auth?.token || null,
        isAuthenticated: !!auth?.user,
        loading,
        login,
        signup,
        logout,
        updateUser,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
