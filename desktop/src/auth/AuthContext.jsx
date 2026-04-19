import { createContext, useContext, useEffect, useState, useCallback } from "react";

/**
 * Auth context — minimal local-first design.
 *
 * For alpha we store user + token in localStorage and call backend endpoints
 * (to be wired to Clerk/Supabase later). Shape is stable so UI code does not
 * need to change when we swap the provider.
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

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => readStored());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    writeStored(auth);
  }, [auth]);

  const login = useCallback(async ({ email, password }) => {
    setLoading(true);
    try {
      // TODO: replace with real API call (Clerk / Supabase / backend)
      // For now, accept any non-empty combo for alpha dev.
      await new Promise((r) => setTimeout(r, 400));
      if (!email || !password || password.length < 4) {
        throw new Error("invalid");
      }
      const user = {
        id: "local-" + btoa(email).slice(0, 8),
        email,
        name: email.split("@")[0],
        plan: "free",
        avatar: null,
      };
      const token = "stub-" + Math.random().toString(36).slice(2);
      setAuth({ user, token });
      return user;
    } finally {
      setLoading(false);
    }
  }, []);

  const signup = useCallback(async ({ name, email, password }) => {
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 400));
      if (!email || !password || password.length < 8 || !name) {
        throw new Error("invalid");
      }
      const user = {
        id: "local-" + btoa(email).slice(0, 8),
        email,
        name,
        plan: "free",
        avatar: null,
      };
      const token = "stub-" + Math.random().toString(36).slice(2);
      setAuth({ user, token });
      return user;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => setAuth(null), []);

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
