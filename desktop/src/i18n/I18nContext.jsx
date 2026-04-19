import { createContext, useCallback, useContext, useEffect, useState } from "react";
import vi from "./translations/vi";
import en from "./translations/en";

const TRANSLATIONS = { vi, en };
const STORAGE_KEY = "voxstudio:locale";

const I18nContext = createContext(null);

function detectDefault() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && TRANSLATIONS[saved]) return saved;
  } catch {}
  // Default Vietnamese for this product
  const nav = typeof navigator !== "undefined" ? navigator.language || "" : "";
  if (nav.toLowerCase().startsWith("vi")) return "vi";
  return "vi"; // prefer VN as primary market
}

// Resolve "auth.login.title" → translations.auth.login.title
function resolve(obj, key) {
  return key.split(".").reduce((acc, part) => (acc == null ? undefined : acc[part]), obj);
}

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(() => detectDefault());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {}
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const t = useCallback(
    (key, params) => {
      const dict = TRANSLATIONS[locale] || TRANSLATIONS.vi;
      let value = resolve(dict, key);
      if (value == null) value = resolve(TRANSLATIONS.vi, key);
      if (value == null) return key;
      if (typeof value !== "string" || !params) return value;
      return value.replace(/\{(\w+)\}/g, (_, p) =>
        params[p] != null ? String(params[p]) : `{${p}}`,
      );
    },
    [locale],
  );

  const setLocale = useCallback((next) => {
    if (TRANSLATIONS[next]) setLocaleState(next);
  }, []);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, locales: Object.keys(TRANSLATIONS) }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

export function useT() {
  return useI18n().t;
}
