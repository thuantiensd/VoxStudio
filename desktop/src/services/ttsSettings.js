/**
 * ttsSettings — shared TTS preferences đồng bộ giữa TTS page và Studio Dubbing.
 *
 * Khi user đổi giọng / ngôn ngữ ở 1 trang, trang khác mở lên là thấy ngay.
 * Lưu qua userScope (per-user) để mỗi tài khoản có preset riêng.
 */
import { userStorage } from "./userScope";

const KEY = "voxstudio:tts:settings";

/** Danh sách ngôn ngữ semantic — khớp BE và TTS page. 'auto' đầu tiên = bỏ trống. */
export const LANGUAGE_VALUES = [
  "auto", "vietnamese", "english", "chinese", "japanese", "korean",
  "french", "spanish", "german", "portuguese", "russian", "thai",
  "arabic", "hindi", "italian", "dutch", "turkish", "polish",
  "indonesian", "malay",
];

/** Map semantic name → locale prefix dùng cho filter Edge voices. */
export const LOCALE_MAP = {
  vietnamese: "vi", english: "en", chinese: "zh", japanese: "ja", korean: "ko",
  french: "fr", spanish: "es", german: "de", portuguese: "pt", russian: "ru",
  thai: "th", hindi: "hi", arabic: "ar", italian: "it", dutch: "nl",
  turkish: "tr", polish: "pl", indonesian: "id", malay: "ms",
};

/** Reverse: locale prefix → semantic name. Dùng khi voice có locale mà cần map ngược. */
export const LOCALE_TO_SEMANTIC = Object.fromEntries(
  Object.entries(LOCALE_MAP).map(([k, v]) => [v, k])
);

/** Tên hiển thị tiếng Việt cho semantic language. Fallback uppercase. */
export const LANG_LABEL_VI = {
  auto: "Tự động",
  // 20 popular langs có Edge TTS voice
  vietnamese: "Tiếng Việt", english: "English", chinese: "中文",
  japanese: "日本語", korean: "한국어", french: "Français",
  spanish: "Español", german: "Deutsch", portuguese: "Português",
  russian: "Русский", thai: "ภาษาไทย", arabic: "العربية",
  hindi: "हिन्दी", italian: "Italiano", dutch: "Nederlands",
  turkish: "Türkçe", polish: "Polski", indonesian: "Bahasa Indonesia",
  malay: "Bahasa Melayu",
  // Whisper-only langs (transcribe nguồn) — không có voice TTS
  afrikaans: "Afrikaans", albanian: "Shqip", amharic: "አማርኛ",
  armenian: "Հայերեն", assamese: "অসমীয়া", azerbaijani: "Azərbaycanca",
  bashkir: "Башҡортса", basque: "Euskara", belarusian: "Беларуская",
  bengali: "বাংলা", bosnian: "Bosanski", breton: "Brezhoneg",
  bulgarian: "Български", burmese: "မြန်မာ", catalan: "Català",
  croatian: "Hrvatski", czech: "Čeština", danish: "Dansk",
  estonian: "Eesti", faroese: "Føroyskt", finnish: "Suomi",
  galician: "Galego", georgian: "ქართული", greek: "Ελληνικά",
  gujarati: "ગુજરાતી", haitian: "Kreyòl Ayisyen", hausa: "Hausa",
  hawaiian: "ʻŌlelo Hawaiʻi", hebrew: "עברית", hungarian: "Magyar",
  icelandic: "Íslenska", javanese: "Basa Jawa", kannada: "ಕನ್ನಡ",
  kazakh: "Қазақша", khmer: "ខ្មែរ", lao: "ລາວ", latin: "Latina",
  latvian: "Latviešu", lingala: "Lingála", lithuanian: "Lietuvių",
  luxembourgish: "Lëtzebuergesch", macedonian: "Македонски",
  malagasy: "Malagasy", malayalam: "മലയാളം", maltese: "Malti",
  maori: "Māori", marathi: "मराठी", mongolian: "Монгол",
  nepali: "नेपाली", norwegian: "Norsk", nynorsk: "Nynorsk",
  occitan: "Occitan", pashto: "پښتو", persian: "فارسی",
  punjabi: "ਪੰਜਾਬੀ", romanian: "Română", sanskrit: "संस्कृतम्",
  serbian: "Српски", shona: "ChiShona", sindhi: "سنڌي",
  sinhala: "සිංහල", slovak: "Slovenčina", slovenian: "Slovenščina",
  somali: "Soomaali", sundanese: "Basa Sunda", swahili: "Kiswahili",
  swedish: "Svenska", tagalog: "Tagalog", tajik: "Тоҷикӣ",
  tamil: "தமிழ்", tatar: "Татарча", telugu: "తెలుగు",
  tibetan: "བོད་ཡིག", turkmen: "Türkmençe", ukrainian: "Українська",
  urdu: "اردو", uzbek: "Oʻzbekcha", welsh: "Cymraeg",
  yiddish: "ייִדיש", yoruba: "Yorùbá",
  cantonese: "粵語",
};

