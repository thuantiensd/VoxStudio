import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { SERVER_URL } from "../services/api";

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
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
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
      setAuth({ user: data.user, token: data.token });
      return data.user;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    // Stateless JWT — chỉ cần xoá local
    fetch(`${SERVER_URL}/api/v1/auth/logout`, {
      method: "POST",
      headers: {
        Authorization: auth?.token ? `Bearer ${auth.token}` : "",
        "ngrok-skip-browser-warning": "true",
      },
    }).catch(() => {});
    setAuth(null);
  }, [auth?.token]);

  const updateUser = useCallback(
    (patch) => setAuth((prev) => (prev ? { ...prev, user: { ...prev.user, ...patch } } : prev)),
    [],
  );

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
