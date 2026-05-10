"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError, getToken, login as apiLogin, me, register as apiRegister, setToken, type User } from "@/lib/api";

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string, name?: string) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) { setUser(null); setLoading(false); return; }
    try {
      const r = await me();
      setUser(r.user);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(task);
  }, [refresh]);

  // Wipe all per-user cached state from localStorage/sessionStorage. Giữ
  // lại các pref UI chung (theme, language). Mọi key bắt đầu "voxstudio:dub:"
  // (voice slots, source/target lang chosen) sẽ bị xoá để tránh leak settings
  // của user trước sang user mới.
  const wipeUserCache = () => {
    if (typeof window === "undefined") return;
    try {
      const keys = Object.keys(localStorage);
      for (const k of keys) {
        if (k.startsWith("voxstudio:dub:") || k.startsWith("voxstudio:tts:")) {
          localStorage.removeItem(k);
        }
      }
      sessionStorage.clear();
    } catch {}
  };

  const login = useCallback(async (email: string, password: string) => {
    const r = await apiLogin({ email, password });
    wipeUserCache();
    setToken(r.token);
    setUser(r.user);
    // Force full reload để mọi component remount fresh, không còn state
    // của user trước. Brutal nhưng 100% reliable — tránh leak data giữa
    // các tài khoản trên cùng browser.
    if (typeof window !== "undefined") {
      window.location.href = "/account";
    }
    return r.user;
  }, []);

  const register = useCallback(async (email: string, password: string, name?: string) => {
    const r = await apiRegister({ email, password, name });
    wipeUserCache();
    setToken(r.token);
    setUser(r.user);
    if (typeof window !== "undefined") {
      window.location.href = "/account";
    }
    return r.user;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    wipeUserCache();
    if (typeof window !== "undefined") {
      window.location.href = "/sign-in";
    }
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