/**
 * 99 ngôn ngữ Whisper hỗ trợ — dùng cho dropdown Nguồn (transcribe).
 * Sort: Tiếng Việt + English + popular trước, alphabet sau.
 */
export const WHISPER_LANGUAGES = [
  // pinned
  "vietnamese", "english", "chinese", "japanese", "korean",
  // alphabetical rest
  "afrikaans", "albanian", "amharic", "arabic", "armenian", "assamese",
  "azerbaijani", "bashkir", "basque", "belarusian", "bengali", "bosnian",
  "breton", "bulgarian", "burmese", "cantonese", "catalan", "croatian",
  "czech", "danish", "dutch", "estonian", "faroese", "finnish",
  "french", "galician", "georgian", "german", "greek", "gujarati",
  "haitian", "hausa", "hawaiian", "hebrew", "hindi", "hungarian",
  "icelandic", "indonesian", "italian", "javanese", "kannada", "kazakh",
  "khmer", "lao", "latin", "latvian", "lingala", "lithuanian",
  "luxembourgish", "macedonian", "malagasy", "malay", "malayalam", "maltese",
  "maori", "marathi", "mongolian", "nepali", "norwegian", "nynorsk",
  "occitan", "pashto", "persian", "polish", "portuguese", "punjabi",
  "romanian", "russian", "sanskrit", "serbian", "shona", "sindhi",
  "sinhala", "slovak", "slovenian", "somali", "spanish", "sundanese",
  "swahili", "swedish", "tagalog", "tajik", "tamil", "tatar",
  "telugu", "thai", "tibetan", "turkish", "turkmen", "ukrainian",
  "urdu", "uzbek", "welsh", "yiddish", "yoruba",
];

/** Dùng cho dropdown Đích (translate target) — bỏ "auto", còn lại như Whisper. */
export const TRANSLATE_TARGETS = WHISPER_LANGUAGES;

/** Dropdown nguồn: 'auto' đầu tiên + Whisper. */
export const TRANSCRIBE_SOURCES = ["auto", ...WHISPER_LANGUAGES];

/** Helper: lấy label hiển thị, fallback capitalize. */
export function langLabel(code) {
  if (LANG_LABEL_VI[code]) return LANG_LABEL_VI[code];
  return code.charAt(0).toUpperCase() + code.slice(1);
}

const DEFAULTS = {
  engine: "edge",        // 'edge' = Standard · 'omnivoice' = Premium
  language: "",          // empty = auto
  voiceId: "",           // OmniVoice voice id
  edgeVoice: "",         // Edge voice short_name
  speed: 1.0,
  emotion: "normal",
  outputFolder: "",      // Auto-save audio sau khi generate (Electron only). Empty = không tự lưu
};

export function loadTTSSettings() {
  try {
    const raw = userStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveTTSSettings(patch) {
  try {
    const current = loadTTSSettings();
    const next = { ...current, ...patch };
    userStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return loadTTSSettings();
  }
}

/** React hook: lấy & set settings, persist tự động. */
import { useState, useCallback, useEffect } from "react";

export function useTTSSettings() {
  const [s, setS] = useState(() => loadTTSSettings());
  const update = useCallback((patch) => {
    setS((prev) => {
      const next = { ...prev, ...patch };
      try { userStorage.setItem(KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  // Re-sync khi tab khác đổi (storage event)
  useEffect(() => {
    function onStorage(e) {
      if (e.key && e.key.includes("tts:settings")) {
        setS(loadTTSSettings());
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return [s, update];
}
