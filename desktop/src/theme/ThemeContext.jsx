import { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "voxstudio:theme";
const THEMES = ["dark", "light", "system"];

const ThemeCtx = createContext(null);

function resolveSystem() {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(pref) {
  const effective = pref === "system" ? resolveSystem() : pref;
  document.documentElement.setAttribute("data-theme", effective);
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const stored = typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(stored) ? stored : "dark";
  });

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [theme]);

  const setTheme = (t) => {
    if (!THEMES.includes(t)) return;
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
  };

  return (
    <ThemeCtx.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
