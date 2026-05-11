"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import {
  Loader2,
  LogOut,
  AlertTriangle,
  ArrowRight,
  LayoutDashboard,
  Wallet,
  Zap,
  Mic2,
  Wand2,
  Film,
  FileText,
  Repeat,
  Music2,
  PanelLeft,
  Bell,
  Sun,
  Moon,
  Sparkles,
  Search,
  Gift,
  Play,
  Clock,
  CheckCircle2,
  Loader,
  Settings as SettingsIcon,
  HelpCircle,
  Folder,
  Download,
  Upload,
  FileUp,
  Trash2,
  Save,
  PauseCircle,
  RotateCcw,
  ChevronRight,
  ChevronDown,
  CircleDot,
  ShieldCheck,
  Mail,
  Crown,
  X,
  Heart,
  Plus,
  Globe,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import {
  API_BASE,
  cloneVoice,
  deleteVoice,
  previewVoiceClone,
  createDubbingProject,
  updateDubbingSettings,
  updateSubtitleStyle,
  deleteDubbingProject,
  startDubbingAutoDub,
  getDubbingResourceUrl,
  downloadToProject,
  fetchCreditPacks,
  fetchDownloadInfo,
  generateCloudTts,
  generateTts,
  listEdgeVoices,
  listDubbingProjects,
  listJobs,
  listMyPayments,
  listPremiumVoices,
  listVoices,
  me,
  transcribeAudio,
  translateTexts,
  type CreditPack,
  type DownloadInfo,
  type DubbingListProject,
  type EdgeVoice,
  type Job,
  type Payment,
  type PremiumVoice,
  type Voice,
} from "@/lib/api";
import { ApiKeysManager } from "@/components/api-keys-manager";

type Tab =
  | "home"
  | "video-download"
  | "tts"
  | "subtitle"
  | "dubbing"
  | "projects"
  | "history"
  | "voice-models"
  | "saved-voices"
  | "settings"
  | "topup"
  | "support";

const NAV_SECTIONS: {
  title: string;
  items: { id: Tab; label: string; icon: typeof LayoutDashboard; badge?: string }[];
}[] = [
  {
    title: "TỔNG QUAN",
    items: [{ id: "home", label: "Trang chủ", icon: LayoutDashboard }],
  },
  {
    title: "CÔNG CỤ AI",
    items: [
      { id: "video-download", label: "Tải video", icon: Film },
      { id: "tts", label: "Văn bản thành giọng nói", icon: FileText },
      { id: "subtitle", label: "Chuyển đổi phụ đề", icon: Repeat },
      { id: "dubbing", label: "Lồng tiếng video", icon: Mic2 },
    ],
  },
  {
    title: "QUẢN LÝ",
    items: [
      { id: "projects", label: "Dự án của tôi", icon: Folder },
      { id: "history", label: "Lịch sử xử lý", icon: Clock },
      { id: "voice-models", label: "Mẫu giọng nói", icon: Music2 },
      { id: "saved-voices", label: "Nhân bản giọng nói", icon: Wand2 },
    ],
  },
  {
    title: "TÀI KHOẢN",
    items: [
      { id: "settings", label: "Cài đặt", icon: SettingsIcon },
      { id: "topup", label: "Nạp credits", icon: Wallet },
      { id: "support", label: "Hỗ trợ", icon: HelpCircle },
    ],
  },
];

function mediaUrl(url: string) {
  if (!url) return "";
  try {
    return new URL(url, `${API_BASE}/`).toString();
  } catch {
    return url;
  }
}

function subscribeClientMounted() {
  return () => undefined;
}

function useClientMounted() {
  return useSyncExternalStore(subscribeClientMounted, () => true, () => false);
}

// ── Language metadata: ISO 639-1 → flag + native + English name ─────────────
const LANGUAGE_META: Record<string, { flag: string; native: string; english: string }> = {
  vi: { flag: "🇻🇳", native: "Tiếng Việt", english: "Vietnamese" },
  en: { flag: "🇺🇸", native: "English", english: "English" },
  zh: { flag: "🇨🇳", native: "中文", english: "Chinese" },
  ja: { flag: "🇯🇵", native: "日本語", english: "Japanese" },
  ko: { flag: "🇰🇷", native: "한국어", english: "Korean" },
  fr: { flag: "🇫🇷", native: "Français", english: "French" },
  es: { flag: "🇪🇸", native: "Español", english: "Spanish" },
  de: { flag: "🇩🇪", native: "Deutsch", english: "German" },
  it: { flag: "🇮🇹", native: "Italiano", english: "Italian" },
  pt: { flag: "🇵🇹", native: "Português", english: "Portuguese" },
  ru: { flag: "🇷🇺", native: "Русский", english: "Russian" },
  pl: { flag: "🇵🇱", native: "Polski", english: "Polish" },
  nl: { flag: "🇳🇱", native: "Nederlands", english: "Dutch" },
  tr: { flag: "🇹🇷", native: "Türkçe", english: "Turkish" },
  ar: { flag: "🇸🇦", native: "العربية", english: "Arabic" },
  he: { flag: "🇮🇱", native: "עברית", english: "Hebrew" },
  hi: { flag: "🇮🇳", native: "हिन्दी", english: "Hindi" },
  bn: { flag: "🇧🇩", native: "বাংলা", english: "Bengali" },
  id: { flag: "🇮🇩", native: "Bahasa Indonesia", english: "Indonesian" },
  ms: { flag: "🇲🇾", native: "Bahasa Melayu", english: "Malay" },
  th: { flag: "🇹🇭", native: "ไทย", english: "Thai" },
  fil: { flag: "🇵🇭", native: "Filipino", english: "Filipino" },
  uk: { flag: "🇺🇦", native: "Українська", english: "Ukrainian" },
  cs: { flag: "🇨🇿", native: "Čeština", english: "Czech" },
  sk: { flag: "🇸🇰", native: "Slovenčina", english: "Slovak" },
  hu: { flag: "🇭🇺", native: "Magyar", english: "Hungarian" },
  ro: { flag: "🇷🇴", native: "Română", english: "Romanian" },
  bg: { flag: "🇧🇬", native: "Български", english: "Bulgarian" },
  el: { flag: "🇬🇷", native: "Ελληνικά", english: "Greek" },
  sv: { flag: "🇸🇪", native: "Svenska", english: "Swedish" },
  no: { flag: "🇳🇴", native: "Norsk", english: "Norwegian" },
  nb: { flag: "🇳🇴", native: "Norsk Bokmål", english: "Norwegian Bokmål" },
  da: { flag: "🇩🇰", native: "Dansk", english: "Danish" },
  fi: { flag: "🇫🇮", native: "Suomi", english: "Finnish" },
  fa: { flag: "🇮🇷", native: "فارسی", english: "Persian" },
  ur: { flag: "🇵🇰", native: "اردو", english: "Urdu" },
  ta: { flag: "🇮🇳", native: "தமிழ்", english: "Tamil" },
  te: { flag: "🇮🇳", native: "తెలుగు", english: "Telugu" },
  mr: { flag: "🇮🇳", native: "मराठी", english: "Marathi" },
  gu: { flag: "🇮🇳", native: "ગુજરાતી", english: "Gujarati" },
  kn: { flag: "🇮🇳", native: "ಕನ್ನಡ", english: "Kannada" },
  ml: { flag: "🇮🇳", native: "മലയാളം", english: "Malayalam" },
  pa: { flag: "🇮🇳", native: "ਪੰਜਾਬੀ", english: "Punjabi" },
  my: { flag: "🇲🇲", native: "မြန်မာ", english: "Burmese" },
  km: { flag: "🇰🇭", native: "ខ្មែរ", english: "Khmer" },
  lo: { flag: "🇱🇦", native: "ລາວ", english: "Lao" },
  ne: { flag: "🇳🇵", native: "नेपाली", english: "Nepali" },
  si: { flag: "🇱🇰", native: "සිංහල", english: "Sinhala" },
  ka: { flag: "🇬🇪", native: "ქართული", english: "Georgian" },
  am: { flag: "🇪🇹", native: "አማርኛ", english: "Amharic" },
  sw: { flag: "🇰🇪", native: "Kiswahili", english: "Swahili" },
  zu: { flag: "🇿🇦", native: "isiZulu", english: "Zulu" },
  af: { flag: "🇿🇦", native: "Afrikaans", english: "Afrikaans" },
  ca: { flag: "🇪🇸", native: "Català", english: "Catalan" },
  hr: { flag: "🇭🇷", native: "Hrvatski", english: "Croatian" },
  sr: { flag: "🇷🇸", native: "Српски", english: "Serbian" },
  sl: { flag: "🇸🇮", native: "Slovenščina", english: "Slovenian" },
  lt: { flag: "🇱🇹", native: "Lietuvių", english: "Lithuanian" },
  lv: { flag: "🇱🇻", native: "Latviešu", english: "Latvian" },
  et: { flag: "🇪🇪", native: "Eesti", english: "Estonian" },
  is: { flag: "🇮🇸", native: "Íslenska", english: "Icelandic" },
  ga: { flag: "🇮🇪", native: "Gaeilge", english: "Irish" },
  cy: { flag: "🇬🇧", native: "Cymraeg", english: "Welsh" },
  mt: { flag: "🇲🇹", native: "Malti", english: "Maltese" },
  sq: { flag: "🇦🇱", native: "Shqip", english: "Albanian" },
  mk: { flag: "🇲🇰", native: "Македонски", english: "Macedonian" },
  bs: { flag: "🇧🇦", native: "Bosanski", english: "Bosnian" },
  az: { flag: "🇦🇿", native: "Azərbaycan", english: "Azerbaijani" },
  uz: { flag: "🇺🇿", native: "Oʻzbek", english: "Uzbek" },
  kk: { flag: "🇰🇿", native: "Қазақ", english: "Kazakh" },
  mn: { flag: "🇲🇳", native: "Монгол", english: "Mongolian" },
  jw: { flag: "🇮🇩", native: "Basa Jawa", english: "Javanese" },
  su: { flag: "🇮🇩", native: "Basa Sunda", english: "Sundanese" },
  ps: { flag: "🇦🇫", native: "پښتو", english: "Pashto" },
  so: { flag: "🇸🇴", native: "Soomaali", english: "Somali" },
  yo: { flag: "🇳🇬", native: "Yorùbá", english: "Yoruba" },
  ig: { flag: "🇳🇬", native: "Igbo", english: "Igbo" },
  ha: { flag: "🇳🇬", native: "Hausa", english: "Hausa" },
  ff: { flag: "🇸🇳", native: "Fulfulde", english: "Fulah" },
  wo: { flag: "🇸🇳", native: "Wolof", english: "Wolof" },
  rw: { flag: "🇷🇼", native: "Kinyarwanda", english: "Kinyarwanda" },
  sn: { flag: "🇿🇼", native: "ChiShona", english: "Shona" },
  xh: { flag: "🇿🇦", native: "isiXhosa", english: "Xhosa" },
  st: { flag: "🇱🇸", native: "Sesotho", english: "Sotho" },
  mg: { flag: "🇲🇬", native: "Malagasy", english: "Malagasy" },
  ny: { flag: "🇲🇼", native: "Chichewa", english: "Chichewa" },
  ny2: { flag: "🇲🇼", native: "Chinyanja", english: "Nyanja" },
  ti: { flag: "🇪🇷", native: "ትግርኛ", english: "Tigrinya" },
  om: { flag: "🇪🇹", native: "Afaan Oromoo", english: "Oromo" },
  lg: { flag: "🇺🇬", native: "Luganda", english: "Ganda" },
  ku: { flag: "🇮🇶", native: "Kurdî", english: "Kurdish" },
  sd: { flag: "🇵🇰", native: "سنڌي", english: "Sindhi" },
  bo: { flag: "🇨🇳", native: "བོད་ཡིག", english: "Tibetan" },
  ug: { flag: "🇨🇳", native: "ئۇيغۇرچە", english: "Uyghur" },
  dz: { flag: "🇧🇹", native: "རྫོང་ཁ", english: "Dzongkha" },
  ky: { flag: "🇰🇬", native: "Кыргызча", english: "Kyrgyz" },
  tg: { flag: "🇹🇯", native: "Тоҷикӣ", english: "Tajik" },
  tk: { flag: "🇹🇲", native: "Türkmen", english: "Turkmen" },
  hy: { flag: "🇦🇲", native: "Հայերեն", english: "Armenian" },
  be: { flag: "🇧🇾", native: "Беларуская", english: "Belarusian" },
  lb: { flag: "🇱🇺", native: "Lëtzebuergesch", english: "Luxembourgish" },
  fo: { flag: "🇫🇴", native: "Føroyskt", english: "Faroese" },
  gd: { flag: "🇬🇧", native: "Gàidhlig", english: "Scottish Gaelic" },
  br: { flag: "🇫🇷", native: "Brezhoneg", english: "Breton" },
  oc: { flag: "🇫🇷", native: "Occitan", english: "Occitan" },
  co: { flag: "🇫🇷", native: "Corsu", english: "Corsican" },
  eu: { flag: "🇪🇸", native: "Euskara", english: "Basque" },
  gl: { flag: "🇪🇸", native: "Galego", english: "Galician" },
  ast: { flag: "🇪🇸", native: "Asturianu", english: "Asturian" },
  an: { flag: "🇪🇸", native: "Aragonés", english: "Aragonese" },
  fy: { flag: "🇳🇱", native: "Frysk", english: "Frisian" },
  rm: { flag: "🇨🇭", native: "Rumantsch", english: "Romansh" },
  yi: { flag: "🇮🇱", native: "ייִדיש", english: "Yiddish" },
  haw: { flag: "🇺🇸", native: "ʻŌlelo Hawaiʻi", english: "Hawaiian" },
  mi: { flag: "🇳🇿", native: "Te Reo Māori", english: "Maori" },
  sm: { flag: "🇼🇸", native: "Gagana Sāmoa", english: "Samoan" },
  to: { flag: "🇹🇴", native: "Lea Faka-Tonga", english: "Tongan" },
  fj: { flag: "🇫🇯", native: "Vosa Vakaviti", english: "Fijian" },
  ceb: { flag: "🇵🇭", native: "Cebuano", english: "Cebuano" },
  hil: { flag: "🇵🇭", native: "Hiligaynon", english: "Hiligaynon" },
  ilo: { flag: "🇵🇭", native: "Ilokano", english: "Ilocano" },
  pam: { flag: "🇵🇭", native: "Kapampangan", english: "Kapampangan" },
  war: { flag: "🇵🇭", native: "Winaray", english: "Waray" },
  bcl: { flag: "🇵🇭", native: "Bikol", english: "Bikol" },
  tt: { flag: "🇷🇺", native: "Татарча", english: "Tatar" },
  ba: { flag: "🇷🇺", native: "Башҡортса", english: "Bashkir" },
  cv: { flag: "🇷🇺", native: "Чӑвашла", english: "Chuvash" },
  ce: { flag: "🇷🇺", native: "Нохчийн", english: "Chechen" },
  os: { flag: "🇷🇺", native: "Ирон", english: "Ossetian" },
  sah: { flag: "🇷🇺", native: "Саха тыла", english: "Yakut" },
  bug: { flag: "🇮🇩", native: "Basa Ugi", english: "Buginese" },
  min: { flag: "🇮🇩", native: "Baso Minang", english: "Minangkabau" },
  ban: { flag: "🇮🇩", native: "Basa Bali", english: "Balinese" },
  ace: { flag: "🇮🇩", native: "Acèh", english: "Acehnese" },
  shn: { flag: "🇲🇲", native: "လိၵ်ႈတႆး", english: "Shan" },
  as: { flag: "🇮🇳", native: "অসমীয়া", english: "Assamese" },
  or: { flag: "🇮🇳", native: "ଓଡ଼ିଆ", english: "Odia" },
  sa: { flag: "🇮🇳", native: "संस्कृतम्", english: "Sanskrit" },
  bho: { flag: "🇮🇳", native: "भोजपुरी", english: "Bhojpuri" },
  mai: { flag: "🇮🇳", native: "मैथिली", english: "Maithili" },
  mni: { flag: "🇮🇳", native: "ꯃꯩꯇꯩꯂꯣꯟ", english: "Manipuri" },
  doi: { flag: "🇮🇳", native: "डोगरी", english: "Dogri" },
  ks: { flag: "🇮🇳", native: "کٲشُر", english: "Kashmiri" },
  sat: { flag: "🇮🇳", native: "ᱥᱟᱱᱛᱟᱲᱤ", english: "Santali" },
  kok: { flag: "🇮🇳", native: "कोंकणी", english: "Konkani" },
  dv: { flag: "🇲🇻", native: "ދިވެހި", english: "Dhivehi" },
  ckb: { flag: "🇮🇶", native: "کوردیی ناوەندی", english: "Central Kurdish" },
  arz: { flag: "🇪🇬", native: "مصرى", english: "Egyptian Arabic" },
  apc: { flag: "🇸🇾", native: "شامي", english: "Levantine Arabic" },
  acm: { flag: "🇮🇶", native: "عراقي", english: "Iraqi Arabic" },
  ary: { flag: "🇲🇦", native: "الدارجة", english: "Moroccan Arabic" },
  arq: { flag: "🇩🇿", native: "دزيرية", english: "Algerian Arabic" },
  aeb: { flag: "🇹🇳", native: "تونسي", english: "Tunisian Arabic" },
  ber: { flag: "🇲🇦", native: "ⵜⴰⵎⴰⵣⵉⵖⵜ", english: "Berber" },
  yue: { flag: "🇭🇰", native: "粵語", english: "Cantonese" },
  hak: { flag: "🇨🇳", native: "客家話", english: "Hakka" },
  nan: { flag: "🇹🇼", native: "閩南語", english: "Min Nan" },
  wuu: { flag: "🇨🇳", native: "吴语", english: "Wu Chinese" },
  zh_tw: { flag: "🇹🇼", native: "繁體中文", english: "Traditional Chinese" },
  pt_br: { flag: "🇧🇷", native: "Português (Brasil)", english: "Portuguese (Brazil)" },
  es_mx: { flag: "🇲🇽", native: "Español (México)", english: "Spanish (Mexico)" },
  en_gb: { flag: "🇬🇧", native: "English (UK)", english: "English (United Kingdom)" },
  en_au: { flag: "🇦🇺", native: "English (AU)", english: "English (Australia)" },
  en_in: { flag: "🇮🇳", native: "English (IN)", english: "English (India)" },
  fr_ca: { flag: "🇨🇦", native: "Français (Canada)", english: "French (Canada)" },
  ln: { flag: "🇨🇩", native: "Lingála", english: "Lingala" },
  lua: { flag: "🇨🇩", native: "Tshiluba", english: "Luba-Lulua" },
  kg: { flag: "🇨🇩", native: "Kikongo", english: "Kongo" },
  ee: { flag: "🇬🇭", native: "Eʋegbe", english: "Ewe" },
  tw: { flag: "🇬🇭", native: "Twi", english: "Twi" },
  ak: { flag: "🇬🇭", native: "Akan", english: "Akan" },
  bm: { flag: "🇲🇱", native: "Bamanankan", english: "Bambara" },
  dyu: { flag: "🇧🇫", native: "Julakan", english: "Dyula" },
  kab: { flag: "🇩🇿", native: "Taqbaylit", english: "Kabyle" },
  iu: { flag: "🇨🇦", native: "ᐃᓄᒃᑎᑐᑦ", english: "Inuktitut" },
  cr: { flag: "🇨🇦", native: "ᓀᐦᐃᔭᐍᐏᐣ", english: "Cree" },
  oj: { flag: "🇨🇦", native: "ᐊᓂᔑᓈᐯᒧᐎᓐ", english: "Ojibwe" },
  qu: { flag: "🇵🇪", native: "Runasimi", english: "Quechua" },
  ay: { flag: "🇧🇴", native: "Aymar aru", english: "Aymara" },
  gn: { flag: "🇵🇾", native: "Avañe'ẽ", english: "Guarani" },
  nah: { flag: "🇲🇽", native: "Nāhuatl", english: "Nahuatl" },
  yua: { flag: "🇲🇽", native: "Maya'tʼaan", english: "Yucatec Maya" },
  fur: { flag: "🇮🇹", native: "Furlan", english: "Friulian" },
  scn: { flag: "🇮🇹", native: "Sicilianu", english: "Sicilian" },
  vec: { flag: "🇮🇹", native: "Vèneto", english: "Venetian" },
  lmo: { flag: "🇮🇹", native: "Lombard", english: "Lombard" },
  nap: { flag: "🇮🇹", native: "Napulitano", english: "Neapolitan" },
};

// Vox Premium hỗ trợ 600+ ngôn ngữ — list dưới đây là các ngôn ngữ phổ biến
// hiển thị trong dropdown. Engine vẫn nhận code khác nếu user gõ trực tiếp.
const PREMIUM_LANGUAGES = Object.keys(LANGUAGE_META);
const PREMIUM_LANGUAGES_TOTAL = 600;

// Reverse lookup: "vietnamese" → "vi", "english" → "en", v.v.
const LANGUAGE_NAME_TO_CODE: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [code, meta] of Object.entries(LANGUAGE_META)) {
    map[meta.english.toLowerCase()] = code;
    map[meta.native.toLowerCase()] = code;
  }
  // Aliases phổ biến
  map["tiếng việt"] = "vi";
  map["viet"] = "vi";
  map["vietnam"] = "vi";
  map["vietnamese"] = "vi";
  map["chinese"] = "zh";
  map["mandarin"] = "zh";
  return map;
})();

function resolveLangCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  if (LANGUAGE_META[raw]) return raw;
  // Split bằng -, _, , hoặc khoảng trắng → thử token đầu
  const first = raw.split(/[-_,/]/)[0]?.trim();
  if (first && LANGUAGE_META[first]) return first;
  // Khớp theo tên ngôn ngữ
  if (LANGUAGE_NAME_TO_CODE[raw]) return LANGUAGE_NAME_TO_CODE[raw];
  if (first && LANGUAGE_NAME_TO_CODE[first]) return LANGUAGE_NAME_TO_CODE[first];
  return null;
}

function flagFor(input: string | null | undefined): string {
  const code = resolveLangCode(input);
  return (code && LANGUAGE_META[code]?.flag) || "🌐";
}

function languageOptionsFromVoices(voices: { locale: string }[]): string[] {
  const codes = new Set<string>();
  for (const v of voices) {
    const prefix = (v.locale || "").split("-")[0]?.toLowerCase();
    if (prefix && LANGUAGE_META[prefix]) codes.add(prefix);
  }
  return Array.from(codes);
}

function formatSrtTime(seconds: number) {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.floor((total - Math.floor(total)) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

// ── Subtitle layout constants (theo chuẩn Netflix/BBC, điều chỉnh cho Việt) ──
const SUB_MAX_CHARS_PER_LINE = 42;
const SUB_MAX_CHARS_PER_CUE = SUB_MAX_CHARS_PER_LINE * 2; // 84
const SUB_MIN_CHARS_PER_CUE = 12; // tránh chunk siêu ngắn (1-2 từ)
const SUB_MIN_CUE_DURATION = 1.0;
const SUB_MAX_CUE_DURATION = 6.0;
const SUB_READING_CPS = 17;
const SUB_CUE_GAP = 0.08;
const SUB_VI_CONJUNCTIONS = /\s+(?:nhưng mà|tuy nhiên|tuy vậy|do đó|vì vậy|cho nên|nhưng|hoặc|và|vì|nên|hay|mà)\s+/iu;
const SUB_BREAK_TOKEN = /<break\s+time=["']?(\d+(?:\.\d+)?)s?["']?\s*\/?>/g;

type SubtitleSegment = { id: number; start: number; end: number; text: string; charCount: number };

function splitByPunctuation(text: string): string[] {
  const parts: string[] = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") {
      const trimmed = buf.trim();
      if (trimmed) parts.push(trimmed);
      buf = "";
      continue;
    }
    buf += ch;
    if (/[.!?]/.test(ch)) {
      const next = text[i + 1];
      if (!next || /\s/.test(next)) {
        const trimmed = buf.trim();
        if (trimmed) parts.push(trimmed);
        buf = "";
      }
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function splitLongSegment(input: string): string[] {
  const s = input.trim();
  if (s.length <= SUB_MAX_CHARS_PER_CUE) return s ? [s] : [];

  const half = s.length / 2;

  // Ưu tiên 1: tách tại dấu phẩy/chấm phẩy/hai chấm gần giữa câu
  // CHỈ split nếu cả 2 vế đều ≥ MIN_CHARS_PER_CUE (tránh orphan 1-2 từ)
  const punctIdxs: number[] = [];
  const re = /[,;:]\s/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) punctIdxs.push(m.index + 1);
  punctIdxs.sort((a, b) => Math.abs(a - half) - Math.abs(b - half));
  for (const idx of punctIdxs) {
    const left = s.slice(0, idx).trim();
    const right = s.slice(idx).trim();
    if (
      left.length >= SUB_MIN_CHARS_PER_CUE &&
      right.length >= SUB_MIN_CHARS_PER_CUE &&
      left.length < s.length &&
      right.length < s.length
    ) {
      return [...splitLongSegment(left), ...splitLongSegment(right)];
    }
  }

  // Ưu tiên 2: tách tại liên từ tiếng Việt — cũng check min length
  const conjMatch = s.match(SUB_VI_CONJUNCTIONS);
  if (conjMatch && conjMatch.index !== undefined) {
    const idx = conjMatch.index + 1;
    const left = s.slice(0, idx).trim();
    const right = s.slice(idx).trim();
    if (
      left.length >= SUB_MIN_CHARS_PER_CUE &&
      right.length >= SUB_MIN_CHARS_PER_CUE
    ) {
      return [...splitLongSegment(left), ...splitLongSegment(right)];
    }
  }

  // Cuối cùng: tách cứng tại space gần MAX. Nếu phần còn lại quá ngắn,
  // lùi cutoff về phía sau để hai vế cân hơn.
  let cutAt = s.lastIndexOf(" ", SUB_MAX_CHARS_PER_CUE);
  if (cutAt <= 0) cutAt = SUB_MAX_CHARS_PER_CUE;
  let left = s.slice(0, cutAt).trim();
  let right = s.slice(cutAt).trim();
  // Tail < MIN → lùi cut về phía trước để tail có >= MIN
  if (right.length < SUB_MIN_CHARS_PER_CUE && cutAt > SUB_MIN_CHARS_PER_CUE) {
    const targetTail = SUB_MIN_CHARS_PER_CUE + 4;
    const newCutAt = s.lastIndexOf(" ", s.length - targetTail);
    if (newCutAt >= SUB_MIN_CHARS_PER_CUE) {
      left = s.slice(0, newCutAt).trim();
      right = s.slice(newCutAt).trim();
    }
  }
  if (!left) return [s];
  return [left, ...splitLongSegment(right)];
}

// Sau split, gộp các segment quá ngắn (mồ côi 1-2 từ) với segment kế bên
function mergeShortSegments(segments: string[]): string[] {
  if (segments.length <= 1) return segments;
  const result: string[] = [];
  for (const seg of segments) {
    if (result.length === 0) {
      result.push(seg);
      continue;
    }
    const prev = result[result.length - 1];
    const merged = `${prev} ${seg}`;
    // Seg hiện tại quá ngắn → merge vào prev nếu fit
    if (seg.length < SUB_MIN_CHARS_PER_CUE && merged.length <= SUB_MAX_CHARS_PER_CUE) {
      result[result.length - 1] = merged;
      continue;
    }
    // Prev quá ngắn → merge ngược seg vào prev nếu fit
    if (prev.length < SUB_MIN_CHARS_PER_CUE && merged.length <= SUB_MAX_CHARS_PER_CUE) {
      result[result.length - 1] = merged;
      continue;
    }
    result.push(seg);
  }
  return result;
}

function smartSegment(text: string): string[] {
  const out: string[] = [];
  for (const sentence of splitByPunctuation(text)) {
    out.push(...splitLongSegment(sentence));
  }
  return mergeShortSegments(out.filter((s) => s.length > 0));
}

function extractBreakChunks(text: string): { chunks: string[]; gaps: number[] } {
  const chunks: string[] = [];
  const gaps: number[] = [];
  SUB_BREAK_TOKEN.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = SUB_BREAK_TOKEN.exec(text)) !== null) {
    chunks.push(text.slice(last, m.index));
    gaps.push(parseFloat(m[1]) || 0);
    last = m.index + m[0].length;
  }
  chunks.push(text.slice(last));
  return { chunks: chunks.map((c) => c.trim()), gaps };
}

function computeTimings(segments: string[], audioDuration: number, baseStart: number, idStart: number): SubtitleSegment[] {
  if (segments.length === 0 || audioDuration <= 0) return [];
  if (segments.length === 1) {
    return [{
      id: idStart,
      start: baseStart,
      end: baseStart + audioDuration,
      text: segments[0],
      charCount: segments[0].length,
    }];
  }

  const totalChars = segments.reduce((sum, s) => sum + s.length, 0) || 1;
  const gapBudget = SUB_CUE_GAP * (segments.length - 1);
  const speakingTime = Math.max(0, audioDuration - gapBudget);

  // Bước 1: phân bổ proportional theo ký tự
  const raw = segments.map((s) => (s.length / totalChars) * speakingTime);

  // Bước 2: áp constraint min/max + reading-time floor
  const desired = segments.map((s, i) => {
    const reading = s.length / SUB_READING_CPS;
    const floor = Math.max(SUB_MIN_CUE_DURATION, reading);
    return Math.max(floor, Math.min(SUB_MAX_CUE_DURATION, Math.max(raw[i], reading)));
  });

  // Bước 3: scale lại để tổng = speakingTime (giữ nguyên audio sync)
  const desiredSum = desired.reduce((a, b) => a + b, 0);
  const scale = desiredSum > 0 ? speakingTime / desiredSum : 1;
  const finalDur = desired.map((d) => d * scale);

  // Bước 4: build start/end với gap giữa các cue
  const result: SubtitleSegment[] = [];
  let cursor = baseStart;
  segments.forEach((textSeg, i) => {
    const isLast = i === segments.length - 1;
    const start = cursor;
    const end = isLast ? baseStart + audioDuration : start + finalDur[i];
    cursor = end + (isLast ? 0 : SUB_CUE_GAP);
    result.push({ id: idStart + i, start, end, text: textSeg, charCount: textSeg.length });
  });
  return result;
}

function buildSubtitleSegments(text: string, totalDuration: number): SubtitleSegment[] {
  const { chunks, gaps } = extractBreakChunks(text);
  if (chunks.every((c) => !c)) return [];

  const explicitGapTotal = gaps.reduce((a, b) => a + b, 0);
  const speakingDuration = Math.max(0, totalDuration - explicitGapTotal);

  if (chunks.length === 1) {
    return computeTimings(smartSegment(chunks[0]), speakingDuration, 0, 1);
  }

  const chunkChars = chunks.map((c) => c.length);
  const totalChunkChars = chunkChars.reduce((a, b) => a + b, 0) || 1;

  const result: SubtitleSegment[] = [];
  let cursor = 0;
  let nextId = 1;
  chunks.forEach((chunk, i) => {
    if (chunk) {
      const chunkDur = (chunkChars[i] / totalChunkChars) * speakingDuration;
      const segs = computeTimings(smartSegment(chunk), chunkDur, cursor, nextId);
      result.push(...segs);
      nextId += segs.length;
      cursor += chunkDur;
    }
    if (i < chunks.length - 1) cursor += gaps[i] || 0;
  });
  return result;
}

function wrapForSrt(text: string): string {
  if (text.length <= SUB_MAX_CHARS_PER_LINE) return text;
  const half = text.length / 2;

  // Ưu tiên break ở dấu phẩy gần giữa
  const commaIdxs: number[] = [];
  for (let i = 0; i < text.length; i++) if (/[,;:]/.test(text[i])) commaIdxs.push(i + 1);
  commaIdxs.sort((a, b) => Math.abs(a - half) - Math.abs(b - half));
  for (const pos of commaIdxs) {
    const l1 = text.slice(0, pos).trim();
    const l2 = text.slice(pos).trim();
    if (l1 && l2 && l1.length <= SUB_MAX_CHARS_PER_LINE && l2.length <= SUB_MAX_CHARS_PER_LINE) {
      return `${l1}\n${l2}`;
    }
  }

  // Fallback: break ở khoảng trắng gần giữa
  const spaceIdxs: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] === " ") spaceIdxs.push(i);
  spaceIdxs.sort((a, b) => Math.abs(a - half) - Math.abs(b - half));
  for (const pos of spaceIdxs) {
    const l1 = text.slice(0, pos).trim();
    const l2 = text.slice(pos + 1).trim();
    if (l1 && l2 && l1.length <= SUB_MAX_CHARS_PER_LINE && l2.length <= SUB_MAX_CHARS_PER_LINE) {
      return `${l1}\n${l2}`;
    }
  }
  return text;
}

function buildSrt(segments: SubtitleSegment[]) {
  return segments
    .flatMap((seg) => [
      String(seg.id),
      `${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}`,
      wrapForSrt(seg.text),
      "",
    ])
    .join("\n");
}

type SubtitleMeta = { engine: string; voice: string; sampleRate: number; language: string };

function buildSubtitleJson(segments: SubtitleSegment[], totalDuration: number, meta: SubtitleMeta) {
  return JSON.stringify(
    {
      version: "1.0",
      generator: "VoxStudio",
      created_at: new Date().toISOString(),
      duration: Number(totalDuration.toFixed(3)),
      engine: meta.engine,
      voice: meta.voice,
      sample_rate: meta.sampleRate,
      language: meta.language,
      total_chars: segments.reduce((sum, s) => sum + s.charCount, 0),
      segments: segments.map((s) => ({
        id: s.id,
        start: Number(s.start.toFixed(3)),
        end: Number(s.end.toFixed(3)),
        duration: Number((s.end - s.start).toFixed(3)),
        text: s.text,
        char_count: s.charCount,
      })),
    },
    null,
    2,
  );
}

function downloadSubtitleFile(
  text: string,
  duration: number,
  format: "srt" | "json",
  meta: SubtitleMeta,
) {
  const segments = buildSubtitleSegments(text, duration);
  const content = format === "srt" ? buildSrt(segments) : buildSubtitleJson(segments, duration, meta);
  const mime = format === "json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8";
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `voxstudio-${Date.now()}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const TTS_HISTORY_KEY = "voxstudio:tts:history";
const TTS_HISTORY_LIMIT = 30;

type TtsHistoryItem = {
  id: string;
  text: string;
  engine: "premium" | "cloud";
  language: string;
  voiceKey: string;
  voiceLabel: string;
  createdAt: string;
  status: "processing" | "done" | "failed";
  credits: number;
  charCount: number;
  audioUrl?: string;
  duration?: number;
  sampleRate?: number;
  error?: string;
  subtitleFormat?: "srt" | "json";
};

function createHistoryId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function estimateTtsCredits(value: string) {
  return Math.max(1, Math.ceil(value.length / 20));
}

function loadTtsHistory(): TtsHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TTS_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<TtsHistoryItem>[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Partial<TtsHistoryItem> & { id: string; text: string } => typeof item?.id === "string" && typeof item?.text === "string")
      .map<TtsHistoryItem>((item) => ({
        id: item.id,
        text: item.text,
        engine: item.engine === "cloud" ? "cloud" : "premium",
        language: typeof item.language === "string" ? item.language : "vi",
        voiceKey: typeof item.voiceKey === "string" ? item.voiceKey : "",
        voiceLabel: typeof item.voiceLabel === "string" ? item.voiceLabel : "Giọng mặc định",
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        status: item.status === "failed" ? "failed" : "done",
        credits: typeof item.credits === "number" ? item.credits : estimateTtsCredits(item.text),
        charCount: typeof item.charCount === "number" ? item.charCount : item.text.length,
        audioUrl: typeof item.audioUrl === "string" ? item.audioUrl : undefined,
        duration: typeof item.duration === "number" ? item.duration : undefined,
        sampleRate: typeof item.sampleRate === "number" ? item.sampleRate : undefined,
        error: typeof item.error === "string" ? item.error : undefined,
      }))
      .slice(0, TTS_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function saveTtsHistory(items: TtsHistoryItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TTS_HISTORY_KEY, JSON.stringify(items.slice(0, TTS_HISTORY_LIMIT)));
  } catch {}
}

function formatHistoryTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return `${date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} ${date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}`;
}

export default function AccountPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("tts");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem("voxstudio:theme") as "dark" | "light" | null) || "dark";
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("voxstudio:theme", theme);
  }, [theme]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/sign-in?next=/account");
      return;
    }
    listMyPayments()
      .then((r) => setPayments(r.payments || []))
      .catch(() => setPayments([]));
  }, [user, authLoading, router]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const planName = user.plan.charAt(0).toUpperCase() + user.plan.slice(1);
  const isPaid = user.plan !== "free";
  const initial = (user.name || user.email)[0].toUpperCase();
  const displayName = user.name || user.email.split("@")[0];
  const credits = user.credit_balance || 0;

  return (
    <div
      key={`user-${user.id}`}
      className="theme-black flex min-h-screen bg-background text-foreground"
    >
      {/* key={user.id} → khi đổi user, React unmount toàn bộ children + remount
         fresh. Tránh leak state (projects, voice settings, ...) giữa accounts. */}
      {/* SIDEBAR */}
      {sidebarOpen && (
        <aside className="hidden w-[270px] shrink-0 border-r border-border/60 bg-card/60 lg:flex lg:flex-col">
          <div className="flex h-14 items-center gap-2 border-b border-border/60 px-4">
            <Link href="/" className="inline-flex items-center gap-2">
              <Image src="/logo.png" alt="VoxStudio" width={24} height={24} className="h-6 w-6 rounded" />
              <span className="text-sm font-bold tracking-tight">VoxStudio</span>
            </Link>
          </div>

          {/* User card */}
          <div className="m-3 flex items-center gap-2.5 rounded-xl border border-border/60 bg-background/40 px-3 py-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-foreground text-xs font-bold text-background">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{displayName}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                Gói {planName}
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
            {NAV_SECTIONS.map((section) => (
              <div key={section.title}>
                <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70">
                  {section.title}
                </div>
                <div className="flex flex-col gap-0.5">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        data-account-tab-desktop={item.id}
                        onClick={() => setActiveTab(item.id)}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                          isActive
                            ? "border border-primary/20 bg-primary/10 text-primary"
                            : "border border-transparent text-foreground/75 hover:bg-muted/50 hover:text-foreground"
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 text-left">{item.label}</span>
                        {item.badge && (
                          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary">
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Bottom credits chip */}
          <div className="m-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-3">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <Zap className="h-3 w-3 text-emerald-500" />
                <span className="font-bold">Credits</span>
              </div>
              <span className="font-mono font-bold text-emerald-500">
                {credits.toLocaleString("vi-VN")}
              </span>
            </div>
            <button
              onClick={() => setActiveTab("topup")}
              className="mt-2 w-full rounded-md bg-emerald-500/10 py-1 text-[10px] font-semibold text-emerald-500 hover:bg-emerald-500/20"
            >
              Nạp thêm
            </button>
          </div>
        </aside>
      )}

      {/* MAIN */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* TOP BAR */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-background/90 px-4 backdrop-blur-sm sm:px-6">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="hidden h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground lg:flex"
          >
            <PanelLeft className="h-4 w-4" />
          </button>

          <Link href="/" className="inline-flex items-center gap-2 lg:hidden">
            <Image src="/logo.png" alt="VoxStudio" width={24} height={24} className="h-6 w-6 rounded" />
            <span className="text-sm font-black tracking-tight">VoxStudio</span>
          </Link>

          <div className="relative hidden flex-1 max-w-md sm:block">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Tìm công cụ, dự án..."
              className="w-full rounded-lg border border-border/60 bg-card/50 py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground/60 focus:border-primary/40 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <IconButton icon={Gift} label="Nạp credits" onClick={() => setActiveTab("topup")} />
            <IconButton icon={Bell} label="Lịch sử xử lý" onClick={() => setActiveTab("history")} />
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              aria-label="Đổi giao diện"
            >
              {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
            <Link
              href="/pricing"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-bold text-emerald-500"
            >
              <Zap className="h-3 w-3" />
              {credits} credits
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-md shadow-primary/30 hover:scale-105 transition-transform"
            >
              {isPaid ? "Quản lý gói" : "Nâng cấp gói"}
            </Link>
            <button
              onClick={() => {
                logout();
                router.replace("/");
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        <div className="border-b border-border/60 bg-background/95 px-3 py-2 lg:hidden">
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV_SECTIONS.flatMap((section) => section.items).map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  data-account-tab={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-bold ${
                    isActive
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border/60 bg-card/50 text-muted-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* CONTENT — render theo activeTab */}
        <main className="flex-1 p-4 sm:p-6">
          {!user.email_verified && (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/[0.05] p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-yellow-500" />
              <div className="flex-1 text-sm">
                Email chưa xác thực — bạn cần xác thực để mua gói.{" "}
                <Link href="/verify" className="font-semibold text-primary hover:underline">
                  Xác thực ngay
                </Link>
              </div>
            </div>
          )}

          {activeTab === "home" && (
            <HomeTab user={user} setActiveTab={setActiveTab} />
          )}
          {activeTab === "video-download" && <VideoDownloadTab />}
          {activeTab === "tts" && <TtsTab setActiveTab={setActiveTab} />}
          {activeTab === "subtitle" && <SubtitleTab />}
          {activeTab === "dubbing" && <DubbingTab setActiveTab={setActiveTab} />}
          {activeTab === "projects" && <ProjectsTab />}
          {activeTab === "history" && <HistoryTab payments={payments} />}
          {activeTab === "voice-models" && <VoiceModelsTab />}
          {activeTab === "saved-voices" && <SavedVoicesTab setActiveTab={setActiveTab} />}
          {activeTab === "settings" && <SettingsTab user={user} theme={theme} setTheme={setTheme} />}
          {activeTab === "topup" && <TopupTab />}
          {activeTab === "support" && <SupportTab />}
        </main>
      </div>
    </div>
  );
}

// ── PAGE TITLE — used at top of each tab ──────────────────────────────
function PageTitle({ icon: Icon, title, desc }: { icon: React.ComponentType<{ className?: string }>; title: string; desc: string }) {
  return (
    <div className="mb-6 flex items-start gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/5">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

// ── HOME TAB ───────────────────────────────────────────────────────────
function HomeTab({
  user,
  setActiveTab,
}: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  setActiveTab: (t: Tab) => void;
}) {
  const displayName = user.name || user.email.split("@")[0];
  const [usage, setUsage] = useState<{
    dubbing_min: number;
    stt_min: number;
    tts_chars: number;
    translate_tokens: number;
    clone_min: number;
  } | null>(null);
  const [projects, setProjects] = useState<DubbingListProject[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    void Promise.allSettled([me(), listDubbingProjects(5), listJobs(5)]).then(([account, projectResult, jobResult]) => {
      if (account.status === "fulfilled") setUsage(account.value.usage_month);
      setProjects(projectResult.status === "fulfilled" ? projectResult.value.projects || [] : []);
      setJobs(jobResult.status === "fulfilled" ? jobResult.value.jobs || [] : []);
    });
  }, []);

  const planName = user.plan.charAt(0).toUpperCase() + user.plan.slice(1);
  const credits = user.credit_balance || 0;
  const latestActivity = jobs[0] || null;

  return (
    <div className="space-y-5">
      <div className="grid overflow-hidden rounded-2xl border border-border/60 bg-card/40 shadow-sm lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="border-b border-border/60 p-6 lg:border-b-0 lg:border-r">
          <div className="mb-5 inline-flex rounded-xl border border-border/60 bg-background/45 p-1 text-xs font-semibold">
            <button className="rounded-lg bg-foreground px-5 py-2 text-background">Tổng quan</button>
            <button onClick={() => setActiveTab("settings")} className="rounded-lg px-5 py-2 text-muted-foreground hover:text-foreground">Hồ sơ</button>
            <button onClick={() => setActiveTab("topup")} className="rounded-lg px-5 py-2 text-muted-foreground hover:text-foreground">Ví credits</button>
          </div>

          <div className="flex flex-col gap-5 rounded-2xl border border-border/50 bg-background/45 p-5 sm:flex-row sm:items-center">
            <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full border border-border/60 bg-foreground text-2xl font-black text-background">
              {(user.name || user.email)[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-3xl font-black tracking-tight">{displayName}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
                <span className="rounded-full border border-border/60 bg-card/60 px-3 py-1">{user.email}</span>
                <span className="rounded-full border border-border/60 bg-card/60 px-3 py-1">Gói {planName}</span>
                <span className="rounded-full border border-border/60 bg-card/60 px-3 py-1">{user.email_verified ? "Đã xác thực" : "Chưa xác thực"}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:w-80">
              <div className="rounded-xl border border-border/60 bg-card/70 p-4">
                <div className="text-[11px] font-bold uppercase text-muted-foreground">Credits</div>
                <div className="mt-2 text-3xl font-black">{credits.toLocaleString("vi-VN")}</div>
              </div>
              <div className="rounded-xl border border-border/60 bg-card/70 p-4">
                <div className="text-[11px] font-bold uppercase text-muted-foreground">Dự án</div>
                <div className="mt-2 text-3xl font-black">{projects?.length ?? 0}</div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile icon={FileText} label="TTS tháng này" value={(usage?.tts_chars || 0).toLocaleString("vi-VN")} unit="ký tự" />
            <StatTile icon={Repeat} label="STT tháng này" value={(usage?.stt_min || 0).toLocaleString("vi-VN")} unit="phút" />
            <StatTile icon={Mic2} label="Dubbing" value={(usage?.dubbing_min || 0).toLocaleString("vi-VN")} unit="phút" />
            <StatTile icon={Wand2} label="Clone voice" value={(usage?.clone_min || 0).toLocaleString("vi-VN")} unit="phút" />
          </div>
        </div>

        <div className="flex flex-col p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-bold">Tác vụ gần đây</div>
            <button onClick={() => setActiveTab("projects")} className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
              Xem tất cả
            </button>
          </div>
          <div className="flex min-h-56 flex-1 flex-col justify-center rounded-2xl border border-dashed border-border/60 bg-background/35 p-5">
            {latestActivity ? (
              <div className="space-y-3">
                <ProjectRow
                  title={latestActivity.kind}
                  subtitle={latestActivity.current_step || "Tác vụ hệ thống"}
                  meta={latestActivity.created_at ? new Date(latestActivity.created_at).toLocaleString("vi-VN") : latestActivity.id}
                  status={latestActivity.status === "done" || latestActivity.status === "completed" ? "done" : "processing"}
                />
                <div className="text-xs text-muted-foreground">
                  {latestActivity.error || "Dữ liệu lấy trực tiếp từ hàng đợi xử lý của VoxStudio."}
                </div>
              </div>
            ) : (
              <div className="text-center">
                <Clock className="mx-auto h-9 w-9 text-muted-foreground/50" />
                <p className="mt-3 text-sm font-semibold">Chưa có hoạt động nào</p>
                <p className="mt-1 text-xs text-muted-foreground">Tạo TTS, STT hoặc dubbing để thấy lịch sử tại đây.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <BigToolCard icon={FileText} title="Văn bản thành giọng nói" desc="VoxStudio và Edge TTS, có lịch sử audio." gradient="from-zinc-100 to-zinc-500" onClick={() => setActiveTab("tts")} />
        <BigToolCard icon={Repeat} title="Giọng nói thành văn bản" desc="Tạo SRT/JSON subtitle từ audio/video." gradient="from-zinc-100 to-zinc-500" onClick={() => setActiveTab("subtitle")} />
        <BigToolCard icon={Mic2} title="Lồng tiếng tự động" desc="Tạo project dubbing thật trên backend." gradient="from-zinc-100 to-zinc-500" onClick={() => setActiveTab("dubbing")} />
        <BigToolCard icon={Wand2} title="Nhân bản giọng nói" desc="Clone voice từ audio mẫu của bạn." gradient="from-zinc-100 to-zinc-500" onClick={() => setActiveTab("saved-voices")} />
      </div>
    </div>
  );
}

// ── VIDEO DOWNLOAD TAB ─────────────────────────────────────────────────
function VideoDownloadTab() {
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<DownloadInfo | null>(null);
  const [busyInfo, setBusyInfo] = useState(false);
  const [busyProject, setBusyProject] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const platforms = [
    { name: "YouTube", color: "bg-red-500" },
    { name: "Facebook", color: "bg-blue-600" },
    { name: "TikTok", color: "bg-foreground" },
    { name: "Instagram", color: "bg-gradient-to-br from-pink-500 to-yellow-500" },
    { name: "Twitter", color: "bg-sky-400" },
    { name: "Vimeo", color: "bg-cyan-500" },
    { name: "LinkedIn", color: "bg-blue-700" },
    { name: "Twitch", color: "bg-purple-600" },
  ];

  async function inspectUrl() {
    setError("");
    setMessage("");
    setInfo(null);
    if (!url.trim()) {
      setError("Dán link video trước khi kiểm tra.");
      return;
    }
    setBusyInfo(true);
    try {
      setInfo(await fetchDownloadInfo({ url: url.trim() }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đọc được thông tin video.");
    } finally {
      setBusyInfo(false);
    }
  }

  async function createProject() {
    setError("");
    setMessage("");
    if (!url.trim()) {
      setError("Dán link video trước khi tạo dự án.");
      return;
    }
    setBusyProject(true);
    try {
      const res = await downloadToProject({
        url: url.trim(),
        target_language: "vietnamese",
        source_language: "auto",
        enable_dubbing: true,
        enable_subtitle: true,
      });
      const reader = res.body?.getReader();
      if (!reader) {
        setMessage("Đã gửi yêu cầu tạo dự án tải video.");
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let doneLabel = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const raw of events) {
          const line = raw.split("\n").find((item) => item.startsWith("data: "));
          if (!line) continue;
          const payload = JSON.parse(line.slice(6)) as { label?: string; project_id?: string; step?: string };
          doneLabel = payload.project_id
            ? `Đã tạo dự án ${payload.project_id}. Mở tab Dự án để xem.`
            : payload.label || doneLabel;
          setMessage(doneLabel);
        }
      }
      if (!doneLabel) setMessage("Đã tạo yêu cầu tải video.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được dự án từ link.");
    } finally {
      setBusyProject(false);
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-88px)] gap-4 xl:grid-cols-[minmax(0,1fr)_370px]">
      <section className="flex flex-col rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-xs font-bold text-muted-foreground">
            <Film className="h-4 w-4 text-primary" />
            Tải video từ URL
          </div>
          <span className="rounded-full border border-border/60 bg-background/50 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
            YouTube · TikTok · Facebook
          </span>
        </div>

        <div className="flex min-h-[54vh] flex-1 flex-col rounded-2xl border border-primary/50 bg-background p-5">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Link video
          </label>
          <textarea
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Dán link video cần tải hoặc tạo project dubbing..."
            className="mt-3 min-h-40 flex-1 resize-none rounded-xl border border-border/60 bg-card/40 px-4 py-4 text-sm font-semibold leading-6 outline-none placeholder:text-muted-foreground/55 focus:border-primary/60"
          />

          <div className="mt-5 grid gap-2 sm:grid-cols-4">
            {platforms.slice(0, 8).map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => setUrl((value) => value || `https://${p.name.toLowerCase()}.com/`)}
                className="rounded-xl border border-border/60 bg-card/50 px-3 py-3 text-left text-xs font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground"
              >
                <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${p.color}`} />
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/50 p-2">
          <button onClick={inspectUrl} disabled={busyInfo} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-4 text-xs font-bold text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-60">
            {busyInfo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Kiểm tra
          </button>
          <button onClick={() => setUrl("")} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-4 text-xs font-bold text-muted-foreground hover:bg-muted/50 hover:text-foreground">
            <Trash2 className="h-4 w-4" />
            Xoá
          </button>
          <div className="ml-auto text-xs font-semibold text-muted-foreground">
            {url.trim() ? "Sẵn sàng tạo dự án" : "Chờ link video"}
          </div>
          <button onClick={createProject} disabled={busyProject} className="inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-5 text-xs font-black text-background hover:scale-[1.01] disabled:opacity-60">
            {busyProject ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Tạo dự án
          </button>
        </div>
      </section>

      <aside className="flex min-h-[calc(100vh-88px)] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm">
        <div className="flex items-center justify-between border-b border-border/60 p-4">
          <div className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3 text-xs font-bold text-background">
            <FileText className="h-3.5 w-3.5" />
            Kết quả
          </div>
          <button onClick={inspectUrl} disabled={busyInfo || !url.trim()} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-40" title="Làm mới thông tin">
            {busyInfo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>}
          {message && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{message}</div>}
          {info ? (
            <div className="rounded-2xl border border-border/60 bg-background/45 p-4">
              {info.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={info.thumbnail} alt="" className="mb-4 aspect-video w-full rounded-xl object-cover" />
              )}
              <h3 className="line-clamp-2 text-sm font-black">{info.title || "Video đã đọc được"}</h3>
              <div className="mt-2 text-xs leading-5 text-muted-foreground">
                {[info.platform, info.author, info.duration ? `${Math.round(info.duration / 60)} phút` : ""].filter(Boolean).join(" · ") || "Có thể tạo project từ link này."}
              </div>
            </div>
          ) : (
            <div className="flex min-h-72 items-center justify-center rounded-2xl border border-dashed border-border/60 bg-background/35 p-8 text-center">
              <div>
                <Download className="mx-auto h-9 w-9 text-muted-foreground/50" />
                <p className="mt-3 text-sm font-bold">Chưa kiểm tra video</p>
                <p className="mt-1 text-xs text-muted-foreground">Dán link rồi bấm Kiểm tra để xem metadata.</p>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ── TTS TAB ────────────────────────────────────────────────────────────
function TtsTab({ setActiveTab }: { setActiveTab: (t: Tab) => void }) {
  const [tab, setTab] = useState<"text" | "file">("text");
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [engine, setEngine] = useState<"premium" | "cloud">(() => {
    if (typeof window === "undefined") return "premium";
    return (localStorage.getItem("voxstudio:tts:engine") as "premium" | "cloud" | null) || "premium";
  });
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!modelMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [modelMenuOpen]);
  const [voiceId, setVoiceId] = useState(() => (typeof window === "undefined" ? "" : localStorage.getItem("voxstudio:tts:voiceId") || ""));
  const [edgeVoice, setEdgeVoice] = useState(() => (typeof window === "undefined" ? "" : localStorage.getItem("voxstudio:tts:edgeVoice") || ""));
  const [language, setLanguage] = useState(() => (typeof window === "undefined" ? "vi" : localStorage.getItem("voxstudio:tts:language") || "vi"));
  const [speed, setSpeed] = useState(() => {
    if (typeof window === "undefined") return 1;
    return Number(localStorage.getItem("voxstudio:tts:speed") || 1);
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [numStep, setNumStep] = useState(() => {
    if (typeof window === "undefined") return 32;
    return Number(localStorage.getItem("voxstudio:tts:numStep") || 32);
  });
  const [guidanceScale, setGuidanceScale] = useState(() => {
    if (typeof window === "undefined") return 2;
    return Number(localStorage.getItem("voxstudio:tts:guidanceScale") || 2);
  });
  const [tShift, setTShift] = useState(() => {
    if (typeof window === "undefined") return 0.1;
    return Number(localStorage.getItem("voxstudio:tts:tShift") || 0.1);
  });
  const [layerPenaltyFactor, setLayerPenaltyFactor] = useState(() => {
    if (typeof window === "undefined") return 5;
    return Number(localStorage.getItem("voxstudio:tts:layerPenaltyFactor") || 5);
  });
  const [positionTemperature, setPositionTemperature] = useState(() => {
    if (typeof window === "undefined") return 5;
    return Number(localStorage.getItem("voxstudio:tts:positionTemperature") || 5);
  });
  const [classTemperature, setClassTemperature] = useState(() => {
    if (typeof window === "undefined") return 0;
    return Number(localStorage.getItem("voxstudio:tts:classTemperature") || 0);
  });
  const [denoise, setDenoise] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("voxstudio:tts:denoise") !== "false";
  });
  const [preprocessPrompt, setPreprocessPrompt] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("voxstudio:tts:preprocessPrompt") !== "false";
  });
  const [postprocessOutput, setPostprocessOutput] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("voxstudio:tts:postprocessOutput") !== "false";
  });
  const [audioChunkDuration, setAudioChunkDuration] = useState(() => {
    if (typeof window === "undefined") return 15;
    return Number(localStorage.getItem("voxstudio:tts:audioChunkDuration") || 15);
  });
  const [exportSubtitle, setExportSubtitle] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("voxstudio:tts:exportSubtitle") === "true";
  });
  const [subtitleFormat, setSubtitleFormat] = useState<"srt" | "json">(() => {
    if (typeof window === "undefined") return "srt";
    return (localStorage.getItem("voxstudio:tts:subtitleFormat") as "srt" | "json") || "srt";
  });
  const [panel, setPanel] = useState<"settings" | "history">("settings");
  const [voiceLibOpen, setVoiceLibOpen] = useState(false);
  const [charLimit, setCharLimit] = useState<number | null>(1000);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [premiumVoices, setPremiumVoices] = useState<PremiumVoice[]>([]);
  const [edgeVoices, setEdgeVoices] = useState<EdgeVoice[]>([]);
  const [history, setHistory] = useState<TtsHistoryItem[]>(loadTtsHistory);
  const [historyNewestFirst, setHistoryNewestFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([listVoices(), listPremiumVoices(), listEdgeVoices(), me()]).then((items) => {
      if (cancelled) return;
      const [userVoices, builtIn, edge, account] = items;
      setVoices(userVoices.status === "fulfilled" ? userVoices.value.voices || [] : []);
      setPremiumVoices(builtIn.status === "fulfilled" ? builtIn.value.voices || [] : []);
      setEdgeVoices(edge.status === "fulfilled" ? edge.value.voices || [] : []);
      if (account.status === "fulfilled") {
        const limit = account.value.plan?.limits?.tts_max_chars_request;
        if (typeof limit === "number") setCharLimit(limit === -1 ? null : limit);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const overLimit = charLimit !== null && text.length > charLimit;
  const premiumVoiceLabel =
    premiumVoices.find((voice) => voice.slug === voiceId)?.display_name ||
    voices.find((voice) => voice.id === voiceId)?.name ||
    "Giọng mặc định";
  const cloudVoiceLabel = edgeVoices.find((voice) => voice.name === edgeVoice)?.name || "Tự động chọn giọng";
  const selectedVoiceKey = engine === "premium" ? voiceId : edgeVoice;
  const selectedVoiceLabel = engine === "premium" ? premiumVoiceLabel : cloudVoiceLabel;
  const visibleHistory = historyNewestFirst ? history : [...history].reverse();

  function writeHistory(mutator: (items: TtsHistoryItem[]) => TtsHistoryItem[]) {
    setHistory((items) => {
      const next = mutator(items).slice(0, TTS_HISTORY_LIMIT);
      saveTtsHistory(next);
      return next;
    });
  }

  function pushHistory(item: TtsHistoryItem) {
    writeHistory((items) => [item, ...items]);
  }

  function reloadHistory() {
    setHistory(loadTtsHistory());
  }

  function deleteHistoryItem(id: string) {
    writeHistory((items) => items.filter((item) => item.id !== id));
  }

  function clearHistoryItems() {
    writeHistory(() => []);
  }

  function confirmClearHistory() {
    if (history.length === 0) return;
    toast.custom(
      (t) => (
        <div className="rainbow-frame w-[360px] p-[10px] shadow-2xl">
          <div className="relative z-[2] flex items-start gap-3 rounded-[10px] bg-card/95 p-3.5 backdrop-blur">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-500/15">
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-foreground">
                Xoá toàn bộ lịch sử?
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {history.length.toLocaleString("vi-VN")} mục sẽ bị xoá vĩnh viễn khỏi trình duyệt này.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    clearHistoryItems();
                    toast.dismiss(t);
                    toast.success("Đã xoá toàn bộ lịch sử", { duration: 2500 });
                  }}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-red-500 px-2.5 text-[11px] font-bold text-white hover:bg-red-600"
                >
                  <Trash2 className="h-3 w-3" />
                  Xoá hết
                </button>
                <button
                  type="button"
                  onClick={() => toast.dismiss(t)}
                  className="inline-flex h-7 items-center rounded-md border border-border/60 bg-background/60 px-2.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                >
                  Huỷ
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => toast.dismiss(t)}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              aria-label="Đóng"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ),
      { duration: 8000 },
    );
  }

  function reuseHistoryItem(item: TtsHistoryItem) {
    setText(item.text);
    setEngine(item.engine);
    setLanguage(item.language);
    if (item.engine === "premium") setVoiceId(item.voiceKey);
    else setEdgeVoice(item.voiceKey);
    setTab("text");
    setPanel("settings");
    setError("");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  async function generate() {
    setError("");
    if (!text.trim()) {
      setError("Nhập văn bản trước khi tạo giọng nói.");
      return;
    }
    if (overLimit) {
      setError(`Văn bản vượt giới hạn ${charLimit?.toLocaleString("vi-VN")} ký tự/lần của gói hiện tại.`);
      return;
    }
    setBusy(true);
    const sourceText = text;
    const createdAt = new Date().toISOString();
    const voiceLabel = selectedVoiceLabel;
    const voiceKey = selectedVoiceKey;
    const creditCost = estimateTtsCredits(sourceText);
    const tempId = createHistoryId();

    // 1. Push processing item ngay lập tức + switch sang lịch sử
    pushHistory({
      id: tempId,
      text: sourceText,
      engine,
      language,
      voiceKey,
      voiceLabel,
      createdAt,
      status: "processing",
      credits: creditCost,
      charCount: sourceText.length,
    });
    setPanel("history");

    try {
      const next =
        engine === "premium"
          ? await generateTts({
              text,
              voice_id: voiceId || null,
              language,
              speed,
              num_step: numStep,
              guidance_scale: guidanceScale,
              t_shift: tShift,
              layer_penalty_factor: layerPenaltyFactor,
              position_temperature: positionTemperature,
              class_temperature: classTemperature,
              denoise,
              preprocess_prompt: preprocessPrompt,
              postprocess_output: postprocessOutput,
              audio_chunk_duration: audioChunkDuration,
            })
          : await generateCloudTts({ text, voice: edgeVoice || null, language, speed });
      // 2. Update item status = "done" với audio url
      writeHistory((items) =>
        items.map((it) =>
          it.id === tempId
            ? {
                ...it,
                status: "done",
                audioUrl: next.audio_url,
                duration: next.duration,
                sampleRate: next.sample_rate,
                subtitleFormat: exportSubtitle ? subtitleFormat : undefined,
              }
            : it,
        ),
      );
      const subtitleMeta = {
        engine: engine === "premium" ? "VoxStudio · Vox Premium" : "Edge TTS",
        voice: voiceLabel,
        sampleRate: next.sample_rate,
        language,
      };
      toast.custom(
        (t) => (
          <div className="rainbow-frame w-[360px] p-[10px] shadow-2xl">
            <div className="relative z-[2] flex items-start gap-3 rounded-[10px] bg-card/95 p-3.5 backdrop-blur">
              <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-500/15">
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/25" />
                <CheckCircle2 className="relative h-5 w-5 text-emerald-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-foreground">Hoàn tất!</span>
                  <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                    {next.duration.toFixed(1)}s
                  </span>
                  {exportSubtitle && (
                    <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-primary">
                      .{subtitleFormat}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  Audio sẵn sàng · {next.sample_rate.toLocaleString("vi-VN")}Hz · {voiceLabel}
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPanel("history");
                      toast.dismiss(t);
                    }}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-[11px] font-bold text-background hover:opacity-90"
                  >
                    <Play className="h-3 w-3 fill-current" />
                    Nghe ngay
                  </button>
                  <a
                    href={mediaUrl(next.audio_url)}
                    download
                    onClick={() => toast.dismiss(t)}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  >
                    <Download className="h-3 w-3" />
                    Audio
                  </a>
                  {exportSubtitle && (
                    <button
                      type="button"
                      onClick={() => downloadSubtitleFile(sourceText, next.duration, subtitleFormat, subtitleMeta)}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    >
                      <FileText className="h-3 w-3" />
                      Phụ đề
                    </button>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => toast.dismiss(t)}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                aria-label="Đóng"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ),
        { duration: 6000 },
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Không tạo được giọng nói.";
      setError(message);
      // 3. Update item status = "failed" với error message
      writeHistory((items) =>
        items.map((it) =>
          it.id === tempId
            ? { ...it, status: "failed", error: message }
            : it,
        ),
      );
      toast.error("Tạo giọng nói thất bại", {
        description: message,
      });
    } finally {
      setBusy(false);
    }
  }

  function saveSettings() {
    localStorage.setItem("voxstudio:tts:engine", engine);
    localStorage.setItem("voxstudio:tts:voiceId", voiceId);
    localStorage.setItem("voxstudio:tts:edgeVoice", edgeVoice);
    localStorage.setItem("voxstudio:tts:language", language);
    localStorage.setItem("voxstudio:tts:speed", String(speed));
    localStorage.setItem("voxstudio:tts:numStep", String(numStep));
    localStorage.setItem("voxstudio:tts:guidanceScale", String(guidanceScale));
    localStorage.setItem("voxstudio:tts:tShift", String(tShift));
    localStorage.setItem("voxstudio:tts:layerPenaltyFactor", String(layerPenaltyFactor));
    localStorage.setItem("voxstudio:tts:positionTemperature", String(positionTemperature));
    localStorage.setItem("voxstudio:tts:classTemperature", String(classTemperature));
    localStorage.setItem("voxstudio:tts:denoise", String(denoise));
    localStorage.setItem("voxstudio:tts:preprocessPrompt", String(preprocessPrompt));
    localStorage.setItem("voxstudio:tts:postprocessOutput", String(postprocessOutput));
    localStorage.setItem("voxstudio:tts:audioChunkDuration", String(audioChunkDuration));
    localStorage.setItem("voxstudio:tts:exportSubtitle", String(exportSubtitle));
    localStorage.setItem("voxstudio:tts:subtitleFormat", subtitleFormat);
    setError("Đã lưu cài đặt TTS trên trình duyệt này.");
  }

  function normalizeText() {
    setText((value) =>
      value
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    );
  }

  function clearText() {
    setText("");
    setError("");
  }

  function insertPause() {
    const token = ' <break time="0.5s" /> ';
    const target = textareaRef.current;
    if (!target) {
      setText((value) => `${value}${token}`);
      return;
    }
    const start = target.selectionStart;
    const end = target.selectionEnd;
    setText((value) => `${value.slice(0, start)}${token}${value.slice(end)}`);
    window.setTimeout(() => {
      target.focus();
      const next = start + token.length;
      target.setSelectionRange(next, next);
    }, 0);
  }

  function resetSettings() {
    setEngine("premium");
    setVoiceId("");
    setEdgeVoice("");
    setLanguage("vi");
    setSpeed(1);
    setNumStep(32);
    setGuidanceScale(2);
    setTShift(0.1);
    setLayerPenaltyFactor(5);
    setPositionTemperature(5);
    setClassTemperature(0);
    setDenoise(true);
    setPreprocessPrompt(true);
    setPostprocessOutput(true);
    setAudioChunkDuration(15);
    setExportSubtitle(false);
    setSubtitleFormat("srt");
    setError("");
  }

  async function loadTextFile(file: File | undefined) {
    if (!file) return;
    const name = file.name.toLowerCase();
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";

    // Text-like formats: read trực tiếp
    const PLAIN_TEXT_EXTS = new Set([
      ".txt", ".md", ".markdown", ".csv", ".tsv", ".log", ".text",
    ]);
    // Subtitle: strip timestamps + numbering
    const SUBTITLE_EXTS = new Set([".srt", ".vtt"]);
    // RTF: strip control codes basic
    const RTF_EXTS = new Set([".rtf"]);

    if (!PLAIN_TEXT_EXTS.has(ext) && !SUBTITLE_EXTS.has(ext) && !RTF_EXTS.has(ext)) {
      setError(
        `Định dạng "${ext || "không rõ"}" chưa hỗ trợ. ` +
        `Đang hỗ trợ: .txt, .md, .csv, .tsv, .log, .srt, .vtt, .rtf. ` +
        `Với .docx/.pdf — copy nội dung paste vào ô văn bản.`,
      );
      return;
    }

    let raw = await file.text();

    if (SUBTITLE_EXTS.has(ext)) {
      // Strip SRT/VTT: bỏ index lines (số), timestamp lines (00:00:00,000 --> ...),
      // VTT header (WEBVTT), và các tag <i>, {\an8}, ...
      raw = raw
        .replace(/^WEBVTT.*$/im, "")
        .replace(/^\d+$/gm, "")  // index lines
        .replace(/^\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->.*$/gm, "")  // timestamp lines
        .replace(/<\/?[^>]+>/g, "")  // HTML tags
        .replace(/\{\\[^}]+\}/g, "")  // ASS override codes
        .replace(/\n{3,}/g, "\n\n")  // collapse blank lines
        .trim();
    } else if (RTF_EXTS.has(ext)) {
      // Strip RTF: bỏ control words (\word) + groups + escapes — đủ cho RTF cơ bản.
      // Không phải parser đầy đủ — RTF phức tạp khuyên copy-paste.
      raw = raw
        .replace(/\\[a-z]+-?\d*\s?/gi, "")  // \control or \control123
        .replace(/[{}]/g, "")
        .replace(/\\'[0-9a-f]{2}/gi, "")  // hex escapes
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    if (!raw.trim()) {
      setError("Tệp không có nội dung văn bản để đọc.");
      return;
    }
    setText(raw);
    setTab("text");
  }

  return (
    <div className="min-h-[calc(100vh-88px)] text-foreground">
      <div className="grid min-h-[calc(100vh-88px)] gap-4 xl:grid-cols-[minmax(0,1fr)_410px]">
        <section className="flex min-h-[calc(100vh-88px)] flex-col rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm sm:p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <FileText className="h-4 w-4 text-primary" />
              <span>Văn bản thành giọng nói</span>
            </div>
            <div className="inline-flex rounded-lg border border-border/60 bg-muted/30 p-1">
              <button onClick={() => setTab("text")} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${tab === "text" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
                Văn bản
              </button>
              <button onClick={() => setTab("file")} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${tab === "file" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
                Tải tệp
              </button>
            </div>
          </div>

          {tab === "text" ? (
            text.length > 0 || busy ? (
              <div className="rainbow-frame flex min-h-[58vh] flex-1">
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={busy}
                  placeholder={busy ? "Đang xử lý — vui lòng chờ..." : "Nhập hoặc dán văn bản cần chuyển thành giọng nói..."}
                  className="relative z-[2] min-h-[58vh] flex-1 resize-none rounded-[10px] bg-transparent px-5 py-5 text-[15px] font-semibold leading-7 text-foreground outline-none placeholder:text-muted-foreground/55 disabled:cursor-not-allowed disabled:opacity-60 sm:px-6"
                />
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={busy}
                placeholder="Nhập hoặc dán văn bản cần chuyển thành giọng nói..."
                className="min-h-[58vh] flex-1 resize-none rounded-xl border-2 border-primary/40 bg-background px-5 py-5 text-[15px] font-semibold leading-7 text-foreground outline-none placeholder:text-muted-foreground/55 sm:px-6"
              />
            )
          ) : (
            <label className="flex min-h-[58vh] flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-background/40 py-16 text-sm text-muted-foreground hover:border-primary/40">
              <FileUp className="h-8 w-8" />
              <span>Tải tệp văn bản</span>
              <span className="text-xs text-center px-4">
                Hỗ trợ: .txt · .md · .csv · .tsv · .log · .srt · .vtt · .rtf<br/>
                <span className="text-muted-foreground/70">(.docx và .pdf — copy nội dung paste vào ô văn bản)</span>
              </span>
              <input type="file" accept=".txt,.md,.markdown,.csv,.tsv,.log,.text,.srt,.vtt,.rtf,text/plain,text/markdown,text/csv" className="hidden" onChange={(event) => void loadTextFile(event.target.files?.[0])} />
            </label>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/50 p-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 text-xs font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground" title="Hỗ trợ .txt .md .csv .tsv .log .srt .vtt .rtf">
              <Upload className="h-3.5 w-3.5" />
              Tải tệp
              <input type="file" accept=".txt,.md,.markdown,.csv,.tsv,.log,.text,.srt,.vtt,.rtf,text/plain,text/markdown,text/csv" className="hidden" onChange={(event) => void loadTextFile(event.target.files?.[0])} />
            </label>
            <button onClick={clearText} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 text-xs font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground">
              <Trash2 className="h-3.5 w-3.5" />
              Xoá
            </button>
            <button onClick={normalizeText} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 text-xs font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground">
              <Repeat className="h-3.5 w-3.5" />
              Chuẩn hoá
            </button>
            <button onClick={insertPause} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 text-xs font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground">
              <PauseCircle className="h-3.5 w-3.5" />
              Khoảng dừng
            </button>
            <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
              <span className={overLimit ? "text-red-400" : ""}>
                {text.length.toLocaleString("vi-VN")} / {charLimit === null ? "Không giới hạn" : charLimit.toLocaleString("vi-VN")} ký tự
              </span>
              <span className="hidden sm:inline">|</span>
              <span className="font-semibold text-primary">{Math.max(1, Math.ceil(text.length / 20)).toLocaleString("vi-VN")} credits</span>
            </div>
          </div>

          {error && (
            <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${error.startsWith("Đã lưu") ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"}`}>
              {error}
            </div>
          )}

        </section>

        <aside className="sticky top-[72px] flex h-[calc(100vh-88px)] flex-col rounded-2xl border border-border/60 bg-card/70 shadow-sm">
          <div className="relative flex items-center justify-between gap-3 border-b border-border/60 p-4">
            <div className="inline-flex items-center gap-2">
              <button type="button" onClick={() => setPanel("settings")} className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold ${panel === "settings" ? "bg-foreground text-background" : "bg-muted/40 text-muted-foreground hover:text-foreground"}`}>
                <SettingsIcon className="h-3.5 w-3.5" />
                Cài đặt
              </button>
              <button type="button" onClick={() => setPanel("history")} className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold ${panel === "history" ? "bg-foreground text-background" : "bg-muted/40 text-muted-foreground hover:text-foreground"}`}>
                <Clock className="h-3.5 w-3.5" />
                Lịch sử
              </button>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {/* Model selector — custom dropdown với logo */}
              <div ref={modelMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setModelMenuOpen((o) => !o)}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-background/60 pl-2 pr-2.5 text-xs font-semibold text-foreground hover:bg-muted/40"
                >
                  <EngineLogo engine={engine} size="sm" />
                  <span>{engine === "premium" ? "VoxStudio" : "Edge TTS"}</span>
                  <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${modelMenuOpen ? "rotate-180" : ""}`} />
                </button>

                {modelMenuOpen && (
                  <div className="absolute right-0 top-[calc(100%+6px)] z-[60] w-72 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-2xl">
                    <div className="p-1">
                      <ModelOption
                        active={engine === "premium"}
                        name="VoxStudio"
                        desc="Giọng đọc tự nhiên, model riêng, tiếng Việt chuẩn"
                        engineId="premium"
                        onClick={() => {
                          setEngine("premium");
                          setModelMenuOpen(false);
                        }}
                      />
                      <ModelOption
                        active={engine === "cloud"}
                        name="Edge TTS"
                        desc="400+ giọng, 100+ ngôn ngữ, miễn phí siêu rẻ"
                        engineId="cloud"
                        onClick={() => {
                          setEngine("cloud");
                          setModelMenuOpen(false);
                        }}
                      />
                    </div>
                    <div className="border-t border-border/60 bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground">
                      Bạn có thể đổi model bất kỳ lúc nào — settings sẽ được lưu.
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>

          {panel === "settings" ? (
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
              <div>
                <span className="block text-xs font-semibold text-muted-foreground">Ngôn ngữ</span>
                {(() => {
                  const codes =
                    engine === "premium"
                      ? [...PREMIUM_LANGUAGES]
                      : languageOptionsFromVoices(edgeVoices);
                  if (language && !codes.includes(language) && LANGUAGE_META[language]) {
                    codes.push(language);
                  }
                  return (
                    <LanguageCombobox
                      value={language}
                      onChange={setLanguage}
                      options={codes}
                      engineLabel={engine === "premium" ? "Vox Premium" : "Edge TTS"}
                      totalSupported={engine === "premium" ? PREMIUM_LANGUAGES_TOTAL : undefined}
                    />
                  );
                })()}
              </div>

              <div>
                <span className="block text-xs font-semibold text-muted-foreground">
                  {engine === "premium" ? "Chọn giọng nói" : "Giọng Edge TTS"}
                </span>
                {(() => {
                  const currentKey = engine === "premium" ? voiceId : edgeVoice;
                  let label = engine === "premium" ? "Giọng mặc định" : "Tự động chọn giọng";
                  let sublabel = "";
                  let flag: string | null = null;
                  if (currentKey) {
                    if (engine === "premium") {
                      const builtIn = premiumVoices.find((x) => x.slug === currentKey);
                      const userClone = voices.find((x) => x.id === currentKey);
                      if (builtIn) {
                        label = builtIn.display_name;
                        const code = resolveLangCode(builtIn.language) || "";
                        flag = LANGUAGE_META[code]?.flag || null;
                        sublabel = builtIn.description || "Giọng đang sử dụng";
                      } else if (userClone) {
                        label = userClone.name;
                        const parsed = parseVoiceTags(userClone);
                        flag = (parsed.langCode && LANGUAGE_META[parsed.langCode]?.flag) || null;
                        sublabel = userClone.ref_text?.slice(0, 60) || "Giọng đang sử dụng";
                      }
                    } else {
                      const v = edgeVoices.find((x) => x.name === currentKey);
                      if (v) {
                        label = v.name.replace(/^[a-z]{2}-[A-Z]{2}-/, "").replace(/Neural$/, "");
                        const code = resolveLangCode(v.locale) || "";
                        flag = LANGUAGE_META[code]?.flag || null;
                        sublabel = `${v.locale} · ${v.gender}`;
                      }
                    }
                  }
                  return (
                    <button
                      type="button"
                      onClick={() => setVoiceLibOpen(true)}
                      className="mt-2 flex h-14 w-full items-center justify-between gap-3 rounded-lg border border-border/60 bg-background px-3 text-left transition hover:border-primary/40"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border/60 bg-card text-base leading-none">
                          {flag ?? <Globe className="h-3.5 w-3.5 text-muted-foreground" />}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-bold text-foreground">{label}</span>
                          <span className="truncate text-[11px] font-normal text-muted-foreground">
                            {sublabel || (engine === "premium" ? "Bấm để chọn giọng" : "Bấm để chọn voice")}
                          </span>
                        </span>
                      </span>
                      <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-muted/40 px-2 text-[10px] font-bold uppercase text-muted-foreground">
                        <Folder className="h-3 w-3" />
                        Thư viện
                      </span>
                    </button>
                  );
                })()}
              </div>

              <VoiceLibraryModal
                open={voiceLibOpen}
                onClose={() => setVoiceLibOpen(false)}
                engine={engine}
                onEngineChange={setEngine}
                premiumVoices={premiumVoices}
                userVoices={voices}
                edgeVoices={edgeVoices}
                selectedKey={engine === "premium" ? voiceId : edgeVoice}
                onSelect={(key) => (engine === "premium" ? setVoiceId(key) : setEdgeVoice(key))}
                onCreateVoice={() => setActiveTab("saved-voices")}
              />

              <Slider label="Tốc độ" value={speed} onChange={setSpeed} min={0.5} max={1.5} step={0.05} suffix="x" />

              {engine === "premium" && (
                <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                  <button
                    onClick={() => setShowAdvanced((value) => !value)}
                    className="flex w-full items-center justify-between text-xs font-semibold text-foreground hover:text-primary"
                  >
                    <span>Tham số VoxStudio</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                  </button>

                  {showAdvanced && (
                    <div className="mt-4 space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <Slider label="Số bước" value={numStep} onChange={(value) => setNumStep(Math.round(value))} min={4} max={64} step={1} suffix="" />
                        <Slider label="Guidance" value={guidanceScale} onChange={setGuidanceScale} min={0} max={4} step={0.1} suffix="" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Slider label="T-shift" value={tShift} onChange={setTShift} min={0} max={1} step={0.01} suffix="" />
                        <Slider label="Layer penalty" value={layerPenaltyFactor} onChange={setLayerPenaltyFactor} min={0} max={20} step={0.5} suffix="" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Slider label="Position temp" value={positionTemperature} onChange={setPositionTemperature} min={0} max={20} step={0.5} suffix="" />
                        <Slider label="Class temp" value={classTemperature} onChange={setClassTemperature} min={0} max={2} step={0.05} suffix="" />
                      </div>
                      <Slider label="Độ dài chunk" value={audioChunkDuration} onChange={setAudioChunkDuration} min={5} max={30} step={0.5} suffix="s" />
                      <div className="space-y-2">
                        <CheckboxRow label="Khử nhiễu" checked={denoise} onChange={setDenoise} />
                        <CheckboxRow label="Tiền xử lý prompt" checked={preprocessPrompt} onChange={setPreprocessPrompt} />
                        <CheckboxRow label="Hậu xử lý audio" checked={postprocessOutput} onChange={setPostprocessOutput} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <button onClick={saveSettings} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border/60 bg-background/60 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground">
                <Save className="h-3.5 w-3.5" />
                Lưu cài đặt
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button onClick={insertPause} className="inline-flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-background/60 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground">
                  <PauseCircle className="h-3.5 w-3.5" />
                  Khoảng dừng
                </button>
                <button onClick={resetSettings} className="inline-flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-background/60 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Đặt lại
                </button>
              </div>

              <div className={`rounded-xl border bg-background/40 p-3 transition ${exportSubtitle ? "border-primary/50 ring-1 ring-primary/20" : "border-border/60"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <FileText className={`h-3.5 w-3.5 ${exportSubtitle ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="text-xs font-bold text-foreground">Xuất phụ đề</span>
                      {exportSubtitle && (
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-primary">
                          BẬT
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      Tạo file phụ đề đồng bộ thời gian từ văn bản — tải kèm audio.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={exportSubtitle}
                    onClick={() => setExportSubtitle((v) => !v)}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition ${exportSubtitle ? "bg-primary" : "bg-muted"}`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${exportSubtitle ? "left-[18px]" : "left-0.5"}`}
                    />
                  </button>
                </div>
                {exportSubtitle && (
                  <div className="mt-2.5 flex gap-1.5">
                    {(["srt", "json"] as const).map((format) => (
                      <button
                        key={format}
                        type="button"
                        onClick={() => setSubtitleFormat(format)}
                        className={`h-7 flex-1 rounded-md border text-[11px] font-black uppercase tracking-wide transition ${
                          subtitleFormat === format
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border/60 bg-background/60 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        }`}
                      >
                        .{format}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={generate} disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-sm font-bold text-background shadow-lg hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Tạo Giọng Nói
              </button>
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {history.length > 0 && (
                <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    {history.length} mục · {historyNewestFirst ? "Mới nhất trước" : "Cũ nhất trước"}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={reloadHistory}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      aria-label="Làm mới lịch sử"
                      title="Làm mới lịch sử"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryNewestFirst((value) => !value)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      aria-label="Đổi thứ tự lịch sử"
                      title={historyNewestFirst ? "Cũ nhất trước" : "Mới nhất trước"}
                    >
                      <FileText className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={confirmClearHistory}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                      aria-label="Xoá toàn bộ lịch sử"
                      title="Xoá toàn bộ lịch sử"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
              {history.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/60 bg-background/35 p-8 text-center text-sm text-muted-foreground">
                  <Clock className="mx-auto mb-3 h-7 w-7 opacity-60" />
                  <div className="font-semibold text-foreground">Chưa có lịch sử TTS</div>
                  <p className="mt-1 text-xs leading-5">
                    Audio tạo thành công hoặc lỗi xử lý sẽ được lưu trên trình duyệt này.
                  </p>
                </div>
              ) : (
                visibleHistory.map((item) => {
                  const isProcessing = item.status === "processing";
                  const isDone = item.status === "done";
                  const isFailed = item.status === "failed";
                  if (isProcessing) {
                    return (
                      <div
                        key={item.id}
                        className="rainbow-frame relative overflow-hidden p-[14px]"
                      >
                        <div className="relative z-[2] rounded-[10px] bg-card/90 p-4 backdrop-blur">
                          <div className="flex items-center gap-3">
                            <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15">
                              <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />
                              <Loader2 className="relative h-5 w-5 animate-spin text-primary" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-foreground">
                                  Đang tạo giọng nói
                                </span>
                                <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                              </div>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {item.engine === "premium" ? "VoxStudio · Vox Premium" : "Edge TTS · Cloud"} · {item.charCount.toLocaleString("vi-VN")} ký tự
                              </p>
                            </div>
                            <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
                              {formatHistoryTime(item.createdAt)}
                            </span>
                          </div>

                          <p className="mt-3 line-clamp-2 rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                            {item.text}
                          </p>

                          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted/60">
                            <div className="h-full w-full rainbow-progress rounded-full" />
                          </div>
                        </div>
                      </div>
                    );
                  }
                  const hasAudio = isDone && !!item.audioUrl;
                  const showAsFailed = isFailed || (isDone && !item.audioUrl);
                  return (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-border/60 bg-background/45 p-4 shadow-sm transition-all"
                  >
                    <div className="flex items-center gap-2 border-b border-border/50 pb-3">
                      <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
                        showAsFailed ? "bg-red-500/10 text-red-500" : "bg-primary/15 text-primary"
                      }`}>
                        {item.engine === "premium" ? (
                          <Mic2 className="h-4 w-4" />
                        ) : (
                          <Zap className="h-4 w-4" />
                        )}
                      </div>
                      {showAsFailed ? (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                        {formatHistoryTime(item.createdAt)}
                      </span>
                      <span className="rounded-md bg-muted/70 px-2 py-1 text-[11px] font-bold text-foreground">
                        {item.charCount.toLocaleString("vi-VN")}
                      </span>
                      {hasAudio && item.subtitleFormat && (
                        <span
                          className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-1 text-[10px] font-black uppercase tracking-wide text-primary"
                          title={`Có phụ đề .${item.subtitleFormat}`}
                        >
                          <FileText className="h-3 w-3" />
                          {item.subtitleFormat}
                        </span>
                      )}
                      <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-wide ${
                        showAsFailed ? "bg-red-500 text-white" : "bg-foreground text-background"
                      }`}>
                        {showAsFailed ? "THẤT BẠI" : "XONG"}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteHistoryItem(item.id)}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                        aria-label="Xoá mục lịch sử"
                        title="Xoá mục lịch sử"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <p className="mt-3 line-clamp-2 text-sm font-medium leading-6 text-foreground">
                      {item.text}
                    </p>

                    {hasAudio && item.audioUrl ? (
                      <div className="mt-3">
                        <CompactAudioPlayer
                          src={mediaUrl(item.audioUrl)}
                          duration={item.duration}
                          onReuse={() => reuseHistoryItem(item)}
                          subtitle={
                            item.subtitleFormat && item.duration
                              ? {
                                  format: item.subtitleFormat,
                                  text: item.text,
                                  duration: item.duration,
                                  meta: {
                                    engine: item.engine === "premium" ? "VoxStudio · Vox Premium" : "Edge TTS",
                                    voice: item.voiceLabel,
                                    sampleRate: item.sampleRate || 0,
                                    language: item.language,
                                  },
                                }
                              : undefined
                          }
                        />
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 p-3">
                        <p className="line-clamp-2 text-xs leading-5 text-red-700 dark:text-red-300">
                          {item.error
                            || (isDone && !item.audioUrl ? "Audio không khả dụng — file đã bị xoá hoặc URL hết hạn." : "Tác vụ chưa tạo được audio.")}
                        </p>
                        <button
                          type="button"
                          onClick={() => reuseHistoryItem(item)}
                          className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-red-500/25 bg-background/60 px-3 text-xs font-semibold text-red-700 hover:bg-red-500/10 dark:text-red-300"
                        >
                          <Repeat className="h-3.5 w-3.5" />
                          Dùng lại nội dung
                        </button>
                      </div>
                    )}
                  </div>
                  );
                })
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ── SUBTITLE TAB ───────────────────────────────────────────────────────
// Format serializers cho subtitle export
type SttSegment = { start?: number; end?: number; text?: string };

function sttPadTime(sec: number, sep: string = ",") {
  const s = Math.max(0, sec || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}${sep}${String(ms).padStart(3, "0")}`;
}

function sttToSrt(segs: SttSegment[]): string {
  return segs.map((seg, i) =>
    `${i + 1}\n${sttPadTime(seg.start || 0, ",")} --> ${sttPadTime(seg.end || 0, ",")}\n${(seg.text || "").trim()}\n`
  ).join("\n");
}

function sttToVtt(segs: SttSegment[]): string {
  const body = segs.map((seg) =>
    `${sttPadTime(seg.start || 0, ".")} --> ${sttPadTime(seg.end || 0, ".")}\n${(seg.text || "").trim()}\n`
  ).join("\n");
  return `WEBVTT\n\n${body}`;
}

function sttToTxt(segs: SttSegment[]): string {
  return segs.map((s) => (s.text || "").trim()).filter(Boolean).join("\n");
}

function sttToJson(segs: SttSegment[], meta: { language?: string | null; text?: string }): string {
  return JSON.stringify(
    {
      version: "1.0",
      generator: "VoxStudio",
      created_at: new Date().toISOString(),
      language: meta.language || null,
      full_text: meta.text || "",
      segments: segs.map((s, i) => ({
        id: i + 1,
        start: Number((s.start || 0).toFixed(3)),
        end: Number((s.end || 0).toFixed(3)),
        duration: Number(((s.end || 0) - (s.start || 0)).toFixed(3)),
        text: (s.text || "").trim(),
      })),
    },
    null,
    2,
  );
}

function sttToCsv(segs: SttSegment[]): string {
  const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = "start,end,text";
  const rows = segs.map((s) =>
    [(s.start || 0).toFixed(3), (s.end || 0).toFixed(3), esc((s.text || "").trim())].join(","),
  );
  return [head, ...rows].join("\n");
}

const STT_FORMATS = [
  { key: "srt" as const, label: "SRT", mime: "text/plain;charset=utf-8", hint: "Phụ đề chuẩn (player)" },
  { key: "vtt" as const, label: "VTT", mime: "text/vtt;charset=utf-8", hint: "Web Video Text Tracks" },
  { key: "txt" as const, label: "TXT", mime: "text/plain;charset=utf-8", hint: "Văn bản thô" },
  { key: "json" as const, label: "JSON", mime: "application/json;charset=utf-8", hint: "Có timestamp + metadata" },
  { key: "csv" as const, label: "CSV", mime: "text/csv;charset=utf-8", hint: "Excel / Sheets" },
];

type SttFormat = typeof STT_FORMATS[number]["key"];

function serializeStt(format: SttFormat, segments: SttSegment[], meta: { language?: string | null; text?: string }): string {
  if (format === "srt") return sttToSrt(segments);
  if (format === "vtt") return sttToVtt(segments);
  if (format === "txt") return sttToTxt(segments);
  if (format === "json") return sttToJson(segments, meta);
  return sttToCsv(segments);
}

function downloadSttFile(format: SttFormat, segments: SttSegment[], meta: { language?: string | null; text?: string }, filename: string) {
  const fmt = STT_FORMATS.find((f) => f.key === format)!;
  const content = serializeStt(format, segments, meta);
  const blob = new Blob([content], { type: fmt.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const STT_LANGUAGES = ["vi","en","zh","ja","ko","fr","es","de","pt","ru","th","id","ms","tr","it","nl","pl","ar","hi","uk"];

// Compact language picker cho STT — hỗ trợ "auto" với Lucide Globe icon
function SttLangPicker({
  value,
  onChange,
  includeAuto,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  includeAuto?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handler(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const isAuto = value === "auto";
  const meta = isAuto ? null : LANGUAGE_META[value];
  const codes = includeAuto ? ["auto", ...STT_LANGUAGES] : STT_LANGUAGES;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-11 w-full items-center justify-between gap-2 rounded-lg border bg-background px-3 text-left transition ${
          open ? "border-primary/60 ring-2 ring-primary/15" : "border-border/60 hover:border-border"
        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {isAuto ? (
            <Globe className="h-4 w-4 text-muted-foreground" />
          ) : meta ? (
            <span className="text-base leading-none">{meta.flag}</span>
          ) : (
            <Globe className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="truncate text-sm font-semibold text-foreground">
            {isAuto ? "Tự động phát hiện" : meta?.native || value.toUpperCase()}
          </span>
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-[280px] overflow-y-auto rounded-xl border border-border/60 bg-popover p-1 shadow-2xl">
          {codes.map((code) => {
            const isCodeAuto = code === "auto";
            const codeMeta = isCodeAuto ? null : LANGUAGE_META[code];
            const selected = code === value;
            return (
              <button
                key={code}
                type="button"
                onClick={() => {
                  onChange(code);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition ${
                  selected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted/50"
                }`}
              >
                {isCodeAuto ? (
                  <Globe className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <span className="text-base leading-none">{codeMeta?.flag || ""}</span>
                )}
                <span className="flex-1 truncate font-medium">
                  {isCodeAuto ? "Tự động phát hiện" : codeMeta?.native || code.toUpperCase()}
                </span>
                {selected && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const STT_TRANSLATE_ENGINES = [
  { id: "google_free", label: "Google (miễn phí)", needsKey: false },
  { id: "google_cloud", label: "Google Cloud", needsKey: true },
  { id: "deepl", label: "DeepL", needsKey: true },
  { id: "gemini", label: "Gemini", needsKey: true },
  { id: "openai", label: "OpenAI (GPT)", needsKey: true },
  { id: "claude", label: "Claude", needsKey: true },
];

type SttHistoryItem = {
  id: string;
  fileName: string;
  fileSize: number;
  formats: SttFormat[];
  language: string | null;
  translatedTo?: string | null;
  fullText: string;
  segments: SttSegment[];
  translatedSegments?: string[];
  totalDuration: number;
  createdAt: string;
};

const STT_HISTORY_KEY = "voxstudio:stt:history";

function loadSttHistory(): SttHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STT_HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Migrate shape cũ {format: "srt"} → mới {formats: ["srt"]}
    return arr.map((item: SttHistoryItem & { format?: SttFormat }) => {
      if (Array.isArray(item.formats)) return item;
      if (item.format) {
        const { format, ...rest } = item;
        return { ...rest, formats: [format] } as SttHistoryItem;
      }
      return { ...item, formats: ["srt"] };
    });
  } catch {
    return [];
  }
}

function saveSttHistory(items: SttHistoryItem[]) {
  if (typeof window === "undefined") return;
  // Cap 30 mục để không nặng localStorage
  const capped = items.slice(0, 30);
  localStorage.setItem(STT_HISTORY_KEY, JSON.stringify(capped));
}

function SubtitleTab() {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState(() => {
    if (typeof window === "undefined") return "auto";
    return localStorage.getItem("voxstudio:stt:language") || "auto";
  });
  // Multi-select format — chọn 1-3 định dạng cùng lúc, run sẽ tạo các
  // file đó song song. Không cho chọn quá 3 để tránh tốn dung lượng + thời gian.
  const STT_MAX_FORMATS = 3;
  const [formats, setFormats] = useState<Set<SttFormat>>(() => {
    if (typeof window === "undefined") return new Set(["srt"]);
    try {
      const raw = localStorage.getItem("voxstudio:stt:formats");
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) {
          const valid = arr.filter((k): k is SttFormat => STT_FORMATS.some((f) => f.key === k));
          return new Set(valid.slice(0, STT_MAX_FORMATS));
        }
      }
    } catch {}
    return new Set(["srt"]);
  });

  function toggleFormat(f: SttFormat) {
    setFormats((prev) => {
      const next = new Set(prev);
      if (next.has(f)) {
        // Bỏ chọn — đảm bảo còn ít nhất 1
        if (next.size > 1) next.delete(f);
        return next;
      }
      // Thêm — nhưng cap ở MAX
      if (next.size >= STT_MAX_FORMATS) {
        toast.info(`Tối đa ${STT_MAX_FORMATS} định dạng / lần chuyển đổi`, { duration: 1800 });
        return next;
      }
      next.add(f);
      return next;
    });
  }
  const [translateOn, setTranslateOn] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("voxstudio:stt:translateOn") === "1";
  });
  const [translateTarget, setTranslateTarget] = useState(() => {
    if (typeof window === "undefined") return "vi";
    return localStorage.getItem("voxstudio:stt:translateTarget") || "vi";
  });
  const [translateEngine, setTranslateEngine] = useState(() => {
    if (typeof window === "undefined") return "google_free";
    return localStorage.getItem("voxstudio:stt:translateEngine") || "google_free";
  });
  const [translateApiKey, setTranslateApiKey] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("voxstudio:stt:translateApiKey") || "";
  });
  const [busy, setBusy] = useState(false);
  const [busyStep, setBusyStep] = useState<"" | "transcribing" | "translating">("");
  const [history, setHistory] = useState<SttHistoryItem[]>(() => loadSttHistory());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:stt:language", language);
  }, [language]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:stt:formats", JSON.stringify(Array.from(formats)));
  }, [formats]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:stt:translateOn", translateOn ? "1" : "0");
  }, [translateOn]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:stt:translateTarget", translateTarget);
  }, [translateTarget]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:stt:translateEngine", translateEngine);
  }, [translateEngine]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:stt:translateApiKey", translateApiKey);
  }, [translateApiKey]);

  const currentEngine = STT_TRANSLATE_ENGINES.find((e) => e.id === translateEngine);
  const needsApiKey = !!currentEngine?.needsKey;
  const apiKeyMissing = translateOn && needsApiKey && !translateApiKey.trim();


  function pushHistory(item: SttHistoryItem) {
    setHistory((prev) => {
      const next = [item, ...prev].slice(0, 30);
      saveSttHistory(next);
      return next;
    });
  }

  function deleteHistoryItem(id: string) {
    setHistory((prev) => {
      const next = prev.filter((it) => it.id !== id);
      saveSttHistory(next);
      return next;
    });
  }

  function clearHistory() {
    setHistory([]);
    saveSttHistory([]);
  }

  async function runTranscribe() {
    setError("");
    if (!file) {
      setError("Chọn file audio/video trước khi tạo phụ đề.");
      return;
    }
    if (apiKeyMissing) {
      setError("Engine dịch này yêu cầu API key — nhập key hoặc chọn engine miễn phí.");
      return;
    }
    setBusy(true);
    const capturedFile = file;
    const capturedFormats: SttFormat[] = Array.from(formats);
    const capturedLang = language;
    const capturedTranslateOn = translateOn;
    const capturedTarget = translateTarget;
    const capturedEngine = translateEngine;
    const capturedKey = translateApiKey;
    try {
      // 1. Transcribe
      setBusyStep("transcribing");
      const res = await transcribeAudio({ audio: capturedFile, language: capturedLang });
      const segs = res.segments || [];
      const totalDuration = segs.length > 0 ? (segs[segs.length - 1].end || 0) : 0;

      let translatedSegs: string[] | undefined;
      let translatedTo: string | null = null;

      // 2. Translate (nếu bật)
      if (capturedTranslateOn && segs.length > 0) {
        setBusyStep("translating");
        try {
          const texts = segs.map((s) => (s.text || "").trim()).filter(Boolean);
          const trRes = await translateTexts({
            texts,
            target: capturedTarget,
            source: res.language || "auto",
            engine: capturedEngine,
            api_key: needsApiKey ? capturedKey.trim() : null,
          });
          translatedSegs = trRes.translations || [];
          translatedTo = capturedTarget;
        } catch (e) {
          toast.error("Dịch thất bại", {
            description: e instanceof Error ? e.message : undefined,
          });
        }
      }

      // 3. Push vào lịch sử + auto download tất cả format đã chọn
      const item: SttHistoryItem = {
        id: createHistoryId(),
        fileName: capturedFile.name,
        fileSize: capturedFile.size,
        formats: capturedFormats,
        language: res.language || null,
        translatedTo,
        fullText: res.text || "",
        segments: segs,
        translatedSegments: translatedSegs,
        totalDuration,
        createdAt: new Date().toISOString(),
      };
      pushHistory(item);
      setExpandedId(item.id);

      // KHÔNG auto-download — user click vào nút format trong lịch sử để
      // tải đúng định dạng cần. Tránh sinh hàng loạt file user không muốn.
      toast.success("Đã chuyển đổi xong", {
        description: `${segs.length} đoạn${translatedTo ? ` · → ${translatedTo.toUpperCase()}` : ""} · Bấm format trong lịch sử để tải`,
        duration: 3000,
      });
      // Reset upload zone — sẵn sàng cho file tiếp theo
      setFile(null);
      setError("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Không tạo được phụ đề.";
      setError(msg);
      toast.error("Tạo phụ đề thất bại", { description: msg });
    } finally {
      setBusy(false);
      setBusyStep("");
    }
  }

  function redownloadHistoryItem(item: SttHistoryItem, f: SttFormat) {
    const baseName = item.fileName.replace(/\.[^.]+$/, "");
    const finalSegs = item.translatedSegments
      ? item.segments.map((s, i) => ({ ...s, text: item.translatedSegments![i] || s.text || "" }))
      : item.segments;
    const finalText = item.translatedSegments
      ? finalSegs.map((s) => (s.text || "").trim()).filter(Boolean).join("\n")
      : item.fullText;
    const fileLang = item.translatedTo || item.language;
    const downloadName = item.translatedTo ? `${baseName}_${item.translatedTo}` : baseName;
    downloadSttFile(f, finalSegs, { language: fileLang, text: finalText }, downloadName);
    toast.success(`Đã tải .${f}`, { duration: 1500 });
  }

  function copyHistoryText(item: SttHistoryItem) {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(item.fullText);
    toast.success("Đã sao chép văn bản", { duration: 1500 });
  }

  return (
    <div className="grid min-h-[calc(100vh-88px)] gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
      <section className="flex flex-col gap-4">
        {/* HERO — Upload zone (sáng viền khi có file) */}
        <div
          className={`rounded-2xl border bg-card/60 shadow-sm transition ${
            file
              ? "border-primary/60 ring-2 ring-primary/20 shadow-primary/20"
              : "border-border/60"
          }`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
            <div className="inline-flex items-center gap-2.5">
              <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
                <FileUp className="h-3.5 w-3.5" />
              </div>
              <div>
                <div className="text-sm font-bold text-foreground">Tải file lên</div>
                <div className="text-[11px] text-muted-foreground">Audio / Video → phụ đề chuẩn ngành</div>
              </div>
            </div>
            {file && (
              <button
                type="button"
                onClick={() => setFile(null)}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                title="Bỏ file"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <label className="flex min-h-[28vh] cursor-pointer flex-col items-center justify-center gap-3 px-6 py-10 text-center text-sm text-muted-foreground hover:bg-muted/10">
            {file ? (
              <>
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-primary">
                  <Music2 className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-base font-bold text-foreground">{file.name}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type || "không rõ định dạng"}
                  </div>
                </div>
                <span className="rounded-md bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-primary">
                  Bấm để đổi file
                </span>
              </>
            ) : (
              <>
                <div className="grid h-14 w-14 place-items-center rounded-2xl border border-dashed border-primary/40 bg-background text-muted-foreground">
                  <Upload className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-base font-bold text-foreground">Kéo thả hoặc nhấp để chọn file</div>
                  <div className="mt-1 text-[11px] leading-5">
                    MP3 · WAV · M4A · OGG · FLAC · MP4 · MOV · MKV · WebM
                  </div>
                </div>
              </>
            )}
            <input
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>
        </div>

        {/* FORMAT — Định dạng xuất */}
        <div className="rounded-2xl border border-border/60 bg-card/60 shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
            <div className="inline-flex items-center gap-2.5">
              <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
                <FileText className="h-3.5 w-3.5" />
              </div>
              <div>
                <div className="text-sm font-bold text-foreground">Định dạng xuất</div>
                <div className="text-[11px] text-muted-foreground">
                  Chọn tối đa {STT_MAX_FORMATS} định dạng — mỗi run sẽ tạo các file đó
                </div>
              </div>
            </div>
            <span className="rounded-md bg-primary/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
              {formats.size}/{STT_MAX_FORMATS}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-5">
            {STT_FORMATS.map((f) => {
              const active = formats.has(f.key);
              const atCap = !active && formats.size >= STT_MAX_FORMATS;
              return (
                <button
                  key={f.key}
                  type="button"
                  disabled={atCap}
                  onClick={() => toggleFormat(f.key)}
                  className={`group relative flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                    active
                      ? "border-primary/60 bg-primary/10 ring-2 ring-primary/20"
                      : atCap
                      ? "border-border/40 bg-background opacity-40 cursor-not-allowed"
                      : "border-border/60 bg-background hover:border-border hover:bg-muted/20"
                  }`}
                  title={atCap ? `Đã đạt tối đa ${STT_MAX_FORMATS} định dạng` : f.hint}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className={`text-base font-black ${active ? "text-primary" : "text-foreground"}`}>
                      .{f.key}
                    </span>
                    {active && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                  </div>
                  <span className="text-[10px] leading-4 text-muted-foreground">{f.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* LANGUAGE — Source + Target + Translate */}
        <div className="rounded-2xl border border-border/60 bg-card/60 shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
            <div className="inline-flex items-center gap-2.5">
              <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
                <Globe className="h-3.5 w-3.5" />
              </div>
              <div>
                <div className="text-sm font-bold text-foreground">Ngôn ngữ &amp; Dịch</div>
                <div className="text-[11px] text-muted-foreground">
                  {translateOn
                    ? `${language === "auto" ? "Auto" : language.toUpperCase()} → ${translateTarget.toUpperCase()}`
                    : "Chỉ nhận diện văn bản gốc"}
                </div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={translateOn}
              onClick={() => setTranslateOn((v) => !v)}
              className={`inline-flex h-7 items-center gap-2 rounded-full border px-2 transition ${
                translateOn ? "border-primary/60 bg-primary/10" : "border-border/60 bg-background"
              }`}
            >
              <span className={`relative h-4 w-7 rounded-full transition ${translateOn ? "bg-primary" : "bg-muted"}`}>
                <span
                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${translateOn ? "left-[14px]" : "left-0.5"}`}
                />
              </span>
              <span className={`text-[11px] font-bold ${translateOn ? "text-primary" : "text-muted-foreground"}`}>
                {translateOn ? "Dịch BẬT" : "Dịch tắt"}
              </span>
            </button>
          </div>

          <div className="space-y-4 p-4">
            {/* Source / Target — custom picker với Globe icon */}
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Ngôn ngữ nguồn
                </span>
                <SttLangPicker value={language} onChange={setLanguage} includeAuto />
              </div>
              <div>
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Dịch sang
                </span>
                <SttLangPicker
                  value={translateTarget}
                  onChange={setTranslateTarget}
                  disabled={!translateOn}
                />
              </div>
            </div>

            {/* Engine + API key */}
            {translateOn && (
              <div className="rounded-xl border border-border/40 bg-muted/20 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Engine dịch
                  </span>
                  <span className="text-[10px] text-muted-foreground/70">
                    🔑 cần API key · ✓ miễn phí
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {STT_TRANSLATE_ENGINES.map((eng) => {
                    const active = translateEngine === eng.id;
                    return (
                      <button
                        key={eng.id}
                        type="button"
                        onClick={() => setTranslateEngine(eng.id)}
                        className={`group flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left transition ${
                          active
                            ? "border-primary/60 bg-primary/10"
                            : "border-border/60 bg-background hover:border-border"
                        }`}
                      >
                        <span className={`text-xs font-bold ${active ? "text-primary" : "text-foreground"}`}>
                          {eng.label}
                        </span>
                        <span className="ml-auto text-[10px]">{eng.needsKey ? "🔑" : "✓"}</span>
                      </button>
                    );
                  })}
                </div>
                {needsApiKey && (
                  <div className="mt-3">
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      API key cho {currentEngine?.label}
                    </span>
                    <input
                      type="password"
                      value={translateApiKey}
                      onChange={(e) => setTranslateApiKey(e.target.value)}
                      placeholder="Dán API key vào đây..."
                      className={`h-10 w-full rounded-lg border bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-primary/50 ${
                        apiKeyMissing ? "border-amber-500/60" : "border-border/60"
                      }`}
                    />
                  </div>
                )}
                {apiKeyMissing && (
                  <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      Engine <strong>{currentEngine?.label}</strong> cần API key. Nhập key hoặc chuyển sang Google miễn phí.
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* CTA — Action button */}
        <button
          onClick={runTranscribe}
          disabled={busy || !file || apiKeyMissing}
          className="inline-flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-foreground text-sm font-black text-background shadow-lg transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
        >
          {busy ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>
                {busyStep === "transcribing" ? "Đang nhận diện văn bản..." :
                 busyStep === "translating" ? `Đang dịch sang ${translateTarget.toUpperCase()}...` :
                 "Đang xử lý..."}
              </span>
            </>
          ) : !file ? (
            <>
              <FileUp className="h-5 w-5" />
              <span>Tải file lên trước</span>
            </>
          ) : (
            <>
              <Sparkles className="h-5 w-5" />
              <span>{translateOn ? "Chuyển đổi + Dịch" : "Bắt đầu chuyển đổi"}</span>
              <ChevronRight className="h-5 w-5 opacity-70" />
            </>
          )}
        </button>
      </section>

      <aside className="sticky top-[72px] flex h-[calc(100vh-88px)] flex-col rounded-2xl border border-border/60 bg-card/70 shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <div className="inline-flex items-center gap-2.5">
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
              <Clock className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-sm font-bold text-foreground">Lịch sử</div>
              <div className="text-[11px] text-muted-foreground">{history.length} bản phụ đề</div>
            </div>
          </div>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Xoá toàn bộ ${history.length} mục lịch sử?`)) clearHistory();
              }}
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
              title="Xoá lịch sử"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2.5">
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {busy && (
            <div className="rainbow-frame p-[10px]">
              <div className="relative z-[2] flex items-center gap-3 rounded-[10px] bg-card/95 p-3 backdrop-blur">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-foreground">
                    {busyStep === "transcribing" ? "Đang nhận diện văn bản..." :
                     busyStep === "translating" ? `Đang dịch sang ${translateTarget.toUpperCase()}...` :
                     "Đang xử lý..."}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{file?.name}</div>
                </div>
              </div>
            </div>
          )}

          {history.length === 0 && !busy && (
            <div className="flex min-h-72 items-center justify-center rounded-2xl border border-dashed border-border/60 bg-background/35 p-8 text-center">
              <div>
                <FileText className="mx-auto h-9 w-9 text-muted-foreground/50" />
                <p className="mt-3 text-sm font-bold">Chưa có lịch sử</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Mỗi lần chuyển đổi sẽ được lưu tại đây
                </p>
              </div>
            </div>
          )}

          {history.map((item) => {
            const expanded = expandedId === item.id;
            const langCode = resolveLangCode(item.language || "");
            const langMeta = langCode ? LANGUAGE_META[langCode] : null;
            const trMeta = item.translatedTo ? LANGUAGE_META[item.translatedTo] : null;
            const date = new Date(item.createdAt);
            return (
              <div
                key={item.id}
                className="rounded-xl border border-border/60 bg-background/45 p-3 transition hover:border-border"
              >
                {/* Header */}
                <div className="flex items-start gap-2">
                  <div className="flex flex-wrap gap-1">
                    {item.formats.map((f) => (
                      <span
                        key={f}
                        className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-primary"
                      >
                        .{f}
                      </span>
                    ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold text-foreground" title={item.fileName}>
                      {item.fileName}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>{langMeta?.flag || "🌐"} {langMeta?.native || item.language || "—"}</span>
                      {trMeta && (
                        <>
                          <ChevronRight className="h-2.5 w-2.5" />
                          <span className="text-primary">{trMeta.flag} {trMeta.native}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteHistoryItem(item.id)}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                    title="Xoá"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>

                {/* Stats */}
                <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="font-mono">{item.segments.length} đoạn</span>
                  <span>·</span>
                  <span className="font-mono">{sttPadTime(item.totalDuration).split(",")[0]}</span>
                  <span>·</span>
                  <span className="font-mono">{date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>

                {/* Actions: tải lại tất cả format đã tạo + copy + expand */}
                <div className="mt-2.5 flex items-center gap-1">
                  <div className="flex flex-1 flex-wrap gap-1">
                    {item.formats.map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => redownloadHistoryItem(item, f)}
                        className="inline-flex h-8 flex-1 min-w-[60px] items-center justify-center gap-1 rounded-md bg-foreground text-[11px] font-bold text-background hover:opacity-90"
                      >
                        <Download className="h-3 w-3" />
                        .{f}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyHistoryText(item)}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border/60 bg-background/60 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    title="Sao chép văn bản"
                  >
                    <FileText className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : item.id)}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border/60 bg-background/60 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    title={expanded ? "Thu gọn" : "Xem chi tiết"}
                  >
                    <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </button>
                </div>

                {/* Expanded — chỉ show văn bản + segments, KHÔNG có "xuất thêm
                    định dạng khác" để user không nhầm là tự sinh thêm file. */}
                {expanded && (
                  <div className="mt-3 space-y-2.5 border-t border-border/40 pt-3">

                    {/* Full text */}
                    <div className="rounded-md bg-muted/30 p-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Văn bản
                      </div>
                      <p className="mt-1 max-h-[15vh] overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-foreground">
                        {item.fullText || "—"}
                      </p>
                    </div>

                    {/* Segments preview */}
                    {item.segments.length > 0 && (
                      <div>
                        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Phân đoạn ({item.segments.length})
                        </div>
                        <div className="max-h-[20vh] space-y-1 overflow-auto">
                          {item.segments.slice(0, 50).map((seg, i) => (
                            <div key={i} className="rounded bg-muted/30 px-2 py-1 text-[11px] leading-5">
                              <div className="flex gap-1.5">
                                <span className="shrink-0 font-mono text-[9px] text-muted-foreground tabular-nums">
                                  {sttPadTime(seg.start || 0).split(",")[0]}
                                </span>
                                <span className="flex-1 text-foreground">{seg.text}</span>
                              </div>
                              {item.translatedSegments?.[i] && (
                                <div className="mt-0.5 flex gap-1.5 border-t border-border/40 pt-0.5">
                                  <span className="shrink-0 text-[9px] text-primary/70">→</span>
                                  <span className="flex-1 italic text-primary">{item.translatedSegments[i]}</span>
                                </div>
                              )}
                            </div>
                          ))}
                          {item.segments.length > 50 && (
                            <div className="px-2 py-1 text-[10px] italic text-muted-foreground">
                              +{item.segments.length - 50} đoạn nữa (tải file để xem đầy đủ)
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

// ── DUBBING TAB ────────────────────────────────────────────────────────
// Map language code → backend lang name (theo desktop convention)
const DUB_LANG_MAP: Record<string, string> = {
  vi: "vietnamese", en: "english", zh: "chinese", ja: "japanese",
  ko: "korean", fr: "french", es: "spanish", de: "german",
  pt: "portuguese", ru: "russian", th: "thai", id: "indonesian",
};
const DUB_LANGS = Object.keys(DUB_LANG_MAP);

// Compact language picker cho Dubbing — hỗ trợ "auto" với Lucide Globe
function DubLangPicker({
  value,
  onChange,
  includeAuto,
  codes,
}: {
  value: string;
  onChange: (v: string) => void;
  includeAuto?: boolean;
  codes: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handler(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const isAuto = value === "auto";
  const meta = isAuto ? null : LANGUAGE_META[value];
  const allCodes = includeAuto ? ["auto", ...codes] : codes;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-11 w-full items-center justify-between gap-2 rounded-lg border bg-background px-3 text-left transition ${
          open ? "border-primary/60 ring-2 ring-primary/15" : "border-border/60 hover:border-border"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {isAuto ? (
            <Globe className="h-4 w-4 text-muted-foreground" />
          ) : meta ? (
            <span className="text-base leading-none">{meta.flag}</span>
          ) : (
            <Globe className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="truncate text-sm font-semibold text-foreground">
            {isAuto ? "Tự động phát hiện" : meta?.native || value.toUpperCase()}
          </span>
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-[280px] overflow-y-auto rounded-xl border border-border/60 bg-popover p-1 shadow-2xl">
          {allCodes.map((code) => {
            const codeIsAuto = code === "auto";
            const codeMeta = codeIsAuto ? null : LANGUAGE_META[code];
            const selected = code === value;
            return (
              <button
                key={code}
                type="button"
                onClick={() => {
                  onChange(code);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition ${
                  selected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted/50"
                }`}
              >
                {codeIsAuto ? (
                  <Globe className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <span className="text-base leading-none">{codeMeta?.flag || ""}</span>
                )}
                <span className="flex-1 truncate font-medium">
                  {codeIsAuto ? "Tự động phát hiện" : codeMeta?.native || code.toUpperCase()}
                </span>
                {selected && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Edge TTS name humanizer ──────────────────────────────────
// "vi-VN-NamMinhNeural" → "Nam Minh"
const EDGE_VOICE_DISPLAY_OVERRIDES: Record<string, string> = {
  "vi-VN-HoaiMyNeural": "Hoài My",
  "vi-VN-NamMinhNeural": "Nam Minh",
};
// Default voice cho từng gender khi slot để trống — match backend
// EDGE_VOICE_MALE_VI / EDGE_VOICE_FEMALE_VI trong dubbing_svc.py.
const EDGE_DEFAULT_BY_GENDER: Record<"male" | "female", string> = {
  male: "vi-VN-NamMinhNeural",
  female: "vi-VN-HoaiMyNeural",
};
function humanizeEdgeName(rawName: string | undefined | null): string {
  if (!rawName) return "";
  if (EDGE_VOICE_DISPLAY_OVERRIDES[rawName]) return EDGE_VOICE_DISPLAY_OVERRIDES[rawName];
  let s = rawName.replace(/Neural$/, "").trim();
  s = s.replace(/^[a-z]{2,3}-[A-Z]{2,4}-/, "");
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  return s;
}

// ── Voice slot helpers ───────────────────────────────────────
// Slot 0 = nam, slot 1 = nữ, slot 2+ = bất kỳ — match convention desktop.
function slotGenderHint(i: number): "male" | "female" | "any" {
  if (i === 0) return "male";
  if (i === 1) return "female";
  return "any";
}
function slotLabel(i: number, total: number): string {
  if (total === 1) return "Giọng đọc";
  const g = slotGenderHint(i);
  const tag = g === "male" ? "Nam" : g === "female" ? "Nữ" : "Bất kỳ";
  return `Giọng ${i + 1} · ${tag}`;
}

// ── Subtitle templates — match desktop SubtitleGroup ─────────
type SubStyleSnap = {
  font: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  textColor: string;
  outlineColor: string;
  outlineSize: number;
  bgColor: string;
  bgOpacity: number;
  shadow: number;
  position: "top" | "middle" | "bottom";
  margin: number;
};
const SUB_TEMPLATES: { id: string; name: string; desc: string; style: SubStyleSnap }[] = [
  {
    id: "netflix", name: "Netflix", desc: "Trắng đậm trên nền tối, viền mảnh",
    style: {
      font: "Inter", fontSize: 24, bold: true, italic: false,
      textColor: "#FFFFFF", outlineColor: "#000000", outlineSize: 1,
      bgColor: "#000000", bgOpacity: 70, shadow: 1,
      position: "bottom", margin: 40,
    },
  },
  {
    id: "tiktok", name: "TikTok", desc: "Vàng cam to, viền dày, không nền",
    style: {
      font: "Montserrat", fontSize: 28, bold: true, italic: false,
      textColor: "#FCD34D", outlineColor: "#000000", outlineSize: 3,
      bgColor: "#000000", bgOpacity: 0, shadow: 4,
      position: "bottom", margin: 60,
    },
  },
  {
    id: "news", name: "News", desc: "Băng đỏ trên cùng, kiểu bản tin",
    style: {
      font: "Roboto", fontSize: 20, bold: true, italic: false,
      textColor: "#FFFFFF", outlineColor: "#000000", outlineSize: 1,
      bgColor: "#DC2626", bgOpacity: 95, shadow: 0,
      position: "top", margin: 30,
    },
  },
  {
    id: "minimal", name: "Minimal", desc: "Tối giản, viền mỏng, không nền",
    style: {
      font: "Inter", fontSize: 22, bold: false, italic: false,
      textColor: "#FFFFFF", outlineColor: "#000000", outlineSize: 2,
      bgColor: "#000000", bgOpacity: 0, shadow: 3,
      position: "bottom", margin: 50,
    },
  },
  {
    id: "karaoke", name: "Karaoke", desc: "Tím nổi bật, viền trắng, kiểu lyrics",
    style: {
      font: "Be Vietnam Pro", fontSize: 30, bold: true, italic: false,
      textColor: "#A855F7", outlineColor: "#FFFFFF", outlineSize: 2,
      bgColor: "#000000", bgOpacity: 0, shadow: 4,
      position: "bottom", margin: 50,
    },
  },
];
const SUB_FONTS = ["Inter", "Roboto", "Montserrat", "Be Vietnam Pro", "Arial", "Times New Roman"];
const SUB_POSITIONS: { id: "top" | "middle" | "bottom"; label: string }[] = [
  { id: "top", label: "Trên cùng" },
  { id: "middle", label: "Giữa" },
  { id: "bottom", label: "Dưới cùng" },
];
const SUB_ANIMATIONS = [
  { id: "none", label: "Không hiệu ứng" },
  { id: "fade", label: "Mờ dần" },
  { id: "slide", label: "Trượt" },
  { id: "pop", label: "Bật lên" },
];

// Aspect ratio options — match desktop StudioDubbingHomeV2
const DUB_ASPECT_OPTIONS = [
  { id: "original", label: "Giữ nguyên" },
  { id: "16:9", label: "16:9" },
  { id: "9:16", label: "9:16" },
  { id: "1:1", label: "1:1" },
  { id: "4:3", label: "4:3" },
];
const DUB_CROP_MODES = [
  { id: "smart", label: "Thông minh", desc: "AI bám subject" },
  { id: "center", label: "Trung tâm", desc: "Cắt giữa khung" },
  { id: "letterbox", label: "Letterbox", desc: "Thêm thanh đen" },
];
const DUB_EMOTIONS = [
  { id: "normal", label: "Bình thường" },
  { id: "happy", label: "Vui vẻ" },
  { id: "sad", label: "Buồn" },
  { id: "angry", label: "Tức giận" },
  { id: "calm", label: "Bình tĩnh" },
  { id: "excited", label: "Hào hứng" },
];

// Map status → tiến trình (label + percent + running flag).
// Dùng cho card sidebar và logic polling.
const DUB_STATUS_MAP: Record<string, { label: string; pct: number; running: boolean; tone: "running" | "done" | "error" | "queued" }> = {
  created:      { label: "Đã tạo",         pct: 5,   running: true,  tone: "queued" },
  pending:      { label: "Hàng đợi",       pct: 5,   running: true,  tone: "queued" },
  queued:       { label: "Hàng đợi",       pct: 5,   running: true,  tone: "queued" },
  transcribing: { label: "Phiên âm",       pct: 25,  running: true,  tone: "running" },
  translating:  { label: "Đang dịch",      pct: 45,  running: true,  tone: "running" },
  editing:      { label: "Sinh giọng",     pct: 60,  running: true,  tone: "running" },
  generating:   { label: "Sinh giọng",     pct: 65,  running: true,  tone: "running" },
  tts:          { label: "Sinh giọng",     pct: 70,  running: true,  tone: "running" },
  exporting:    { label: "Render video",   pct: 85,  running: true,  tone: "running" },
  rendering:    { label: "Render video",   pct: 90,  running: true,  tone: "running" },
  processing:   { label: "Đang xử lý",     pct: 50,  running: true,  tone: "running" },
  running:      { label: "Đang xử lý",     pct: 50,  running: true,  tone: "running" },
  done:         { label: "Hoàn thành",     pct: 100, running: false, tone: "done" },
  completed:    { label: "Hoàn thành",     pct: 100, running: false, tone: "done" },
  error:        { label: "Lỗi",            pct: 0,   running: false, tone: "error" },
  failed:       { label: "Lỗi",            pct: 0,   running: false, tone: "error" },
  canceled:     { label: "Đã huỷ",         pct: 0,   running: false, tone: "error" },
};

function getDubStatus(p: DubbingListProject) {
  // Ưu tiên meta.status (filesystem — chi tiết hơn, "transcribing" / "exporting"…)
  // rồi fallback sang DB row.status.
  const meta = (p.meta || {}) as Record<string, unknown>;
  const metaStatus = typeof meta.status === "string" ? meta.status.toLowerCase() : "";
  const dbStatus = (p.status || "").toLowerCase();
  const key = metaStatus || dbStatus || "created";
  return DUB_STATUS_MAP[key] || { label: key, pct: 0, running: false, tone: "queued" as const };
}

function isProjectRunning(p: DubbingListProject) {
  return getDubStatus(p).running;
}

/**
 * Smooth progress hook — bar LUÔN bò liên tục, follow server cap.
 *
 *   - Continuous creep 0.3%/sec → bar không bao giờ đứng yên
 *   - Cap = min(99, server_pct + 10) → KHÔNG vượt quá xa server (max +10%)
 *   - Server pct cao hơn cur → catch-up nhanh trong 1.5s
 *   - Server báo DONE (100) → snap 100% ngay
 */
function useSmoothProgress(targetPct: number, isRunning: boolean) {
  const [displayPct, setDisplayPct] = useState(targetPct);
  const targetRef = useRef(targetPct);
  const runningRef = useRef(isRunning);

  useEffect(() => { targetRef.current = targetPct; }, [targetPct]);
  useEffect(() => { runningRef.current = isRunning; }, [isRunning]);

  useEffect(() => {
    if (!isRunning) return;
    let raf = 0;
    let lastT = performance.now();

    const step = (now: number) => {
      if (!runningRef.current) return;
      const dt = (now - lastT) / 1000;
      lastT = now;

      setDisplayPct((cur) => {
        const target = targetRef.current;
        // Cap: server + 10% buffer (max 99) — KHÔNG đi xa hơn server quá nhiều
        const cap = Math.min(99, target + 10);
        // Speed: catch-up khi xa target, base creep khi gần/qua target
        let speed = 0.3; // %/sec base creep
        if (cur < target) {
          const gap = target - cur;
          speed = Math.max(speed, gap / 1.5); // catch-up trong 1.5s
        }
        const next = cur + dt * speed;
        return Math.min(next, cap);
      });

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [isRunning]);

  if (targetPct >= 100) return 100;
  if (!isRunning) return targetPct;
  return displayPct;
}


/**
 * Project card với smooth animated progress bar + border pulse khi running.
 */
function DubProjectCard({
  project,
  onOpen,
  onDelete,
}: {
  project: DubbingListProject;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const st = getDubStatus(project);
  const tone = st.tone;
  const isDone = tone === "done";
  const isError = tone === "error";
  const isRunning = st.running;
  const date = project.created_at ? new Date(project.created_at) : null;
  const targetMeta = LANGUAGE_META[project.target_language || ""];
  const StatusIcon = isDone ? CheckCircle2 : isError ? AlertTriangle : isRunning ? Loader2 : Clock;
  const badgeColor = isDone
    ? "bg-emerald-500/15 text-emerald-500"
    : isError
      ? "bg-red-500/15 text-red-500"
      : isRunning
        ? "bg-primary/15 text-primary"
        : "bg-amber-500/15 text-amber-500";
  const barColor = isDone
    ? "bg-emerald-500"
    : isError
      ? "bg-red-500"
      : "bg-primary";
  const smoothPct = useSmoothProgress(st.pct, isRunning);
  const displayPct = isError ? 0 : smoothPct;

  // Card class: pulse-border khi running, emerald khi done
  const cardClass = isDone
    ? "border-emerald-500/30 hover:border-emerald-500/60 hover:bg-emerald-500/5 cursor-pointer"
    : isError
      ? "border-red-500/30 cursor-default"
      : isRunning
        ? "dub-running-card cursor-default"
        : "border-border/60 cursor-default";

  return (
    <div
      role={isDone ? "button" : undefined}
      tabIndex={isDone ? 0 : -1}
      aria-disabled={!isDone}
      onClick={() => isDone && onOpen()}
      onKeyDown={(e) => {
        if (isDone && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`group block w-full rounded-xl border bg-background/45 p-3 text-left transition ${cardClass}`}
    >
      <div className="flex items-start gap-2">
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
          isDone ? "bg-emerald-500/15 text-emerald-500" : "bg-muted/40 text-muted-foreground"
        }`}>
          <Film className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-bold text-foreground" title={project.title || project.video_filename || project.id}>
            {project.title || project.video_filename || `Dự án ${project.id.slice(0, 8)}`}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {targetMeta && <span>{targetMeta.flag} {targetMeta.native}</span>}
            {date && <span>· {date.toLocaleDateString("vi-VN")}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${badgeColor}`}
          >
            <StatusIcon className={`h-3 w-3 ${isRunning ? "animate-spin" : ""}`} />
            {st.label}
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onDelete();
              }
            }}
            className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded bg-background/60 text-muted-foreground/80 transition hover:bg-red-500/15 hover:text-red-500"
            title="Xoá dự án"
          >
            <Trash2 className="h-3 w-3" />
          </span>
        </div>
      </div>

      {/* Tiến trình — smooth animated, shimmer overlay khi running */}
      {!isError && (
        <div className="mt-2.5 space-y-1">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{isDone ? "Đã hoàn thành" : "Tiến trình"}</span>
            <span className="font-mono font-bold text-foreground">
              {Math.round(displayPct)}%
            </span>
          </div>
          <div className="relative h-1.5 overflow-hidden rounded-full bg-muted/40">
            <div
              className={`h-full ${barColor}`}
              style={{
                width: `${Math.max(0, Math.min(100, displayPct))}%`,
                transition: "none",
                willChange: "width",
              }}
            />
            {isRunning && <div className="dub-progress-shimmer" />}
          </div>
        </div>
      )}

      {isDone && (
        <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
          <Play className="h-3 w-3" />
          Bấm để xem & tải về
        </div>
      )}
    </div>
  );
}


function DubbingTab({ setActiveTab }: { setActiveTab: (t: Tab) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [sourceLang, setSourceLang] = useState(() => {
    if (typeof window === "undefined") return "auto";
    return localStorage.getItem("voxstudio:dub:source") || "auto";
  });
  const [targetLang, setTargetLang] = useState(() => {
    if (typeof window === "undefined") return "vi";
    return localStorage.getItem("voxstudio:dub:target") || "vi";
  });
  const [enableDubbing, setEnableDubbing] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("voxstudio:dub:enableDubbing") !== "false";
  });
  const [enableSubtitle, setEnableSubtitle] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("voxstudio:dub:enableSubtitle") !== "false";
  });
  const [voices, setVoices] = useState<Voice[]>([]);
  const [premiumVoices, setPremiumVoices] = useState<PremiumVoice[]>([]);
  const [edgeVoices, setEdgeVoices] = useState<EdgeVoice[]>([]);
  const [voiceId, setVoiceId] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("voxstudio:dub:voiceId") || "";
  });

  // ── Advanced: TTS engine ─────────────────────────────
  const [ttsEngine, setTtsEngine] = useState<"premium" | "standard">(() => {
    if (typeof window === "undefined") return "premium";
    return (localStorage.getItem("voxstudio:dub:ttsEngine") as "premium" | "standard") || "premium";
  });
  const [edgeVoice, setEdgeVoice] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("voxstudio:dub:edgeVoice") || "";
  });
  const [voiceCount, setVoiceCount] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    return Number(localStorage.getItem("voxstudio:dub:voiceCount") || "1") || 1;
  });
  // Multi-speaker slots — voice key cho từng slot 0..4. "" = default.
  // Khi voiceCount=1 thì dùng voiceId/edgeVoice ở trên (không dùng slots).
  const [voiceSlots, setVoiceSlots] = useState<string[]>(() => {
    if (typeof window === "undefined") return ["", "", "", "", ""];
    try {
      const raw = localStorage.getItem("voxstudio:dub:voiceSlots");
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          const out = ["", "", "", "", ""];
          for (let i = 0; i < Math.min(5, arr.length); i++) {
            out[i] = typeof arr[i] === "string" ? arr[i] : "";
          }
          return out;
        }
      }
    } catch {}
    return ["", "", "", "", ""];
  });
  // Slot index đang được edit qua VoiceLibraryModal. -1 = đang edit voice
  // chính (voiceId/edgeVoice cũ), >=0 = slot thứ N. null = modal đóng.
  const [editingSlot, setEditingSlot] = useState<number>(-1);
  const [defaultEmotion, setDefaultEmotion] = useState(() => {
    if (typeof window === "undefined") return "normal";
    return localStorage.getItem("voxstudio:dub:emotion") || "normal";
  });

  // ── Advanced: aspect / crop ─────────────────────────
  const [aspect, setAspect] = useState(() => {
    if (typeof window === "undefined") return "original";
    return localStorage.getItem("voxstudio:dub:aspect") || "original";
  });
  const [cropMode, setCropMode] = useState(() => {
    if (typeof window === "undefined") return "smart";
    return localStorage.getItem("voxstudio:dub:cropMode") || "smart";
  });

  // ── Advanced: audio mix ─────────────────────────────
  const [keepAccomp, setKeepAccomp] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("voxstudio:dub:keepAccomp") !== "false";
  });
  const [accompVolume, setAccompVolume] = useState<number>(() => {
    if (typeof window === "undefined") return 35;
    return Number(localStorage.getItem("voxstudio:dub:accompVolume") || "35") || 35;
  });
  const [keepOriginalVoice, setKeepOriginalVoice] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("voxstudio:dub:keepOriginalVoice") === "true";
  });
  const [originalVoiceVolume, setOriginalVoiceVolume] = useState<number>(() => {
    if (typeof window === "undefined") return 20;
    return Number(localStorage.getItem("voxstudio:dub:originalVoiceVolume") || "20") || 20;
  });

  // ── Advanced: auto features ─────────────────────────
  const [autoFontSize, setAutoFontSize] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("voxstudio:dub:autoFontSize") !== "false";
  });
  const [autoPace, setAutoPace] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("voxstudio:dub:autoPace") !== "false";
  });
  const [smartChunk, setSmartChunk] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("voxstudio:dub:smartChunk") !== "false";
  });
  const [highlightKeywords, setHighlightKeywords] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("voxstudio:dub:highlightKeywords") || "";
  });

  // ── Advanced: translate ─────────────────────────────
  const [translateEngine, setTranslateEngine] = useState(() => {
    if (typeof window === "undefined") return "google_free";
    return localStorage.getItem("voxstudio:dub:translateEngine") || "google_free";
  });
  // API key cho engine LLM/Cloud — share cùng key với SubtitleTab.
  const [translateApiKey, setTranslateApiKey] = useState(() => {
    if (typeof window === "undefined") return "";
    return (
      localStorage.getItem("voxstudio:dub:translateApiKey")
      || localStorage.getItem("voxstudio:stt:translateApiKey")
      || ""
    );
  });
  const [topicHint, setTopicHint] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("voxstudio:dub:topicHint") || "";
  });
  const [glossary, setGlossary] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("voxstudio:dub:glossary") || "";
  });

  // ── Visual Context (Pass-(-1)) — toggle nâng cao ──
  // Reuse engine + key đã chọn ở "Engine dịch" phía trên (đơn giản UX,
  // không bắt user nhập key 2 lần). Backend fallback tự handle.
  const [enableVisualContext, setEnableVisualContext] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("voxstudio:dub:enableVisualContext") === "true";
  });

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [voiceLibOpen, setVoiceLibOpen] = useState(false);

  // Chất lượng pipeline: "fast" (mặc định, nhanh) | "high" (chậm hơn ~2x,
  // chính xác hơn về timing & phân biệt giọng).
  const [qualityMode, setQualityMode] = useState<"fast" | "high">(() => {
    if (typeof window === "undefined") return "fast";
    return (localStorage.getItem("voxstudio:dub:qualityMode") as "fast" | "high") || "fast";
  });
  // Studio mixing on/off — apply pedalboard chain (gender EQ + de-esser +
  // loudness norm + master glue/limiter). Default ON.
  const [studioMix, setStudioMix] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("voxstudio:dub:studioMix") !== "false";
  });
  // Filter music/singing segments — pipeline tự skip lời hát/nhạc nền có lời.
  // Default ON cho video drama/movie có OST.
  const [filterMusic, setFilterMusic] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("voxstudio:dub:filterMusic") !== "false";
  });
  // Film genre — inject context-specific prompt cho LLM dịch
  const [filmGenre, setFilmGenre] = useState<string>(() => {
    if (typeof window === "undefined") return "auto";
    return localStorage.getItem("voxstudio:dub:filmGenre") || "auto";
  });

  // ── Subtitle style ─────────────────────────────────
  const [subTemplate, setSubTemplate] = useState(() => {
    if (typeof window === "undefined") return "netflix";
    return localStorage.getItem("voxstudio:dub:subTemplate") || "netflix";
  });
  const [subFont, setSubFont] = useState(() => {
    if (typeof window === "undefined") return "Inter";
    return localStorage.getItem("voxstudio:dub:subFont") || "Inter";
  });
  const [subFontSize, setSubFontSize] = useState<number>(() => {
    if (typeof window === "undefined") return 24;
    return Number(localStorage.getItem("voxstudio:dub:subFontSize") || "24") || 24;
  });
  const [subBold, setSubBold] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("voxstudio:dub:subBold") !== "false";
  });
  const [subItalic, setSubItalic] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("voxstudio:dub:subItalic") === "true";
  });
  const [subTextColor, setSubTextColor] = useState(() => {
    if (typeof window === "undefined") return "#FFFFFF";
    return localStorage.getItem("voxstudio:dub:subTextColor") || "#FFFFFF";
  });
  const [subOutlineColor, setSubOutlineColor] = useState(() => {
    if (typeof window === "undefined") return "#000000";
    return localStorage.getItem("voxstudio:dub:subOutlineColor") || "#000000";
  });
  const [subOutlineSize, setSubOutlineSize] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    return Number(localStorage.getItem("voxstudio:dub:subOutlineSize") || "1") || 1;
  });
  const [subBgColor, setSubBgColor] = useState(() => {
    if (typeof window === "undefined") return "#000000";
    return localStorage.getItem("voxstudio:dub:subBgColor") || "#000000";
  });
  const [subBgOpacity, setSubBgOpacity] = useState<number>(() => {
    if (typeof window === "undefined") return 70;
    return Number(localStorage.getItem("voxstudio:dub:subBgOpacity") || "70") || 0;
  });
  const [subShadow, setSubShadow] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    return Number(localStorage.getItem("voxstudio:dub:subShadow") || "1") || 0;
  });
  const [subPosition, setSubPosition] = useState<"top" | "middle" | "bottom">(() => {
    if (typeof window === "undefined") return "bottom";
    return (localStorage.getItem("voxstudio:dub:subPosition") as "top" | "middle" | "bottom") || "bottom";
  });
  const [subMargin, setSubMargin] = useState<number>(() => {
    if (typeof window === "undefined") return 40;
    return Number(localStorage.getItem("voxstudio:dub:subMargin") || "40") || 40;
  });
  const [subAnimation, setSubAnimation] = useState(() => {
    if (typeof window === "undefined") return "none";
    return localStorage.getItem("voxstudio:dub:subAnimation") || "none";
  });

  function applySubTemplate(id: string) {
    const tpl = SUB_TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    setSubTemplate(id);
    setSubFont(tpl.style.font);
    setSubFontSize(tpl.style.fontSize);
    setSubBold(tpl.style.bold);
    setSubItalic(tpl.style.italic);
    setSubTextColor(tpl.style.textColor);
    setSubOutlineColor(tpl.style.outlineColor);
    setSubOutlineSize(tpl.style.outlineSize);
    setSubBgColor(tpl.style.bgColor);
    setSubBgOpacity(tpl.style.bgOpacity);
    setSubShadow(tpl.style.shadow);
    setSubPosition(tpl.style.position);
    setSubMargin(tpl.style.margin);
  }
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<DubbingListProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  useEffect(() => {
    void Promise.allSettled([listVoices(), listPremiumVoices(), listEdgeVoices()]).then((items) => {
      const [user, premium, edge] = items;
      setVoices(user.status === "fulfilled" ? user.value.voices || [] : []);
      setPremiumVoices(premium.status === "fulfilled" ? premium.value.voices || [] : []);
      setEdgeVoices(edge.status === "fulfilled" ? edge.value.voices || [] : []);
    });
    void reloadProjects();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:source", sourceLang);
  }, [sourceLang]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:target", targetLang);
  }, [targetLang]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:enableDubbing", String(enableDubbing));
  }, [enableDubbing]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:enableSubtitle", String(enableSubtitle));
  }, [enableSubtitle]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:voiceId", voiceId);
  }, [voiceId]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:ttsEngine", ttsEngine);
  }, [ttsEngine]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:edgeVoice", edgeVoice);
  }, [edgeVoice]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:voiceCount", String(voiceCount));
  }, [voiceCount]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:voiceSlots", JSON.stringify(voiceSlots));
  }, [voiceSlots]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:emotion", defaultEmotion);
  }, [defaultEmotion]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:aspect", aspect);
  }, [aspect]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:cropMode", cropMode);
  }, [cropMode]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:keepAccomp", String(keepAccomp));
  }, [keepAccomp]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:accompVolume", String(accompVolume));
  }, [accompVolume]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:keepOriginalVoice", String(keepOriginalVoice));
  }, [keepOriginalVoice]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:originalVoiceVolume", String(originalVoiceVolume));
  }, [originalVoiceVolume]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:autoFontSize", String(autoFontSize));
  }, [autoFontSize]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:autoPace", String(autoPace));
  }, [autoPace]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:smartChunk", String(smartChunk));
  }, [smartChunk]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:highlightKeywords", highlightKeywords);
  }, [highlightKeywords]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:translateEngine", translateEngine);
  }, [translateEngine]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:translateApiKey", translateApiKey);
  }, [translateApiKey]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:topicHint", topicHint);
  }, [topicHint]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("voxstudio:dub:glossary", glossary);
  }, [glossary]);

  // Visual context persist (chỉ toggle — engine + key dùng chung với text)
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:enableVisualContext", String(enableVisualContext)); }, [enableVisualContext]);

  // Persist subtitle style
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:subTemplate", subTemplate); }, [subTemplate]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:subFont", subFont); }, [subFont]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:subFontSize", String(subFontSize)); }, [subFontSize]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:subBold", String(subBold)); }, [subBold]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:subItalic", String(subItalic)); }, [subItalic]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:subTextColor", subTextColor); }, [subTextColor]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:subOutlineColor", subOutlineColor); }, [subOutlineColor]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:subOutlineSize", String(subOutlineSize)); }, [subOutlineSize]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:subBgColor", subBgColor); }, [subBgColor]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:subBgOpacity", String(subBgOpacity)); }, [subBgOpacity]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:subShadow", String(subShadow)); }, [subShadow]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:subPosition", subPosition); }, [subPosition]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:subMargin", String(subMargin)); }, [subMargin]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:subAnimation", subAnimation); }, [subAnimation]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:qualityMode", qualityMode); }, [qualityMode]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:studioMix", String(studioMix)); }, [studioMix]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:filterMusic", String(filterMusic)); }, [filterMusic]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("voxstudio:dub:filmGenre", filmGenre); }, [filmGenre]);

  async function reloadProjects() {
    setLoadingProjects(true);
    try {
      const res = await listDubbingProjects(20, 0);
      setProjects(res.projects || []);
    } catch {
      // ignore — không phá UI
    } finally {
      setLoadingProjects(false);
    }
  }

  // Poll khi có dự án đang chạy (mỗi 3.5s). Stop khi tất cả done/error.
  useEffect(() => {
    const hasRunning = projects.some((p) => isProjectRunning(p));
    if (!hasRunning) return;
    const t = setInterval(() => { void reloadProjects(); }, 3500);
    return () => clearInterval(t);
  }, [projects]);

  const [viewerProjectId, setViewerProjectId] = useState<string | null>(null);

  const currentTranslateEngine = STT_TRANSLATE_ENGINES.find((e) => e.id === translateEngine);
  const translateNeedsKey = !!currentTranslateEngine?.needsKey;
  const translateKeyMissing = translateNeedsKey && !translateApiKey.trim();

  async function removeProject(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Xoá dự án này? Hành động không thể hoàn tác.")) return;
    try {
      await deleteDubbingProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      toast.success("Đã xoá dự án");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Không xoá được dự án.";
      toast.error("Xoá thất bại", { description: msg });
    }
  }

  const selectedVoice = useMemo(() => {
    if (ttsEngine === "standard") {
      const e = edgeVoices.find((v) => v.name === edgeVoice);
      return e ? { name: humanizeEdgeName(e.name), source: "edge" as const } : null;
    }
    if (!voiceId) return null;
    const u = voices.find((v) => v.id === voiceId);
    if (u) return { name: u.name, source: "user-clone" as const };
    const p = premiumVoices.find((v) => v.slug === voiceId);
    if (p) return { name: p.display_name, source: "premium-builtin" as const };
    return null;
  }, [ttsEngine, voiceId, edgeVoice, voices, premiumVoices, edgeVoices]);

  // Helper resolve slot voice key → display info (label + source).
  // Dùng cho cả multi-speaker slots.
  const resolveVoiceLabel = (key: string): { name: string; source: "edge" | "user-clone" | "premium-builtin" } | null => {
    if (!key) return null;
    if (ttsEngine === "standard") {
      const e = edgeVoices.find((v) => v.name === key);
      return e ? { name: humanizeEdgeName(e.name), source: "edge" } : null;
    }
    const u = voices.find((v) => v.id === key);
    if (u) return { name: u.name, source: "user-clone" };
    const p = premiumVoices.find((v) => v.slug === key);
    if (p) return { name: p.display_name, source: "premium-builtin" };
    return null;
  };

  function buildSubtitleStylePayload() {
    return {
      template: subTemplate,
      font_family: subFont,
      font_size: subFontSize,
      font_color: subTextColor,
      font_bold: subBold,
      font_italic: subItalic,
      bg_color: subBgColor,
      bg_opacity: subBgOpacity / 100,
      outline_color: subOutlineColor,
      outline_width: subOutlineSize,
      shadow_offset: subShadow,
      position: subPosition,
      margin_v: subMargin,
      animation: subAnimation,
    };
  }

  function buildDubSettingsPayload() {
    // Multi-speaker mode: gửi N slot đầu (theo voiceCount) cho CẢ Premium
    // và Edge. Backend _pick_edge_voice_for_segment giờ honor slots khi
    // voice_count > 1 → giọng nam/nữ tự đổi theo speaker.
    // Slot rỗng = "" → backend fallback gender-based default.
    const slotsForBackend = voiceCount > 1
      ? voiceSlots.slice(0, voiceCount).map((v) => v || "")
      : [];
    // Khi multi-speaker → KHÔNG gửi edge_voice global (để slot-based logic
    // chạy đúng). Single-voice mode mới gửi edge_voice override.
    const sendEdgeVoice = ttsEngine === "standard" && voiceCount === 1;
    return {
      tts_engine: ttsEngine === "premium" ? "omnivoice" : "edge",
      edge_voice: sendEdgeVoice ? (edgeVoice || null) : null,
      voice_id: ttsEngine === "premium" ? (voiceId || null) : null,
      voice_count: voiceCount,
      voice_slots: slotsForBackend,
      source_language_input: sourceLang === "auto" ? "auto" : (DUB_LANG_MAP[sourceLang] || sourceLang),
      target_language: DUB_LANG_MAP[targetLang] || targetLang,
      enable_dubbing: enableDubbing,
      enable_subtitle: enableSubtitle,
      aspect_ratio: aspect === "original" ? null : aspect,
      keep_accompaniment: keepAccomp,
      accompaniment_volume: accompVolume / 100,
      keep_original_voice: keepOriginalVoice,
      original_voice_volume: originalVoiceVolume / 100,
      crop_mode: cropMode,
      default_emotion: ttsEngine === "premium" ? defaultEmotion : null,
      auto_font_size: autoFontSize,
      auto_pace: autoPace,
      smart_chunk: smartChunk,
      highlight_keywords: highlightKeywords.trim(),
      translate_engine: translateEngine || "google_free",
      topic_hint: topicHint.trim(),
      glossary: glossary.trim(),
      quality_mode: qualityMode,
      studio_mix: studioMix,
      filter_music: filterMusic,
      film_genre: filmGenre,
      enable_visual_context: enableVisualContext,
      // visual_engine + visual_model bỏ trống → backend fallback dùng
      // translate engine + key đã set ở trên.
      visual_engine: null,
      visual_model: null,
    };
  }

  async function createProject() {
    setError("");
    if (!file) {
      setError("Chọn video trước khi tạo dự án lồng tiếng.");
      return;
    }
    if (!enableDubbing && !enableSubtitle) {
      setError("Bật ít nhất 1 trong 2: Tạo lồng tiếng / Tạo phụ đề.");
      return;
    }
    if (translateKeyMissing) {
      setError(
        `Engine dịch "${currentTranslateEngine?.label}" cần API key. Mở "Cài đặt nâng cao → Dịch" để nhập key, hoặc chuyển sang Google miễn phí.`,
      );
      toast.error("Thiếu API key", {
        description: `Engine ${currentTranslateEngine?.label} yêu cầu API key`,
      });
      setAdvancedOpen(true);
      return;
    }
    setBusy(true);
    setUploadPct(0);
    try {
      const targetName = DUB_LANG_MAP[targetLang] || targetLang;
      const sourceName = sourceLang === "auto" ? "auto" : (DUB_LANG_MAP[sourceLang] || sourceLang);
      const proj = await createDubbingProject({
        video: file,
        target_language: targetName,
        source_language: sourceName,
        voice_id: ttsEngine === "premium" ? (voiceId || null) : null,
        enable_dubbing: enableDubbing,
        enable_subtitle: enableSubtitle,
        onProgress: (pct) => setUploadPct(pct),
      });

      // Project đã tạo trên backend — STAY ở tab Lồng tiếng, project mới
      // hiện ở sidebar phải "Dự án gần đây" với progress card 0→100%.
      // Settings + autoDub chạy fire-and-forget ở background.
      setFile(null);
      setBusy(false);
      setUploadPct(0);
      void reloadProjects();
      toast.success("Đã tạo dự án lồng tiếng", {
        description: "Pipeline đang chạy nền — xem ở 'Dự án gần đây' bên phải.",
        duration: 3000,
      });

      // Background: apply settings + trigger pipeline (không block UI)
      void (async () => {
        try {
          await updateDubbingSettings(proj.id, buildDubSettingsPayload());
        } catch (settingsErr) {
          console.warn("[dubbing] update settings failed:", settingsErr);
        }
        if (enableSubtitle) {
          try {
            await updateSubtitleStyle(proj.id, buildSubtitleStylePayload());
          } catch (styleErr) {
            console.warn("[dubbing] update subtitle style failed:", styleErr);
          }
        }
        try {
          const engineMap: Record<string, string> = {
            google_free: "google",
            google_cloud: "google_cloud",
            deepl: "deepl",
            gemini: "gemini",
            openai: "openai",
            claude: "claude",
          };
          await startDubbingAutoDub(proj.id, {
            engine: engineMap[translateEngine] || "google",
            translate_api_key: translateNeedsKey ? translateApiKey.trim() : null,
            // Visual context: chỉ truyền toggle. Engine + key reuse từ text
            // translate (backend fallback tự handle).
            enable_visual_context: enableVisualContext,
            visual_engine: null,
            visual_model: null,
            visual_api_key: null,
          });
          void reloadProjects();
        } catch (autoErr) {
          const msg = autoErr instanceof Error ? autoErr.message : "Không khởi pipeline được.";
          console.error("[dubbing] auto-dub failed:", autoErr);
          toast.error("Không khởi được pipeline", { description: msg });
        }
      })();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Không tạo được dự án lồng tiếng.";
      setError(msg);
      toast.error("Tạo dự án thất bại", { description: msg });
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-88px)] gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
      <section className="flex flex-col gap-4">
        {/* HERO — Upload zone */}
        <div
          className={`rounded-2xl border bg-card/60 shadow-sm transition ${
            file ? "border-primary/60 ring-2 ring-primary/20" : "border-border/60"
          }`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
            <div className="inline-flex items-center gap-2.5">
              <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
                <Film className="h-3.5 w-3.5" />
              </div>
              <div>
                <div className="text-sm font-bold text-foreground">Video / Audio nguồn</div>
                <div className="text-[11px] text-muted-foreground">Pipeline: STT → Translate → TTS → Mux</div>
              </div>
            </div>
            {file && (
              <button
                type="button"
                onClick={() => setFile(null)}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                title="Bỏ file"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <label className="flex min-h-[28vh] cursor-pointer flex-col items-center justify-center gap-3 px-6 py-10 text-center text-sm text-muted-foreground hover:bg-muted/10">
            {file ? (
              <>
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-primary">
                  <Film className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-base font-bold text-foreground">{file.name}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(1)} MB · {file.type || "video/audio"}
                  </div>
                </div>
                <span className="rounded-md bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-primary">
                  Bấm để đổi file
                </span>
              </>
            ) : (
              <>
                <div className="grid h-14 w-14 place-items-center rounded-2xl border border-dashed border-primary/40 bg-background text-muted-foreground">
                  <Upload className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-base font-bold text-foreground">Kéo thả hoặc nhấp để chọn video</div>
                  <div className="mt-1 text-[11px] leading-5">
                    MP4 · MOV · MKV · AVI · WebM · MP3 · WAV
                  </div>
                </div>
              </>
            )}
            <input
              type="file"
              accept="video/*,audio/*"
              className="hidden"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>
        </div>

        {/* LANGUAGES */}
        <div className="rounded-2xl border border-border/60 bg-card/60 shadow-sm">
          <div className="flex items-center gap-2.5 border-b border-border/60 px-5 py-3">
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
              <Globe className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-sm font-bold text-foreground">Ngôn ngữ</div>
              <div className="text-[11px] text-muted-foreground">
                {sourceLang === "auto" ? "Auto" : sourceLang.toUpperCase()} → {targetLang.toUpperCase()}
              </div>
            </div>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-2">
            <div>
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Ngôn ngữ video gốc
              </span>
              <DubLangPicker value={sourceLang} onChange={setSourceLang} includeAuto codes={DUB_LANGS} />
            </div>
            <div>
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Lồng tiếng / phụ đề ngôn ngữ
              </span>
              <DubLangPicker value={targetLang} onChange={setTargetLang} codes={DUB_LANGS} />
            </div>
          </div>
        </div>

        {/* VOICE */}
        <div className="rounded-2xl border border-border/60 bg-card/60 shadow-sm">
          <div className="flex items-center gap-2.5 border-b border-border/60 px-5 py-3">
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
              <Mic2 className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-bold text-foreground">Giọng đọc</div>
              <div className="text-[11px] text-muted-foreground">
                {selectedVoice ? selectedVoice.name : "Tự động (giọng mặc định theo target)"}
              </div>
            </div>
          </div>
          <div className="space-y-3 p-4">
            {/* Chế độ — 1 giọng = thuyết minh, 2+ = lồng tiếng */}
            <div>
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Chế độ
              </span>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setVoiceCount(n)}
                    className={`h-9 flex-1 rounded-lg border text-sm font-bold transition ${
                      voiceCount === n
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border/60 bg-background text-muted-foreground hover:border-border"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {voiceCount === 1
                  ? "🎙️ Thuyết minh — 1 giọng đọc tất cả. AI vẫn phân tích nam/nữ để dịch chuẩn pronoun."
                  : `🎬 Lồng tiếng — ${voiceCount} giọng theo nhân vật, AI tự map nam/nữ → giọng tương ứng.`}
              </p>
            </div>

            {/* Chọn giọng — single mode (voiceCount = 1) */}
            {voiceCount === 1 && (
              <>
                <button
                  type="button"
                  onClick={() => { setEditingSlot(-1); setVoiceLibOpen(true); }}
                  className="flex h-12 w-full items-center justify-between gap-2 rounded-xl border border-border/60 bg-background px-3 text-left transition hover:border-primary/40"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                      <Mic2 className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-foreground">
                        {selectedVoice?.name || "Chọn giọng"}
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {selectedVoice
                          ? selectedVoice.source === "user-clone"
                            ? "Giọng clone của tôi"
                            : selectedVoice.source === "edge"
                              ? "Edge TTS"
                              : "VoxStudio · Premium"
                          : "Mặc định theo ngôn ngữ đích"}
                      </span>
                    </span>
                  </span>
                  <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-muted/40 px-2 text-[10px] font-bold uppercase text-muted-foreground">
                    <Folder className="h-3 w-3" />
                    Thư viện
                  </span>
                </button>
                <p className="text-[10px] text-muted-foreground">
                  💡 Video có cả nam và nữ? Chuyển <button
                    type="button"
                    onClick={() => setVoiceCount(2)}
                    className="font-bold text-primary underline-offset-2 hover:underline"
                  >sang 2 giọng</button> để pipeline tự đổi giọng theo speaker.
                </p>
              </>
            )}

            {/* Multi-speaker slots (voiceCount > 1) */}
            {voiceCount > 1 && (
              <div className="space-y-2">
                {Array.from({ length: voiceCount }).map((_, i) => {
                  const g = slotGenderHint(i);
                  const slotKey = voiceSlots[i] || "";
                  const info = resolveVoiceLabel(slotKey);
                  const tone = g === "male"
                    ? "bg-blue-500/15 text-blue-500"
                    : g === "female"
                      ? "bg-pink-500/15 text-pink-500"
                      : "bg-muted/40 text-muted-foreground";
                  // Khi slot trống, hiển thị giọng mặc định mà backend SẼ
                  // dùng — minh bạch hơn "Chưa chọn".
                  let displayName: string;
                  let displayHint: string;
                  if (info) {
                    displayName = info.name;
                    displayHint = info.source === "user-clone"
                      ? "Giọng clone của tôi"
                      : info.source === "edge"
                        ? "Edge TTS"
                        : "VoxStudio · Premium";
                  } else if (ttsEngine === "standard" && (g === "male" || g === "female")) {
                    // Edge TTS — backend fallback EDGE_VOICE_MALE_VI / FEMALE_VI cho VN
                    const defaultKey = EDGE_DEFAULT_BY_GENDER[g];
                    displayName = humanizeEdgeName(defaultKey);
                    displayHint = "Mặc định Edge TTS · Bấm để đổi";
                  } else {
                    displayName = "Tự động theo speaker";
                    displayHint = "Bấm để chọn giọng cụ thể";
                  }
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => { setEditingSlot(i); setVoiceLibOpen(true); }}
                      className="flex h-14 w-full items-center justify-between gap-2 rounded-xl border border-border/60 bg-background px-3 text-left transition hover:border-primary/40"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tone}`}>
                          <span className="text-[11px] font-black">{i + 1}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            {slotLabel(i, voiceCount)}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-bold text-foreground">
                              {displayName}
                            </span>
                            {!info && (
                              <span className="shrink-0 rounded bg-muted/40 px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">
                                Mặc định
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {displayHint}
                          </span>
                        </span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1">
                        {info && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              setVoiceSlots((prev) => {
                                const next = [...prev];
                                next[i] = "";
                                return next;
                              });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                setVoiceSlots((prev) => {
                                  const next = [...prev];
                                  next[i] = "";
                                  return next;
                                });
                              }
                            }}
                            className="grid h-7 w-7 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                            title="Bỏ chọn — về mặc định"
                          >
                            <X className="h-3 w-3" />
                          </span>
                        )}
                        <span className="inline-flex h-8 items-center gap-1 rounded-md bg-muted/40 px-2 text-[10px] font-bold uppercase text-muted-foreground">
                          <Folder className="h-3 w-3" />
                          {info ? "Đổi" : "Chọn"}
                        </span>
                      </span>
                    </button>
                  );
                })}
                <p className="text-[10px] text-muted-foreground">
                  💡 Slot trống = dùng giọng mặc định Edge TTS (Nam Minh / Hoài My).
                  Bấm slot để đổi sang giọng khác.
                </p>
              </div>
            )}
          </div>
        </div>

        <VoiceLibraryModal
          open={voiceLibOpen}
          onClose={() => setVoiceLibOpen(false)}
          engine={ttsEngine === "premium" ? "premium" : "cloud"}
          onEngineChange={(eng) => setTtsEngine(eng === "premium" ? "premium" : "standard")}
          premiumVoices={premiumVoices}
          userVoices={voices}
          edgeVoices={edgeVoices}
          selectedKey={
            editingSlot >= 0
              ? (voiceSlots[editingSlot] || "")
              : (ttsEngine === "premium" ? voiceId : edgeVoice)
          }
          onSelect={(key) => {
            if (editingSlot >= 0) {
              // Pick cho slot N — không động voiceId/edgeVoice chính
              setVoiceSlots((prev) => {
                const next = [...prev];
                next[editingSlot] = key;
                return next;
              });
            } else if (ttsEngine === "premium") {
              setVoiceId(key);
            } else {
              setEdgeVoice(key);
            }
          }}
          onCreateVoice={() => {
            setVoiceLibOpen(false);
            setActiveTab("saved-voices");
          }}
        />

        {/* ADVANCED SETTINGS — trigger (modal mở popup nổi lên) */}
        <button
          type="button"
          onClick={() => setAdvancedOpen(true)}
          className="flex w-full items-center justify-between gap-2.5 rounded-2xl border border-border/60 bg-card/60 px-5 py-3 text-left shadow-sm transition hover:border-primary/40 hover:bg-card"
        >
          <div className="flex items-center gap-2.5">
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
              <Wand2 className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-foreground">Cài đặt nâng cao</span>
                {qualityMode === "high" && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-primary">
                    <Sparkles className="h-2.5 w-2.5" />
                    Chính xác cao
                  </span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Chất lượng · Khung hình · Mix audio · Phụ đề · Auto · Dịch
              </div>
            </div>
          </div>
          <span className="inline-flex h-8 items-center gap-1 rounded-md bg-primary/10 px-3 text-[10px] font-bold uppercase tracking-wider text-primary">
            Mở <ChevronRight className="h-3 w-3" />
          </span>
        </button>

        <DubAdvancedModal
          open={advancedOpen}
          onClose={() => setAdvancedOpen(false)}
          // aspect
          aspect={aspect} setAspect={setAspect}
          cropMode={cropMode} setCropMode={setCropMode}
          // mix
          keepAccomp={keepAccomp} setKeepAccomp={setKeepAccomp}
          accompVolume={accompVolume} setAccompVolume={setAccompVolume}
          keepOriginalVoice={keepOriginalVoice} setKeepOriginalVoice={setKeepOriginalVoice}
          originalVoiceVolume={originalVoiceVolume} setOriginalVoiceVolume={setOriginalVoiceVolume}
          // emotion + auto + highlight
          defaultEmotion={defaultEmotion} setDefaultEmotion={setDefaultEmotion}
          autoFontSize={autoFontSize} setAutoFontSize={setAutoFontSize}
          autoPace={autoPace} setAutoPace={setAutoPace}
          smartChunk={smartChunk} setSmartChunk={setSmartChunk}
          highlightKeywords={highlightKeywords} setHighlightKeywords={setHighlightKeywords}
          // translate
          translateEngine={translateEngine} setTranslateEngine={setTranslateEngine}
          translateApiKey={translateApiKey} setTranslateApiKey={setTranslateApiKey}
          topicHint={topicHint} setTopicHint={setTopicHint}
          glossary={glossary} setGlossary={setGlossary}
          // visual context (Pass-(-1)) — chỉ toggle, reuse text engine + key
          enableVisualContext={enableVisualContext} setEnableVisualContext={setEnableVisualContext}
          // subtitle style
          subTemplate={subTemplate} applySubTemplate={applySubTemplate}
          subFont={subFont} setSubFont={setSubFont}
          subFontSize={subFontSize} setSubFontSize={setSubFontSize}
          subBold={subBold} setSubBold={setSubBold}
          subItalic={subItalic} setSubItalic={setSubItalic}
          subTextColor={subTextColor} setSubTextColor={setSubTextColor}
          subOutlineColor={subOutlineColor} setSubOutlineColor={setSubOutlineColor}
          subOutlineSize={subOutlineSize} setSubOutlineSize={setSubOutlineSize}
          subBgColor={subBgColor} setSubBgColor={setSubBgColor}
          subBgOpacity={subBgOpacity} setSubBgOpacity={setSubBgOpacity}
          subShadow={subShadow} setSubShadow={setSubShadow}
          subPosition={subPosition} setSubPosition={setSubPosition}
          subMargin={subMargin} setSubMargin={setSubMargin}
          subAnimation={subAnimation} setSubAnimation={setSubAnimation}
          qualityMode={qualityMode} setQualityMode={setQualityMode}
          studioMix={studioMix} setStudioMix={setStudioMix}
          filterMusic={filterMusic} setFilterMusic={setFilterMusic}
          filmGenre={filmGenre} setFilmGenre={setFilmGenre}
        />

        {/* OUTPUT TOGGLES */}
        <div className="rounded-2xl border border-border/60 bg-card/60 shadow-sm">
          <div className="flex items-center gap-2.5 border-b border-border/60 px-5 py-3">
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
              <SettingsIcon className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-sm font-bold text-foreground">Đầu ra</div>
              <div className="text-[11px] text-muted-foreground">Bật ít nhất 1 trong 2</div>
            </div>
          </div>
          <div className="grid gap-2 p-4 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setEnableDubbing((v) => !v)}
              className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${
                enableDubbing
                  ? "border-primary/60 bg-primary/10"
                  : "border-border/60 bg-background hover:border-border"
              }`}
            >
              <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${enableDubbing ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground"}`}>
                <Mic2 className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className={`flex items-center gap-2 text-sm font-bold ${enableDubbing ? "text-primary" : "text-foreground"}`}>
                  Tạo lồng tiếng
                  {enableDubbing && <CheckCircle2 className="h-3.5 w-3.5" />}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  Sinh audio mới + mux vào video
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setEnableSubtitle((v) => !v)}
              className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${
                enableSubtitle
                  ? "border-primary/60 bg-primary/10"
                  : "border-border/60 bg-background hover:border-border"
              }`}
            >
              <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${enableSubtitle ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground"}`}>
                <FileText className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className={`flex items-center gap-2 text-sm font-bold ${enableSubtitle ? "text-primary" : "text-foreground"}`}>
                  Tạo phụ đề
                  {enableSubtitle && <CheckCircle2 className="h-3.5 w-3.5" />}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  Burned-in + tải SRT/VTT riêng
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* CTA */}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        <button
          onClick={createProject}
          disabled={busy || !file || (!enableDubbing && !enableSubtitle)}
          className="relative inline-flex h-14 w-full items-center justify-center gap-3 overflow-hidden rounded-2xl bg-foreground text-sm font-black text-background shadow-lg transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-90 disabled:hover:scale-100"
        >
          {busy ? (
            <>
              {/* Progress fill — cho user thấy upload % thật, đỡ cảm giác app treo */}
              <span
                className="absolute inset-y-0 left-0 bg-primary/35 transition-[width] duration-150 ease-out"
                style={{ width: `${uploadPct}%` }}
              />
              <Loader2 className="relative z-10 h-5 w-5 animate-spin" />
              <span className="relative z-10">
                {uploadPct < 100
                  ? `Đang tải video lên... ${uploadPct}%`
                  : "Đang khởi tạo dự án..."}
              </span>
            </>
          ) : !file ? (
            <>
              <FileUp className="h-5 w-5" />
              <span>Tải video lên trước</span>
            </>
          ) : (
            <>
              <Mic2 className="h-5 w-5" />
              <span>Tạo dự án lồng tiếng</span>
              <ChevronRight className="h-5 w-5 opacity-70" />
            </>
          )}
        </button>
      </section>

      {/* PROJECT LIST SIDEBAR */}
      <aside className="sticky top-[72px] flex h-[calc(100vh-88px)] flex-col rounded-2xl border border-border/60 bg-card/70 shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <div className="inline-flex items-center gap-2.5">
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
              <Folder className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-sm font-bold text-foreground">Dự án gần đây</div>
              <div className="text-[11px] text-muted-foreground">{projects.length} dự án</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void reloadProjects()}
            disabled={loadingProjects}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
            title="Làm mới"
          >
            {loadingProjects ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {projects.length === 0 && !loadingProjects && (
            <div className="flex min-h-72 items-center justify-center rounded-2xl border border-dashed border-border/60 bg-background/35 p-8 text-center">
              <div>
                <Film className="mx-auto h-9 w-9 text-muted-foreground/50" />
                <p className="mt-3 text-sm font-bold">Chưa có dự án</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Dự án mới sẽ hiện tại đây
                </p>
              </div>
            </div>
          )}

          {projects.map((p) => (
            <DubProjectCard
              key={p.id}
              project={p}
              onOpen={() => setViewerProjectId(p.id)}
              onDelete={() => void removeProject(p.id)}
            />
          ))}
        </div>
      </aside>

      <DubProjectViewer
        projectId={viewerProjectId}
        onClose={() => setViewerProjectId(null)}
        project={projects.find((x) => x.id === viewerProjectId) || null}
      />
    </div>
  );
}

// ── DUB ADVANCED SETTINGS MODAL ──────────────────────────────────────
type DubAdvancedModalProps = {
  open: boolean;
  onClose: () => void;
  aspect: string; setAspect: (v: string) => void;
  cropMode: string; setCropMode: (v: string) => void;
  keepAccomp: boolean; setKeepAccomp: (v: boolean) => void;
  accompVolume: number; setAccompVolume: (v: number) => void;
  keepOriginalVoice: boolean; setKeepOriginalVoice: (v: boolean) => void;
  originalVoiceVolume: number; setOriginalVoiceVolume: (v: number) => void;
  defaultEmotion: string; setDefaultEmotion: (v: string) => void;
  autoFontSize: boolean; setAutoFontSize: (v: boolean) => void;
  autoPace: boolean; setAutoPace: (v: boolean) => void;
  smartChunk: boolean; setSmartChunk: (v: boolean) => void;
  highlightKeywords: string; setHighlightKeywords: (v: string) => void;
  translateEngine: string; setTranslateEngine: (v: string) => void;
  translateApiKey: string; setTranslateApiKey: (v: string) => void;
  topicHint: string; setTopicHint: (v: string) => void;
  glossary: string; setGlossary: (v: string) => void;
  // visual context (Pass-(-1))
  enableVisualContext: boolean; setEnableVisualContext: (v: boolean) => void;
  // subtitle
  subTemplate: string; applySubTemplate: (id: string) => void;
  subFont: string; setSubFont: (v: string) => void;
  subFontSize: number; setSubFontSize: (v: number) => void;
  subBold: boolean; setSubBold: (v: boolean) => void;
  subItalic: boolean; setSubItalic: (v: boolean) => void;
  subTextColor: string; setSubTextColor: (v: string) => void;
  subOutlineColor: string; setSubOutlineColor: (v: string) => void;
  subOutlineSize: number; setSubOutlineSize: (v: number) => void;
  subBgColor: string; setSubBgColor: (v: string) => void;
  subBgOpacity: number; setSubBgOpacity: (v: number) => void;
  subShadow: number; setSubShadow: (v: number) => void;
  subPosition: "top" | "middle" | "bottom"; setSubPosition: (v: "top" | "middle" | "bottom") => void;
  subMargin: number; setSubMargin: (v: number) => void;
  subAnimation: string; setSubAnimation: (v: string) => void;
  qualityMode: "fast" | "high"; setQualityMode: (v: "fast" | "high") => void;
  studioMix: boolean; setStudioMix: (v: boolean) => void;
  filterMusic: boolean; setFilterMusic: (v: boolean) => void;
  filmGenre: string; setFilmGenre: (v: string) => void;
};

function DubAdvancedModal(p: DubAdvancedModalProps) {
  const [tab, setTab] = useState<"quality" | "video" | "subtitle" | "audio" | "auto" | "translate">("quality");
  const [keysManagerOpen, setKeysManagerOpen] = useState(false);
  const mounted = useClientMounted();

  useEffect(() => {
    if (!p.open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") p.onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [p]);

  if (!mounted || !p.open) return null;

  const TABS = [
    { id: "quality" as const, label: "Chất lượng", icon: ShieldCheck, desc: "Độ chính xác pipeline" },
    { id: "video" as const, label: "Video", icon: Film, desc: "Khung hình & cắt cảnh" },
    { id: "subtitle" as const, label: "Phụ đề", icon: FileText, desc: "Mẫu, font, màu, vị trí" },
    { id: "audio" as const, label: "Mix audio", icon: Music2, desc: "Nhạc nền · giọng gốc" },
    { id: "auto" as const, label: "Tự động", icon: Sparkles, desc: "Auto pace · highlight" },
    { id: "translate" as const, label: "Dịch", icon: Repeat, desc: "Engine · ngữ cảnh" },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={p.onClose}
      />

      <div className="relative z-10 flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-border/60 bg-card shadow-2xl">
        {/* HEADER */}
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
              <Wand2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-bold text-foreground">Cài đặt nâng cao</div>
              <div className="text-xs text-muted-foreground">Tinh chỉnh pipeline lồng tiếng & phụ đề</div>
            </div>
          </div>
          <button
            type="button"
            onClick={p.onClose}
            className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            title="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* BODY: side-tabs + content */}
        <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr]">
          <nav className="flex flex-col gap-1 overflow-y-auto border-r border-border/60 bg-background/40 p-3">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition ${
                    active
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  }`}
                >
                  <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${active ? "bg-primary text-primary-foreground" : "bg-muted/40"}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`text-xs font-bold ${active ? "text-primary" : "text-foreground"}`}>{t.label}</div>
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{t.desc}</div>
                  </div>
                </button>
              );
            })}
          </nav>

          <div className="min-h-0 overflow-y-auto p-6">
            {tab === "quality" && (
              <div className="space-y-5">
                {/* HERO toggle card */}
                <div className={`relative overflow-hidden rounded-2xl border p-5 transition ${
                  p.qualityMode === "high"
                    ? "border-primary/60 bg-gradient-to-br from-primary/10 via-primary/5 to-background"
                    : "border-border/60 bg-background/40"
                }`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${
                        p.qualityMode === "high" ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground"
                      }`}>
                        <Sparkles className="h-6 w-6" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-bold text-foreground">Chế độ chính xác cao</h3>
                          {p.qualityMode === "high" && (
                            <span className="rounded-md bg-primary px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-primary-foreground">
                              ĐANG BẬT
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Tăng độ chính xác cho phụ đề, timing và phân biệt giọng — bù lại
                          thời gian xử lý lâu hơn.
                        </p>
                      </div>
                    </div>
                    {/* Big toggle */}
                    <button
                      type="button"
                      onClick={() => p.setQualityMode(p.qualityMode === "high" ? "fast" : "high")}
                      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${
                        p.qualityMode === "high" ? "bg-primary" : "bg-muted"
                      }`}
                      role="switch"
                      aria-checked={p.qualityMode === "high"}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-background shadow-md transition ${
                        p.qualityMode === "high" ? "translate-x-6" : "translate-x-1"
                      }`} />
                    </button>
                  </div>
                </div>

                {/* So sánh 2 chế độ */}
                <div>
                  <div className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    So sánh chế độ
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {/* Fast mode card */}
                    <button
                      type="button"
                      onClick={() => p.setQualityMode("fast")}
                      className={`flex flex-col gap-2.5 rounded-xl border p-4 text-left transition ${
                        p.qualityMode === "fast"
                          ? "border-primary/60 bg-primary/5 ring-1 ring-primary/20"
                          : "border-border/60 bg-background hover:border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className={`grid h-8 w-8 place-items-center rounded-lg ${
                            p.qualityMode === "fast" ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground"
                          }`}>
                            <Zap className="h-4 w-4" />
                          </div>
                          <div className="text-sm font-bold text-foreground">Tiêu chuẩn</div>
                        </div>
                        {p.qualityMode === "fast" && <CheckCircle2 className="h-4 w-4 text-primary" />}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Nhanh, ổn định, đủ tốt cho phần lớn video.
                      </div>
                      <ul className="space-y-1 text-[11px] text-muted-foreground">
                        <li className="flex items-start gap-1.5">
                          <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                          <span>Thời gian xử lý: <strong className="text-foreground">~1×</strong></span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                          <span>Phụ đề: chính xác đến giây</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                          <span>Phân biệt nam/nữ: tốt</span>
                        </li>
                      </ul>
                    </button>

                    {/* High mode card */}
                    <button
                      type="button"
                      onClick={() => p.setQualityMode("high")}
                      className={`flex flex-col gap-2.5 rounded-xl border p-4 text-left transition ${
                        p.qualityMode === "high"
                          ? "border-primary/60 bg-primary/5 ring-1 ring-primary/20"
                          : "border-border/60 bg-background hover:border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className={`grid h-8 w-8 place-items-center rounded-lg ${
                            p.qualityMode === "high" ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground"
                          }`}>
                            <Sparkles className="h-4 w-4" />
                          </div>
                          <div className="text-sm font-bold text-foreground">Chính xác cao</div>
                        </div>
                        {p.qualityMode === "high" && <CheckCircle2 className="h-4 w-4 text-primary" />}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Pipeline AI nâng cao — chuẩn xác từng từ, từng nhân vật.
                      </div>
                      <ul className="space-y-1 text-[11px] text-muted-foreground">
                        <li className="flex items-start gap-1.5">
                          <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                          <span>Thời gian xử lý: <strong className="text-foreground">~2×</strong> (lâu hơn)</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                          <span>Phụ đề: <strong className="text-foreground">chính xác từng từ</strong></span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                          <span>Phân biệt nam/nữ: <strong className="text-foreground">rất tốt</strong></span>
                        </li>
                      </ul>
                    </button>
                  </div>
                </div>

                {/* Khi nào nên dùng */}
                <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <HelpCircle className="h-4 w-4 text-primary" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                      Khi nào nên bật chính xác cao?
                    </h4>
                  </div>
                  <ul className="space-y-1.5 text-[11px] leading-5 text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                      <span>Video có <strong className="text-foreground">2-3 nhân vật cùng giới</strong> (vd 2 nam) khó phân biệt</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                      <span>Phim/drama có <strong className="text-foreground">đoạn nói nhanh, ngắt câu nhiều</strong></span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                      <span>Cần phụ đề <strong className="text-foreground">khớp khẩu hình</strong> (lip-sync) chính xác</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                      <span>Sản phẩm cuối <strong className="text-foreground">phát hành cho khán giả</strong> (không phải draft)</span>
                    </li>
                  </ul>
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <p className="text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                      Chế độ này chậm hơn ~2× nhưng cho kết quả gần với chuẩn phim chiếu rạp.
                      Nên dùng cho video ngắn (≤ 5 phút) khi test lần đầu.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {tab === "video" && (
              <div className="space-y-5">
                <div>
                  <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Tỉ lệ khung hình</div>
                  <div className="flex flex-wrap gap-1.5">
                    {DUB_ASPECT_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => p.setAspect(opt.id)}
                        className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${
                          p.aspect === opt.id
                            ? "border-primary/60 bg-primary/10 text-primary"
                            : "border-border/60 bg-background text-muted-foreground hover:border-border"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {p.aspect !== "original" && (
                  <div>
                    <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Chế độ cắt cảnh</div>
                    <div className="grid gap-2 md:grid-cols-3">
                      {DUB_CROP_MODES.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => p.setCropMode(m.id)}
                          className={`rounded-xl border p-3 text-left transition ${
                            p.cropMode === m.id
                              ? "border-primary/60 bg-primary/10"
                              : "border-border/60 bg-background hover:border-border"
                          }`}
                        >
                          <div className={`text-sm font-bold ${p.cropMode === m.id ? "text-primary" : "text-foreground"}`}>{m.label}</div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">{m.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === "subtitle" && (
              <div className="space-y-5">
                {/* TEMPLATE PRESETS */}
                <div>
                  <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Mẫu phụ đề</div>
                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {SUB_TEMPLATES.map((tpl) => {
                      const active = p.subTemplate === tpl.id;
                      return (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => p.applySubTemplate(tpl.id)}
                          className={`group rounded-xl border p-3 text-left transition ${
                            active
                              ? "border-primary/60 bg-primary/10"
                              : "border-border/60 bg-background hover:border-border"
                          }`}
                        >
                          {/* Mini preview */}
                          <div
                            className="mb-2 flex h-12 items-end justify-center rounded-md border border-border/40 bg-gradient-to-br from-zinc-700 to-zinc-900"
                            style={{
                              alignItems: tpl.style.position === "top" ? "flex-start" : tpl.style.position === "middle" ? "center" : "flex-end",
                            }}
                          >
                            <span
                              className="mx-2 my-1 rounded px-1.5 py-0.5 text-[10px]"
                              style={{
                                color: tpl.style.textColor,
                                backgroundColor: tpl.style.bgOpacity > 0
                                  ? `${tpl.style.bgColor}${Math.round((tpl.style.bgOpacity / 100) * 255).toString(16).padStart(2, "0")}`
                                  : "transparent",
                                fontWeight: tpl.style.bold ? 700 : 500,
                                fontStyle: tpl.style.italic ? "italic" : "normal",
                                textShadow: `0 0 ${tpl.style.outlineSize}px ${tpl.style.outlineColor}, 0 0 ${tpl.style.outlineSize}px ${tpl.style.outlineColor}`,
                                fontFamily: tpl.style.font,
                              }}
                            >
                              Phụ đề mẫu
                            </span>
                          </div>
                          <div className={`flex items-center gap-1.5 text-sm font-bold ${active ? "text-primary" : "text-foreground"}`}>
                            {tpl.name}
                            {active && <CheckCircle2 className="h-3.5 w-3.5" />}
                          </div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">{tpl.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* FONT + SIZE */}
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Font</span>
                    <select
                      value={p.subFont}
                      onChange={(e) => p.setSubFont(e.target.value)}
                      className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm font-semibold outline-none focus:border-primary/50"
                    >
                      {SUB_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div>
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Cỡ chữ ({p.subFontSize}px)
                    </span>
                    <input
                      type="range" min={12} max={48} value={p.subFontSize}
                      onChange={(e) => p.setSubFontSize(Number(e.target.value))}
                      className="h-10 w-full accent-primary"
                    />
                  </div>
                </div>

                {/* BOLD / ITALIC */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => p.setSubBold(!p.subBold)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold transition ${
                      p.subBold ? "border-primary/60 bg-primary/10 text-primary" : "border-border/60 bg-background text-muted-foreground"
                    }`}
                  >
                    <span className="font-black">B</span> Đậm
                  </button>
                  <button
                    type="button"
                    onClick={() => p.setSubItalic(!p.subItalic)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold transition ${
                      p.subItalic ? "border-primary/60 bg-primary/10 text-primary" : "border-border/60 bg-background text-muted-foreground"
                    }`}
                  >
                    <span className="italic">I</span> Nghiêng
                  </button>
                </div>

                {/* COLORS */}
                <div className="grid gap-3 md:grid-cols-3">
                  <ColorField label="Màu chữ" value={p.subTextColor} onChange={p.setSubTextColor} />
                  <ColorField label="Màu viền" value={p.subOutlineColor} onChange={p.setSubOutlineColor} />
                  <ColorField label="Màu nền" value={p.subBgColor} onChange={p.setSubBgColor} />
                </div>

                {/* OUTLINE / BG OPACITY / SHADOW */}
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Độ viền ({p.subOutlineSize}px)
                    </span>
                    <input
                      type="range" min={0} max={6} step={0.5} value={p.subOutlineSize}
                      onChange={(e) => p.setSubOutlineSize(Number(e.target.value))}
                      className="h-9 w-full accent-primary"
                    />
                  </div>
                  <div>
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Độ mờ nền ({p.subBgOpacity}%)
                    </span>
                    <input
                      type="range" min={0} max={100} value={p.subBgOpacity}
                      onChange={(e) => p.setSubBgOpacity(Number(e.target.value))}
                      className="h-9 w-full accent-primary"
                    />
                  </div>
                  <div>
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Đổ bóng ({p.subShadow}px)
                    </span>
                    <input
                      type="range" min={0} max={8} value={p.subShadow}
                      onChange={(e) => p.setSubShadow(Number(e.target.value))}
                      className="h-9 w-full accent-primary"
                    />
                  </div>
                </div>

                {/* POSITION + MARGIN + ANIMATION */}
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Vị trí</span>
                    <div className="flex gap-1.5">
                      {SUB_POSITIONS.map((pos) => (
                        <button
                          key={pos.id}
                          type="button"
                          onClick={() => p.setSubPosition(pos.id)}
                          className={`h-9 flex-1 rounded-lg border text-xs font-bold transition ${
                            p.subPosition === pos.id
                              ? "border-primary/60 bg-primary/10 text-primary"
                              : "border-border/60 bg-background text-muted-foreground"
                          }`}
                        >
                          {pos.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Lề ({p.subMargin}px)
                    </span>
                    <input
                      type="range" min={0} max={120} value={p.subMargin}
                      onChange={(e) => p.setSubMargin(Number(e.target.value))}
                      className="h-9 w-full accent-primary"
                    />
                  </div>
                  <div>
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Hiệu ứng</span>
                    <select
                      value={p.subAnimation}
                      onChange={(e) => p.setSubAnimation(e.target.value)}
                      className="h-9 w-full rounded-lg border border-border/60 bg-background px-2 text-xs font-semibold outline-none focus:border-primary/50"
                    >
                      {SUB_ANIMATIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                    </select>
                  </div>
                </div>

                {/* PREVIEW */}
                <div>
                  <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Xem trước</div>
                  <div
                    className="relative flex h-32 overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-zinc-700 via-zinc-800 to-zinc-900"
                    style={{
                      alignItems: p.subPosition === "top" ? "flex-start" : p.subPosition === "middle" ? "center" : "flex-end",
                      justifyContent: "center",
                      paddingTop: p.subPosition === "top" ? p.subMargin / 4 : 0,
                      paddingBottom: p.subPosition === "bottom" ? p.subMargin / 4 : 0,
                    }}
                  >
                    <span
                      className="rounded px-2 py-1"
                      style={{
                        fontFamily: p.subFont,
                        fontSize: `${Math.max(10, p.subFontSize / 2)}px`,
                        fontWeight: p.subBold ? 700 : 500,
                        fontStyle: p.subItalic ? "italic" : "normal",
                        color: p.subTextColor,
                        backgroundColor: p.subBgOpacity > 0
                          ? `${p.subBgColor}${Math.round((p.subBgOpacity / 100) * 255).toString(16).padStart(2, "0")}`
                          : "transparent",
                        textShadow: `0 0 ${p.subOutlineSize}px ${p.subOutlineColor}, 0 ${p.subShadow}px ${Math.max(2, p.subShadow * 2)}px rgba(0,0,0,0.7)`,
                      }}
                    >
                      VoxStudio — phụ đề mẫu xem trước
                    </span>
                  </div>
                </div>
              </div>
            )}

            {tab === "audio" && (
              <div className="space-y-4">
                {/* STUDIO MIXING — hero toggle */}
                <div className={`relative overflow-hidden rounded-2xl border p-5 transition ${
                  p.studioMix
                    ? "border-primary/60 bg-gradient-to-br from-primary/10 via-primary/5 to-background"
                    : "border-border/60 bg-background/40"
                }`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${
                        p.studioMix ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground"
                      }`}>
                        <Music2 className="h-6 w-6" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-bold text-foreground">Mixing chuẩn phòng thu</h3>
                          {p.studioMix && (
                            <span className="rounded-md bg-primary px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-primary-foreground">
                              ĐANG BẬT
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Áp dụng EQ riêng cho nam/nữ + de-esser + cân bằng âm lượng + glue compressor
                          + true-peak limiter — voice nghe pro như chương trình truyền hình.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => p.setStudioMix(!p.studioMix)}
                      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${
                        p.studioMix ? "bg-primary" : "bg-muted"
                      }`}
                      role="switch"
                      aria-checked={p.studioMix}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-background shadow-md transition ${
                        p.studioMix ? "translate-x-6" : "translate-x-1"
                      }`} />
                    </button>
                  </div>

                  {/* Detail breakdown */}
                  {p.studioMix && (
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {[
                        { icon: Sparkles, title: "EQ theo giới tính", desc: "Nam ấm áp · Nữ trong sáng" },
                        { icon: Mic2, title: "De-esser tự động", desc: "Khử tiếng 's, sh' gắt" },
                        { icon: ShieldCheck, title: "Cân bằng âm lượng", desc: "Tất cả đoạn cùng level (-20 dBFS)" },
                        { icon: Zap, title: "Glue + limiter", desc: "Liền mạch, tránh clip ở -1 dBTP" },
                      ].map((item) => {
                        const Icon = item.icon;
                        return (
                          <div key={item.title} className="flex items-start gap-2 rounded-lg border border-border/40 bg-background/40 p-2.5">
                            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
                              <Icon className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-foreground">{item.title}</div>
                              <div className="mt-0.5 text-[10px] text-muted-foreground">{item.desc}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Hint when off */}
                {!p.studioMix && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <p className="text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                      Đang dùng audio thô từ Edge TTS. Voice có thể nghe nhỏ/lớn không đều, khô, hoặc gắt.
                      Bật lại &quot;Mixing chuẩn phòng thu&quot; để pipeline tự xử lý.
                    </p>
                  </div>
                )}

                <div className="border-t border-border/60 pt-4">
                  <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Mix với audio gốc của video
                  </div>
                </div>

                <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                  <label className="mb-2 flex cursor-pointer items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-foreground">Giữ nhạc nền (accompaniment)</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">Tách giọng + giữ nhạc nền/SFX gốc</div>
                    </div>
                    <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${p.keepAccomp ? "bg-primary" : "bg-muted"}`}>
                      <input type="checkbox" className="sr-only" checked={p.keepAccomp} onChange={(e) => p.setKeepAccomp(e.target.checked)} />
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition ${p.keepAccomp ? "translate-x-5" : "translate-x-0.5"}`} />
                    </span>
                  </label>
                  {p.keepAccomp && (
                    <div>
                      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Âm lượng nhạc nền</span>
                        <span className="font-mono font-bold text-foreground">{p.accompVolume}%</span>
                      </div>
                      <input type="range" min={0} max={100} value={p.accompVolume} onChange={(e) => p.setAccompVolume(Number(e.target.value))} className="w-full accent-primary" />
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                  <label className="mb-2 flex cursor-pointer items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-foreground">Giữ giọng gốc</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">Mix nhỏ giọng người gốc với giọng dub</div>
                    </div>
                    <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${p.keepOriginalVoice ? "bg-primary" : "bg-muted"}`}>
                      <input type="checkbox" className="sr-only" checked={p.keepOriginalVoice} onChange={(e) => p.setKeepOriginalVoice(e.target.checked)} />
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition ${p.keepOriginalVoice ? "translate-x-5" : "translate-x-0.5"}`} />
                    </span>
                  </label>
                  {p.keepOriginalVoice && (
                    <div>
                      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Âm lượng giọng gốc</span>
                        <span className="font-mono font-bold text-foreground">{p.originalVoiceVolume}%</span>
                      </div>
                      <input type="range" min={0} max={100} value={p.originalVoiceVolume} onChange={(e) => p.setOriginalVoiceVolume(Number(e.target.value))} className="w-full accent-primary" />
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === "auto" && (
              <div className="space-y-5">
                <div>
                  <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Cảm xúc mặc định (Premium)</div>
                  <select
                    value={p.defaultEmotion}
                    onChange={(e) => p.setDefaultEmotion(e.target.value)}
                    className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm font-semibold outline-none focus:border-primary/50"
                  >
                    {DUB_EMOTIONS.map((em) => <option key={em.id} value={em.id}>{em.label}</option>)}
                  </select>
                </div>

                <div>
                  <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Tự động tối ưu</div>
                  <div className="grid gap-2 md:grid-cols-3">
                    {[
                      { val: p.autoFontSize, set: p.setAutoFontSize, label: "Tự động cỡ chữ", desc: "Co giãn theo khung hình" },
                      { val: p.autoPace, set: p.setAutoPace, label: "Tự động nhịp đọc", desc: "Khớp thời lượng segment gốc" },
                      { val: p.smartChunk, set: p.setSmartChunk, label: "Chia câu thông minh", desc: "Cắt câu dài theo ngữ nghĩa" },
                    ].map((f) => (
                      <button
                        key={f.label}
                        type="button"
                        onClick={() => f.set(!f.val)}
                        className={`rounded-xl border p-3 text-left transition ${
                          f.val ? "border-primary/60 bg-primary/10" : "border-border/60 bg-background hover:border-border"
                        }`}
                      >
                        <div className={`flex items-center gap-1.5 text-xs font-bold ${f.val ? "text-primary" : "text-foreground"}`}>
                          {f.label}
                          {f.val && <CheckCircle2 className="h-3 w-3" />}
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">{f.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Từ khoá highlight (cách nhau dấu phẩy)
                  </span>
                  <input
                    type="text"
                    value={p.highlightKeywords}
                    onChange={(e) => p.setHighlightKeywords(e.target.value)}
                    placeholder="VoxStudio, AI, lồng tiếng"
                    className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:border-primary/50"
                  />
                </div>

                {/* MUSIC FILTER — hero toggle giống studio mix */}
                <div className={`relative overflow-hidden rounded-2xl border p-5 transition ${
                  p.filterMusic
                    ? "border-primary/60 bg-gradient-to-br from-primary/10 via-primary/5 to-background"
                    : "border-border/60 bg-background/40"
                }`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${
                        p.filterMusic ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground"
                      }`}>
                        <Music2 className="h-6 w-6" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-bold text-foreground">Tự động bỏ qua nhạc/lời hát</h3>
                          {p.filterMusic && (
                            <span className="rounded-md bg-primary px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-primary-foreground">
                              ĐANG BẬT
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Pipeline tự nhận biết đoạn nào là <strong className="text-foreground">thoại</strong>,
                          đoạn nào là <strong className="text-foreground">nhạc/lời hát</strong> — chỉ dub thoại,
                          giữ nguyên nhạc nền không lồng tiếng đè lên.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => p.setFilterMusic(!p.filterMusic)}
                      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${
                        p.filterMusic ? "bg-primary" : "bg-muted"
                      }`}
                      role="switch"
                      aria-checked={p.filterMusic}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-background shadow-md transition ${
                        p.filterMusic ? "translate-x-6" : "translate-x-1"
                      }`} />
                    </button>
                  </div>

                  {p.filterMusic && (
                    <div className="mt-4 space-y-1.5 text-[11px] leading-5 text-muted-foreground">
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                        <span>Whisper confidence check — bỏ qua đoạn no_speech_prob &gt; 55%</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                        <span>Phát hiện hát qua F0 stability (note giữ &gt; speech tone shift)</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                        <span>Lý tưởng cho phim/drama có OST, video TikTok có nhạc lyrics</span>
                      </div>
                    </div>
                  )}
                  {!p.filterMusic && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                      <p className="text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                        Pipeline sẽ dub MỌI đoạn detect được giọng người, kể cả lời bài hát trong nhạc nền.
                        Nên tắt nếu video chỉ có thoại không có nhạc.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === "translate" && (() => {
              const cur = STT_TRANSLATE_ENGINES.find((e) => e.id === p.translateEngine);
              const needsKey = !!cur?.needsKey;
              const keyMissing = needsKey && !p.translateApiKey.trim();
              return (
                <div className="space-y-4">
                  {/* Engine picker — grid card kèm chỉ thị 🔑/✓ */}
                  <div>
                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Engine dịch
                    </span>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {STT_TRANSLATE_ENGINES.map((eng) => {
                        const active = p.translateEngine === eng.id;
                        return (
                          <button
                            key={eng.id}
                            type="button"
                            onClick={() => p.setTranslateEngine(eng.id)}
                            className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                              active
                                ? "border-primary/60 bg-primary/10"
                                : "border-border/60 bg-background hover:border-border"
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className={`truncate text-sm font-bold ${active ? "text-primary" : "text-foreground"}`}>
                                {eng.label}
                              </div>
                              <div className="mt-0.5 text-[10px] text-muted-foreground">
                                {eng.needsKey ? "Cần API key" : "Không cần key"}
                              </div>
                            </div>
                            <span className="ml-auto text-base">{eng.needsKey ? "🔑" : "✓"}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Quản lý API keys server-side — recommended (BYOK lưu vĩnh viễn) */}
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold">🔑 Quản lý API Keys</div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
                          Lưu key 1 lần, dùng cho mọi project. Có nút test key valid không.
                          Key được mã hoá server-side.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setKeysManagerOpen(true)}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                      >
                        Mở quản lý
                      </button>
                    </div>
                  </div>

                  {/* API key inline — quick test mode (vẫn giữ cho user dùng key ad-hoc 1 lần) */}
                  {needsKey && (
                    <div>
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Hoặc nhập key trực tiếp (chỉ dùng lần này)
                      </span>
                      <input
                        type="password"
                        value={p.translateApiKey}
                        onChange={(e) => p.setTranslateApiKey(e.target.value)}
                        placeholder={
                          p.translateEngine === "deepl" ? "DeepL Auth Key (xxxxxx-xxxx-...)" :
                          p.translateEngine === "gemini" ? "Google AI Studio key (AIza...)" :
                          p.translateEngine === "openai" ? "sk-..." :
                          p.translateEngine === "claude" ? "sk-ant-..." :
                          "API key của provider"
                        }
                        autoComplete="off"
                        spellCheck={false}
                        className={`h-10 w-full rounded-lg border bg-background px-3 font-mono text-sm outline-none focus:border-primary/50 ${
                          keyMissing ? "border-amber-500/60" : "border-border/60"
                        }`}
                      />
                      {keyMissing ? (
                        <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                          <p className="text-[10px] text-amber-700 dark:text-amber-300">
                            Để trống cũng được nếu đã lưu key qua &quot;Quản lý API Keys&quot; phía trên.
                          </p>
                        </div>
                      ) : (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Để trống nếu đã lưu key server-side. Inline = quick test, không lưu.
                        </p>
                      )}
                    </div>
                  )}

                  <ApiKeysManager open={keysManagerOpen} onClose={() => setKeysManagerOpen(false)} />

                  {/* Film genre — important context for LLM */}
                  <div>
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Thể loại phim
                    </span>
                    <div className="grid gap-1.5 grid-cols-2 sm:grid-cols-3">
                      {[
                        { id: "auto", label: "🎬 Tự động", desc: "LLM tự suy" },
                        { id: "drama", label: "🎭 Chính kịch", desc: "Cảm xúc, đời thường" },
                        { id: "romance", label: "💖 Tình cảm", desc: "anh/em couple" },
                        { id: "action", label: "🥊 Hành động", desc: "Câu ngắn, mệnh lệnh" },
                        { id: "comedy", label: "😂 Hài", desc: "Slang, joke Việt" },
                        { id: "historical", label: "👑 Cổ trang", desc: "Trẫm/bệ hạ/thiếp" },
                        { id: "wuxia", label: "⚔️ Kiếm hiệp", desc: "Tại hạ/sư phụ" },
                        { id: "crime", label: "🔪 Hình sự", desc: "Mày/tao, thẳng" },
                        { id: "family", label: "👨‍👩‍👧 Gia đình", desc: "Vai vế họ hàng" },
                        { id: "horror", label: "👻 Kinh dị", desc: "Thì thầm, căng" },
                        { id: "anime", label: "🌸 Anime", desc: "Tớ/cậu, energetic" },
                        { id: "documentary", label: "🎙 Tài liệu", desc: "Tôi/các bạn" },
                        { id: "kpop_drama", label: "🇰🇷 K-drama", desc: "Oppa/noona" },
                        { id: "cdrama", label: "🇨🇳 C-drama", desc: "Phim Hoa ngữ" },
                      ].map((g) => {
                        const active = p.filmGenre === g.id;
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => p.setFilmGenre(g.id)}
                            className={`rounded-lg border p-2 text-left transition ${
                              active
                                ? "border-primary/60 bg-primary/10"
                                : "border-border/60 bg-background hover:border-border"
                            }`}
                          >
                            <div className={`text-xs font-bold ${active ? "text-primary" : "text-foreground"}`}>
                              {g.label}
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground truncate">
                              {g.desc}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      Inject context-specific guidance vào LLM prompt — đại từ + register
                      đúng thể loại phim. VD cổ trang sẽ dùng &quot;trẫm/bệ hạ&quot; thay vì
                      &quot;tôi/bạn&quot;.
                    </p>
                  </div>

                  {/* Topic hint */}
                  <div>
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Chủ đề / mô tả thêm (tuỳ chọn)
                    </span>
                    <input
                      type="text"
                      value={p.topicHint}
                      onChange={(e) => p.setTopicHint(e.target.value)}
                      placeholder="VD: Phim ngôn tình về CEO, drama tâm lý gia đình, vlog ẩm thực Hàn..."
                      className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:border-primary/50"
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Bổ sung context cho LLM ngoài thể loại — mô tả nội dung cụ thể.
                    </p>
                  </div>

                  {/* Glossary */}
                  <div>
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Glossary (từ điển dịch)
                    </span>
                    <textarea
                      value={p.glossary}
                      onChange={(e) => p.setGlossary(e.target.value)}
                      placeholder={"Mỗi dòng: Nguyên gốc -> Dịch\nVD:\nVoxStudio -> VoxStudio\nLLM -> Mô hình ngôn ngữ lớn"}
                      rows={5}
                      className="w-full resize-y rounded-lg border border-border/60 bg-background px-3 py-2 text-sm leading-5 outline-none focus:border-primary/50"
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      LLM engines tận dụng tốt nhất; Google Free chỉ áp dụng replace cuối pipeline.
                    </p>
                  </div>

                  {/* Visual Context (Pass-(-1)) — chỉ 1 toggle, reuse engine+key ở trên */}
                  <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-3">
                    <label className="flex cursor-pointer items-start gap-3 select-none">
                      <input
                        type="checkbox"
                        checked={p.enableVisualContext}
                        onChange={(e) => p.setEnableVisualContext(e.target.checked)}
                        className="mt-0.5 h-4 w-4 cursor-pointer"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-semibold">
                          🎬 Phân tích video (nâng cao)
                        </div>
                        <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                          AI xem 8 keyframe video → detect bối cảnh + nhân vật → giảm sai xưng hô.
                          Dùng <b>cùng engine + key</b> đã chọn ở &quot;Engine dịch&quot; phía trên,
                          tự động pick model PRO của engine đó (Gemini Pro / GPT-4o / Claude Sonnet 4.6).
                          Tốn phí API thêm khoảng $0.02-0.05/video.
                        </div>
                        {p.enableVisualContext && p.translateEngine === "google_free" && (
                          <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10.5px] text-amber-100/90">
                            ⚠️ &quot;Google miễn phí&quot; KHÔNG hỗ trợ visual. Hãy chọn Gemini / OpenAI / Claude để dùng visual.
                          </div>
                        )}
                      </div>
                    </label>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* FOOTER */}
        <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-background/40 px-6 py-3">
          <div className="text-[11px] text-muted-foreground">
            Cài đặt được lưu tự động. Áp dụng khi tạo dự án.
          </div>
          <button
            type="button"
            onClick={p.onClose}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-sm font-bold text-background hover:opacity-90"
          >
            <CheckCircle2 className="h-4 w-4" />
            Xong
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-background px-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-full flex-1 bg-transparent font-mono text-xs uppercase outline-none"
        />
      </div>
    </div>
  );
}

// ── DUB PROJECT VIEWER MODAL ─────────────────────────────────────────
// Mở khi user click project status=done. Stream video qua /export/stream
// bằng signed URL ngắn hạn để <video> stream trực tiếp, không buffer Blob MP4.
function DubProjectViewer({
  projectId,
  project,
  onClose,
}: {
  projectId: string | null;
  project: DubbingListProject | null;
  onClose: () => void;
}) {
  const mounted = useClientMounted();
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        setLoading(true);
        setError(null);
        setVideoUrl(null);
        return getDubbingResourceUrl(projectId, "export/stream");
      })
      .then((url) => {
        if (cancelled || !url) return;
        setVideoUrl(url);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Không tải được video.";
        setError(msg);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [projectId, onClose]);

  async function downloadAs(resource: "export/download" | `subtitles/${string}`, suggestedName: string) {
    if (!projectId) return;
    setDownloading(resource);
    try {
      const url = await getDubbingResourceUrl(projectId, resource);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Tải file thất bại.";
      toast.error("Tải thất bại", { description: msg });
    } finally {
      setDownloading(null);
    }
  }

  if (!mounted || !projectId) return null;

  const baseName = (project?.title || project?.video_filename || `voxstudio_${projectId.slice(0, 8)}`).replace(/\.[^.]+$/, "");

  return createPortal(
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-border/60 bg-card shadow-2xl">
        {/* HEADER */}
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/15 text-emerald-500">
              <Film className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-base font-bold text-foreground" title={baseName}>
                {baseName}
              </div>
              <div className="text-xs text-muted-foreground">
                Lồng tiếng hoàn tất · {project?.target_language || "—"}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            title="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* VIDEO */}
        <div className="bg-black">
          {loading && (
            <div className="flex aspect-video items-center justify-center text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          )}
          {error && (
            <div className="flex aspect-video flex-col items-center justify-center gap-2 px-6 text-center">
              <AlertTriangle className="h-8 w-8 text-red-500" />
              <p className="text-sm font-bold text-foreground">Không tải được video</p>
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
          )}
          {!loading && !error && videoUrl && (
            <video
              src={videoUrl}
              controls
              autoPlay
              className="aspect-video w-full"
            />
          )}
        </div>

        {/* DOWNLOAD ACTIONS */}
        <div className="space-y-3 border-t border-border/60 p-5">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Tải về
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <DownloadBtn
              icon={Film}
              label="Video MP4"
              sub="Lồng tiếng + phụ đề burn-in"
              loading={downloading === "export/download"}
              onClick={() => void downloadAs("export/download", `${baseName}_dubbed.mp4`)}
            />
            <DownloadBtn
              icon={FileText}
              label="Phụ đề SRT"
              sub="Subtitle riêng cho YouTube/CapCut"
              loading={downloading === "subtitles/srt"}
              onClick={() => void downloadAs("subtitles/srt", `${baseName}.srt`)}
            />
            <DownloadBtn
              icon={FileText}
              label="Phụ đề VTT"
              sub="Subtitle WebVTT cho web player"
              loading={downloading === "subtitles/vtt"}
              onClick={() => void downloadAs("subtitles/vtt", `${baseName}.vtt`)}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DownloadBtn({
  icon: Icon,
  label,
  sub,
  loading,
  onClick,
}: {
  icon: typeof Film;
  label: string;
  sub: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/40 p-3 text-left transition hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          {label}
          {!loading && <Download className="h-3 w-3 text-muted-foreground" />}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{sub}</div>
      </div>
    </button>
  );
}

// ── VOICE MODELS TAB ───────────────────────────────────────────────────
function VoiceModelsTab() {
  const [selected, setSelected] = useState("gpt-sovits");
  const [premiumVoices, setPremiumVoices] = useState<PremiumVoice[]>([]);
  const [edgeVoices, setEdgeVoices] = useState<EdgeVoice[]>([]);

  useEffect(() => {
    void Promise.allSettled([listPremiumVoices(), listEdgeVoices()]).then(([premium, edge]) => {
      setPremiumVoices(premium.status === "fulfilled" ? premium.value.voices || [] : []);
      setEdgeVoices(edge.status === "fulfilled" ? edge.value.voices || [] : []);
    });
  }, []);

  const models = [
    ...premiumVoices.map((voice) => ({
      id: voice.slug,
      name: voice.display_name,
      desc: voice.description || `VoxStudio · ${voice.language || "đa ngôn ngữ"} · ${voice.gender}`,
      badge: "VoxStudio",
    })),
    ...edgeVoices.slice(0, 12).map((voice) => ({
      id: voice.name,
      name: voice.name,
      desc: `Edge TTS · ${voice.locale} · ${voice.gender}`,
      badge: "Edge TTS",
    })),
  ];

  return (
    <div className="max-w-4xl">
      <PageTitle icon={Sparkles} title="Mẫu giọng nói AI" desc="Lựa chọn model AI phù hợp với nhu cầu của bạn" />

      <div className="space-y-3">
        {models.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-card/20 p-12 text-center text-sm text-muted-foreground">
            Chưa tải được danh sách giọng từ server.
          </div>
        ) : models.map((m) => {
          const active = selected === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setSelected(m.id)}
              className={`group w-full text-left rounded-xl border p-4 transition-all hover:border-primary/30 ${
                active
                  ? "border-primary/40 bg-primary/[0.05] ring-1 ring-primary/20"
                  : "border-border/60 bg-card/40"
              }`}
            >
              <div className="flex items-center gap-3">
                <CircleDot
                  className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground/40"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">{m.name}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      active ? "bg-primary/20 text-primary" : "bg-muted/40 text-muted-foreground"
                    }`}>
                      {m.badge}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{m.desc}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── SAVED VOICES TAB ───────────────────────────────────────────────────
// ── AUDIO TRIM HELPERS ─────────────────────────────────────────────────
const MAX_RAW_DURATION = 10; // giây — vượt quá phải cắt trước khi chạy STT

// ── IndexedDB cho preview audio blob (lưu permanent local) ──────────────
// Audio sinh 1 lần ở /voices/preview lúc clone → fetch + lưu blob → play sau này
// nhanh không gọi API. Blob persist qua refresh, không bị cache URL hết hạn.
const IDB_NAME = "voxstudio";
const IDB_STORE = "voice-previews";

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(voiceId: string, blob: Blob): Promise<void> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(blob, voiceId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(voiceId: string): Promise<Blob | null> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(voiceId);
    req.onsuccess = () => resolve((req.result as Blob) || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(voiceId: string): Promise<void> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(voiceId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Cache preview text (chỉ text + có blob hay không) — blob ở IndexedDB
const VOICE_PREVIEW_KEY = "voxstudio:voice-previews";
type PreviewEntry = { url: string; text?: string };

function loadPreviewMap(): Record<string, PreviewEntry | string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(VOICE_PREVIEW_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePreview(voiceId: string, url: string, text?: string) {
  if (typeof window === "undefined") return;
  try {
    const map = loadPreviewMap();
    map[voiceId] = { url, text };
    localStorage.setItem(VOICE_PREVIEW_KEY, JSON.stringify(map));
  } catch {}
}

function getPreview(voiceId: string): { url: string; text?: string } | null {
  const entry = loadPreviewMap()[voiceId];
  if (!entry) return null;
  if (typeof entry === "string") return { url: entry }; // backward compat với cache cũ
  return entry;
}

// Pad text ngắn để tránh model đọc quá nhanh + bị backend trim_silence cắt
// đầu/cuối. Quy tắc:
//  - text < 12 ký tự: thêm "..." 2 đầu (model có ~300ms silence để warmup)
//  - text < 25 ký tự: thêm dấu phẩy đầu + "..." cuối (~150ms breath)
//  - text < 50 ký tự: chỉ thêm "..." cuối (đảm bảo trail không cụt)
//  - text dài: giữ nguyên
function padShortText(text: string): string {
  const trimmed = text.trim();
  const len = trimmed.length;
  if (len < 12) return `... ${trimmed} ...`;
  if (len < 25) return `, ${trimmed} ...`;
  if (len < 50) return `${trimmed} ...`;
  return trimmed;
}

// Speed thông minh — interpolate mượt theo độ dài text:
//  ≤ 5 ký tự  : 0.7 base (rất chậm, mỗi từ rõ ràng)
//  ≤ 10       : ~0.78
//  ≤ 20       : ~0.85
//  ≤ 35       : ~0.92
//  ≤ 50       : ~0.97
//  ≥ 60       : base (không slow nữa)
function smartSpeed(text: string, base: number = 1.0): number {
  const len = text.trim().length;
  const MIN_LEN = 5;     // ngắn nhất → speed thấp nhất
  const MAX_LEN = 60;    // đủ dài → giữ speed gốc
  const MIN_SPEED_FACTOR = 0.7;
  if (len <= MIN_LEN) return Math.max(0.7, base * MIN_SPEED_FACTOR);
  if (len >= MAX_LEN) return base;
  // Linear interpolation từ MIN_SPEED_FACTOR lên 1.0 theo độ dài
  const t = (len - MIN_LEN) / (MAX_LEN - MIN_LEN);
  const factor = MIN_SPEED_FACTOR + t * (1 - MIN_SPEED_FACTOR);
  return Math.max(0.7, Math.min(1.0, base * factor));
}

// Chuẩn hoá text trước khi đưa vào TTS — đọc đúng URL/email/abbreviation
// + tránh để dấu "." trong URL chia nhỏ câu khi model tokenize.
function normalizeForTts(input: string): string {
  let s = input;
  // Pronounce TLD bằng tiếng Việt — LUÔN có "chấm" trước để model không
  // hiểu nhầm là kết câu (mọi TLD đều có "chấm" prefix).
  const tldMap: Record<string, string> = {
    vn: "chấm vê en",
    com: "chấm com",
    net: "chấm nét",
    org: "chấm o ơ gờ",
    info: "chấm in pho",
    edu: "chấm e đu",
    gov: "chấm gov",
    io: "chấm i ô",
    co: "chấm cô",
    app: "chấm áp",
    ai: "chấm ây ai",
  };
  for (const [tld, spoken] of Object.entries(tldMap)) {
    // .tld có thể đi kèm dấu chấm cuối câu — thay luôn cả 2 dấu để tránh
    // model split text thành "VoxStudio." + "vn." + "Chúc..."
    const re = new RegExp(`\\.${tld}\\b\\.?`, "gi");
    s = s.replace(re, ` ${spoken} `);
  }
  // Pattern còn sót "X.Y" 2-4 chữ cái → "X chấm Y"
  s = s.replace(/(\w)\.(\w{2,4})\b/g, (_, a, b) => `${a} chấm ${b}`);
  return s.replace(/\s+/g, " ").trim();
}

function parseVoiceTags(voice: { tags?: string[]; language?: string | null }): {
  langCode: string | null;
  gender: "male" | "female" | null;
  styles: string[];
} {
  const tags = voice.tags || [];
  const gender = tags.find((t) => t === "male" || t === "female") as "male" | "female" | undefined;
  const langCode = tags.map((t) => resolveLangCode(t)).find(Boolean) || resolveLangCode(voice.language || "") || null;
  const styles = tags.filter((t) => t !== "male" && t !== "female" && !resolveLangCode(t));
  return { langCode, gender: gender || null, styles };
}

function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * numCh * 2 + 44;
  const arr = new ArrayBuffer(length);
  const view = new DataView(arr);
  let offset = 0;
  function writeStr(s: string) {
    for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
  }
  writeStr("RIFF");
  view.setUint32(offset, length - 8, true); offset += 4;
  writeStr("WAVE");
  writeStr("fmt ");
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, numCh, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * numCh * 2, true); offset += 4;
  view.setUint16(offset, numCh * 2, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeStr("data");
  view.setUint32(offset, buffer.length * numCh * 2, true); offset += 4;
  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numCh; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([arr], { type: "audio/wav" });
}

async function sliceAudioFile(file: File, start: number, end: number): Promise<File> {
  const buf = await file.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    const sampleRate = decoded.sampleRate;
    const startSample = Math.max(0, Math.floor(start * sampleRate));
    const endSample = Math.min(decoded.length, Math.floor(end * sampleRate));
    const length = Math.max(1, endSample - startSample);
    const newBuffer = ctx.createBuffer(decoded.numberOfChannels, length, sampleRate);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const src = decoded.getChannelData(c);
      const dst = newBuffer.getChannelData(c);
      for (let i = 0; i < length; i++) dst[i] = src[startSample + i];
    }
    const wavBlob = audioBufferToWavBlob(newBuffer);
    const baseName = file.name.replace(/\.[^.]+$/, "");
    return new File([wavBlob], `${baseName}_trimmed.wav`, { type: "audio/wav" });
  } finally {
    void ctx.close();
  }
}

function fmtSec(s: number) {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function SavedVoicesTab({ setActiveTab }: { setActiveTab: (t: Tab) => void }) {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [name, setName] = useState("");
  const [originalText, setOriginalText] = useState(""); // Văn bản gốc — auto-fill từ STT
  const [previewText, setPreviewText] = useState(""); // Văn bản nghe trước — nhập tay
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [voiceLanguage, setVoiceLanguage] = useState("vi");
  const [voiceGender, setVoiceGender] = useState<"male" | "female" | "">("");
  const [transcribing, setTranscribing] = useState(false);
  const [detectingGender, setDetectingGender] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [audioDuration, setAudioDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [trimming, setTrimming] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const editorMounted = useClientMounted();
  const [waveform, setWaveform] = useState<number[]>([]);
  const [draggingHandle, setDraggingHandle] = useState<"start" | "end" | "pan" | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const trimBarRef = useRef<HTMLDivElement | null>(null);
  const transcribedForRef = useRef<File | null>(null); // Đánh dấu file đã được STT để không chạy lại khi mở modal lần 2
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [pendingPreviewIds, setPendingPreviewIds] = useState<Set<string>>(new Set());
  const previewVoiceAudioRef = useRef<HTMLAudioElement | null>(null);

  function markPreviewPending(id: string, pending: boolean) {
    setPendingPreviewIds((prev) => {
      const next = new Set(prev);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function confirmDeleteVoice(voice: Voice) {
    toast.custom(
      (t) => (
        <div className="rainbow-frame w-[360px] p-[10px] shadow-2xl">
          <div className="relative z-[2] flex items-start gap-3 rounded-[10px] bg-card/95 p-3.5 backdrop-blur">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-500/15">
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-foreground">
                Xoá giọng &quot;{voice.name}&quot;?
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Hành động không thể hoàn tác. File .pt và preview audio sẽ bị xoá.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    toast.dismiss(t);
                    try {
                      await deleteVoice(voice.id);
                      // xoá cache preview url + blob IndexedDB
                      try {
                        const map = loadPreviewMap();
                        delete map[voice.id];
                        localStorage.setItem(VOICE_PREVIEW_KEY, JSON.stringify(map));
                      } catch {}
                      try { await idbDelete(voice.id); } catch {}
                      toast.success(`Đã xoá "${voice.name}"`, { duration: 2000 });
                      reloadVoices();
                    } catch (e) {
                      toast.error("Xoá thất bại", {
                        description: e instanceof Error ? e.message : undefined,
                      });
                    }
                  }}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-red-500 px-2.5 text-[11px] font-bold text-white hover:bg-red-600"
                >
                  <Trash2 className="h-3 w-3" />
                  Xoá
                </button>
                <button
                  type="button"
                  onClick={() => toast.dismiss(t)}
                  className="inline-flex h-7 items-center rounded-md border border-border/60 bg-background/60 px-2.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                >
                  Huỷ
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => toast.dismiss(t)}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              aria-label="Đóng"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ),
      { duration: 8000 },
    );
  }

  function applyVoiceToTts(voice: Voice) {
    try {
      localStorage.setItem("voxstudio:tts:engine", "premium");
      localStorage.setItem("voxstudio:tts:voiceId", voice.id);
      const lang = parseVoiceTags(voice).langCode;
      if (lang) localStorage.setItem("voxstudio:tts:language", lang);
    } catch {}
    toast.success(`Áp dụng giọng "${voice.name}"`, {
      description: "Đã chuyển sang Văn bản thành giọng nói",
      duration: 2000,
    });
    setActiveTab("tts");
  }

  async function generatePreviewFor(voice: Voice): Promise<string> {
    const cachedText = getPreview(voice.id)?.text;
    const rawText = cachedText || voice.ref_text?.trim() || "Xin chào, đây là giọng đọc thử nghiệm.";
    const lang = parseVoiceTags(voice).langCode || "vi";
    const result = await generateTts({
      text: padShortText(normalizeForTts(rawText)).slice(0, 220),
      voice_id: voice.id,
      language: lang,
      speed: smartSpeed(rawText, 1),
      // Đầy đủ params giống TtsTab + tắt postprocess để không cắt khúc đầu
      num_step: 32,
      guidance_scale: 2,
      t_shift: 0.1,
      layer_penalty_factor: 5,
      position_temperature: 5,
      class_temperature: 0,
      denoise: true,
      preprocess_prompt: true,
      postprocess_output: false,
      audio_chunk_duration: 15,
    });
    if (!result.audio_url) throw new Error("Backend không trả audio_url");
    savePreview(voice.id, result.audio_url, rawText);
    return result.audio_url;
  }

  // Đơn giản: tạo Audio element, set src, play. Không retry/canplaythrough phức tạp.
  function playSimple(url: string): HTMLAudioElement {
    previewVoiceAudioRef.current?.pause();
    const audio = new Audio(mediaUrl(url));
    audio.onended = () => setPreviewingId(null);
    audio.onerror = () => {
      console.error("[preview] audio error", audio.error);
      setPreviewingId(null);
    };
    previewVoiceAudioRef.current = audio;
    void audio.play().catch((err) => {
      console.error("[preview] play() reject", err);
      setPreviewingId(null);
    });
    return audio;
  }

  async function previewVoice(voice: Voice) {
    // Toggle pause
    if (previewingId === voice.id) {
      previewVoiceAudioRef.current?.pause();
      setPreviewingId(null);
      return;
    }
    if (pendingPreviewIds.has(voice.id)) {
      toast.info("Đang sinh audio nghe thử, vui lòng đợi...", { duration: 1500 });
      return;
    }

    setPreviewingId(voice.id);

    // 1. Ưu tiên blob trong IndexedDB (sinh sẵn lúc clone) — phát instant
    try {
      const blob = await idbGet(voice.id);
      if (blob) {
        const objectUrl = URL.createObjectURL(blob);
        previewVoiceAudioRef.current?.pause();
        const audio = new Audio(objectUrl);
        audio.onended = () => {
          URL.revokeObjectURL(objectUrl);
          setPreviewingId(null);
        };
        audio.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          setPreviewingId(null);
          toast.error("File audio nghe thử bị lỗi");
        };
        previewVoiceAudioRef.current = audio;
        await audio.play();
        return;
      }
    } catch (e) {
      console.warn("[preview] IndexedDB fail, fallback URL", e);
    }

    // 2. Fallback URL cache (voice cũ trước khi có IndexedDB)
    const cachedUrl = getPreview(voice.id)?.url;
    if (cachedUrl) {
      playSimple(cachedUrl);
      return;
    }

    // 3. Cuối cùng — gen mới
    markPreviewPending(voice.id, true);
    try {
      const url = await generatePreviewFor(voice);
      markPreviewPending(voice.id, false);
      playSimple(url);
    } catch (e) {
      setPreviewingId(null);
      markPreviewPending(voice.id, false);
      toast.error("Không sinh được audio nghe thử", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  // Generate waveform peaks từ file audio (decode 1 lần)
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    (async () => {
      try {
        const buf = await file.arrayBuffer();
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        const decoded = await ctx.decodeAudioData(buf.slice(0));
        const data = decoded.getChannelData(0);
        const numBars = 100;
        const blockSize = Math.floor(data.length / numBars) || 1;
        const peaks: number[] = [];
        for (let i = 0; i < numBars; i++) {
          let max = 0;
          const start = i * blockSize;
          const end = Math.min(start + blockSize, data.length);
          for (let j = start; j < end; j++) {
            const v = Math.abs(data[j]);
            if (v > max) max = v;
          }
          peaks.push(max);
        }
        void ctx.close();
        if (!cancelled) setWaveform(peaks);
      } catch {
        if (!cancelled) setWaveform([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  function pointerToTime(clientX: number): number {
    const bar = trimBarRef.current;
    if (!bar || audioDuration <= 0) return 0;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * audioDuration;
  }

  // Khi audio quá dài, window trim chỉ cho phép tối đa 10s → kéo đầu này thì đầu kia tự đi theo
  const isOversize = audioDuration > MAX_RAW_DURATION;
  const panOriginRef = useRef<{ pointerT: number; trimStart: number; trimEnd: number } | null>(null);

  function handleBarPointerDown(e: React.PointerEvent<HTMLDivElement>, mode: "start" | "end" | "pan") {
    if (audioDuration <= 0) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDraggingHandle(mode);
    const t = pointerToTime(e.clientX);
    if (mode === "start") {
      const s = Math.max(0, Math.min(t, trimEnd - 0.1));
      let endLocal = trimEnd;
      if (isOversize && endLocal - s > MAX_RAW_DURATION) {
        endLocal = Math.min(audioDuration, s + MAX_RAW_DURATION);
        setTrimEnd(endLocal);
      }
      setTrimStart(s);
    } else if (mode === "end") {
      const endLocal = Math.min(audioDuration, Math.max(t, trimStart + 0.1));
      let s = trimStart;
      if (isOversize && endLocal - s > MAX_RAW_DURATION) {
        s = Math.max(0, endLocal - MAX_RAW_DURATION);
        setTrimStart(s);
      }
      setTrimEnd(endLocal);
    } else {
      // pan: lưu state ban đầu, di chuyển cả 2 đầu cùng lúc
      panOriginRef.current = { pointerT: t, trimStart, trimEnd };
    }
  }

  function handleBarPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingHandle) return;
    const t = pointerToTime(e.clientX);
    if (draggingHandle === "start") {
      const s = Math.max(0, Math.min(t, trimEnd - 0.1));
      if (isOversize && trimEnd - s > MAX_RAW_DURATION) {
        setTrimEnd(Math.min(audioDuration, s + MAX_RAW_DURATION));
      }
      setTrimStart(s);
    } else if (draggingHandle === "end") {
      const endLocal = Math.min(audioDuration, Math.max(t, trimStart + 0.1));
      if (isOversize && endLocal - trimStart > MAX_RAW_DURATION) {
        setTrimStart(Math.max(0, endLocal - MAX_RAW_DURATION));
      }
      setTrimEnd(endLocal);
    } else if (draggingHandle === "pan" && panOriginRef.current) {
      const origin = panOriginRef.current;
      const delta = t - origin.pointerT;
      const windowSize = origin.trimEnd - origin.trimStart;
      let newStart = origin.trimStart + delta;
      // Clamp window vào [0, audioDuration]
      if (newStart < 0) newStart = 0;
      if (newStart + windowSize > audioDuration) newStart = audioDuration - windowSize;
      setTrimStart(newStart);
      setTrimEnd(newStart + windowSize);
    }
  }

  function handleBarPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (draggingHandle) {
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      setDraggingHandle(null);
    }
  }

  useEffect(() => {
    if (!editorOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setEditorOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [editorOpen]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  // Pause khi vượt quá trimEnd
  useEffect(() => {
    if (!playing) return;
    const audio = previewAudioRef.current;
    if (!audio) return;
    if (currentTime >= trimEnd && trimEnd > 0) {
      audio.pause();
      audio.currentTime = trimStart;
      window.requestAnimationFrame(() => setCurrentTime(trimStart));
    }
  }, [currentTime, playing, trimEnd, trimStart]);

  function reloadVoices() {
    listVoices()
      .then((res) => setVoices(res.voices || []))
      .catch(() => setVoices([]));
  }

  useEffect(() => {
    listVoices()
      .then((res) => setVoices(res.voices || []))
      .catch(() => setVoices([]));
  }, []);

  async function detectFromAudio(audioFile: File) {
    setTranscribing(true);
    try {
      const result = await transcribeAudio({ audio: audioFile, language: "auto" });
      if (result.text) setOriginalText(result.text);
      if (result.language) {
        const code = resolveLangCode(result.language);
        if (code) setVoiceLanguage(code);
      }
      transcribedForRef.current = audioFile; // Đánh dấu file này đã STT xong
    } catch (e) {
      toast.error("Không nhận diện được audio — chọn ngôn ngữ thủ công", {
        description: e instanceof Error ? e.message : undefined,
        duration: 2400,
      });
    } finally {
      setTranscribing(false);
    }
  }

  async function detectGenderFromAudio(audioFile: File) {
    setDetectingGender(true);
    try {
      const arrayBuf = await audioFile.arrayBuffer();
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
      const data = decoded.getChannelData(0);
      const sampleRate = decoded.sampleRate;
      // Lấy 3-5 đoạn 30ms cách đều, autocorrelation tìm F0 → trung bình
      const windowSize = Math.floor(sampleRate * 0.03);
      const numWindows = Math.min(8, Math.floor(data.length / windowSize / 2));
      const pitches: number[] = [];
      for (let w = 0; w < numWindows; w++) {
        const offset = Math.floor(((w + 1) * data.length) / (numWindows + 1));
        const frame = data.subarray(offset, offset + windowSize);
        const minPeriod = Math.floor(sampleRate / 400); // 400Hz max
        const maxPeriod = Math.floor(sampleRate / 70); // 70Hz min
        let bestPeriod = 0;
        let bestCorr = 0;
        for (let p = minPeriod; p < Math.min(maxPeriod, frame.length); p++) {
          let corr = 0;
          for (let i = 0; i < frame.length - p; i++) corr += frame[i] * frame[i + p];
          if (corr > bestCorr) {
            bestCorr = corr;
            bestPeriod = p;
          }
        }
        if (bestPeriod > 0) pitches.push(sampleRate / bestPeriod);
      }
      void ctx.close();
      if (pitches.length === 0) {
        toast.error("Không phân tích được pitch — chọn thủ công");
        return;
      }
      pitches.sort((a, b) => a - b);
      const median = pitches[Math.floor(pitches.length / 2)];
      const gender: "male" | "female" = median < 165 ? "male" : "female";
      setVoiceGender(gender);
      toast.success(`Phát hiện giọng ${gender === "male" ? "Nam" : "Nữ"}`, {
        description: `F0 trung vị: ${median.toFixed(0)}Hz`,
        duration: 2400,
      });
    } catch (e) {
      toast.error("Không phân tích được audio", {
        description: e instanceof Error ? e.message : undefined,
        duration: 2400,
      });
    } finally {
      setDetectingGender(false);
    }
  }

  function handleFileChange(next: File | null) {
    setFile(next);
    setWaveform([]);
    setAudioDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setCurrentTime(0);
    setPlaying(false);
    setAudioUrl(next ? URL.createObjectURL(next) : "");
    if (next) {
      setEditorOpen(true);
      // Whisper sẽ chỉ chạy sau khi metadata load + duration ≤ 10s (xem useEffect)
    } else {
      setEditorOpen(false);
      transcribedForRef.current = null;
    }
  }

  async function runClone() {
    setError("");
    setMessage("");
    if (!name.trim()) {
      setError("Nhập tên giọng nói trước khi nhân bản.");
      return;
    }
    if (!file) {
      setError("Chọn file audio mẫu trước khi nhân bản.");
      return;
    }
    if (!consent) {
      setError("Bạn cần xác nhận có quyền sử dụng giọng nói này.");
      return;
    }
    setBusy(true);
    try {
      const tagParts = [voiceLanguage, voiceGender].filter(Boolean);
      // PHẢI gửi ref_text (Whisper frontend đã transcribe) — không gửi sẽ
      // crash backend `gpu_manager.create_voice_prompt` vì `whisper_pipe is
      // None` (backend chỉ load faster-whisper, gpu_manager dùng pipe cũ
      // chưa load → NoneType not callable).
      const refText = originalText.trim() || "Câu mẫu giọng nói.";
      const voice = await cloneVoice({
        audio: file,
        name: name.trim(),
        ref_text: refText,
        tags: tagParts.join(","),
        consent,
      });

      // 1. Clone xong → toast + reset form + reload list ngay
      toast.success(`Đã tạo giọng "${voice.name}"`, {
        description: "Đang sinh audio nghe thử trong nền...",
        duration: 3000,
      });
      const previewSample = previewText.trim() || originalText.trim() || "Xin chào, đây là giọng đọc thử nghiệm.";
      const previewLang = voiceLanguage || "vi";
      setName("");
      setOriginalText("");
      setPreviewText("");
      handleFileChange(null);
      setVoiceGender("");
      setBusy(false);
      reloadVoices();

      // 2. Background: dùng /voices/preview giống desktop — sinh audio nghe thử
      //    với chính file user vừa upload + previewText, KHÔNG dùng .pt mới
      //    (tránh bug duration_estimator). Fetch blob → lưu IndexedDB → Play
      //    sau này phát instant, không gọi API.
      markPreviewPending(voice.id, true);
      const previewFile = file;
      void (async () => {
        try {
          const previewRes = await previewVoiceClone({
            audio: previewFile,
            text: padShortText(normalizeForTts(previewSample)).slice(0, 220),
            ref_text: refText,
            language: previewLang,
            speed: smartSpeed(previewSample, 1),
            num_step: 32,
            guidance_scale: 2,
            t_shift: 0.1,
            layer_penalty_factor: 5,
            position_temperature: 5,
            class_temperature: 0,
            denoise: true,
            preprocess_prompt: true,
            // KEY FIX: tắt postprocess_output để model KHÔNG remove_silence với
            // lead_sil=100ms — phần này hay ăn mất "khúc đầu" của audio output
            // khi voice prompt còn mới/yếu (model warmup ~200-500ms ở đầu).
            postprocess_output: false,
            audio_chunk_duration: 15,
          });
          if (!previewRes.audio_url) throw new Error("Backend không trả audio_url");
          // Fetch blob ngay → lưu vào IndexedDB
          const audioRes = await fetch(mediaUrl(previewRes.audio_url));
          if (!audioRes.ok) throw new Error(`Tải audio thất bại: ${audioRes.status}`);
          const blob = await audioRes.blob();
          await idbPut(voice.id, blob);
          savePreview(voice.id, previewRes.audio_url, previewSample);
          toast.success(`Audio nghe thử của "${voice.name}" đã sẵn sàng`, { duration: 1800 });
        } catch (err) {
          toast.error(`Không sinh được audio nghe thử cho "${voice.name}"`, {
            description: err instanceof Error ? err.message : "Bấm Nghe thử để thử lại sau.",
            duration: 3000,
          });
        } finally {
          markPreviewPending(voice.id, false);
        }
      })();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không nhân bản được giọng nói.");
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-88px)] gap-4 xl:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
      <section className="flex flex-col rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm sm:p-6">
        <div className="mb-4 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground">
          <Wand2 className="h-4 w-4 text-primary" />
          Nhân bản giọng nói
        </div>

        <div className="space-y-4 rounded-2xl border border-primary/50 bg-background p-5">
          <SelectField label="Provider" value="VoxStudio" />
          <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Tên giọng nói *
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="VD: Giọng đọc tin tức"
              className="mt-2 h-11 w-full rounded-lg border border-border/60 bg-card/50 px-3 text-sm font-semibold outline-none focus:border-primary/50"
            />
          </label>

          <label className="flex min-h-52 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 bg-card/35 p-6 text-center text-sm text-muted-foreground hover:border-primary/50">
            <Upload className="h-7 w-7" />
            <span className="font-black text-foreground">{file ? file.name : "Kéo thả hoặc nhấp để chọn audio"}</span>
            <span className="text-xs leading-5">Khuyến nghị 10 giây - 5 phút, WAV/MP3/M4A sạch tiếng nền.</span>
            <span className="text-[11px] text-primary/80">Tự nhận diện ngôn ngữ khi tải lên</span>
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(event) => handleFileChange(event.target.files?.[0] || null)}
            />
          </label>

          {file && (
            <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                <Music2 className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold text-foreground">{file.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {audioDuration > 0 ? fmtSec(audioDuration) : "..."} · {(file.size / 1024).toFixed(0)} KB
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditorOpen(true)}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3 text-[11px] font-bold text-background hover:opacity-90"
              >
                <Wand2 className="h-3 w-3" />
                Chỉnh sửa
              </button>
              <button
                type="button"
                onClick={() => handleFileChange(null)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                aria-label="Bỏ audio"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Văn bản nghe trước
            </span>
            <textarea
              value={previewText}
              onChange={(event) => setPreviewText(event.target.value)}
              maxLength={500}
              placeholder="Nhập câu mẫu để giọng đọc thử..."
              className="mt-2 min-h-24 w-full resize-none rounded-lg border border-border/60 bg-card/50 px-3 py-3 text-sm outline-none focus:border-primary/50"
            />
            <span className="mt-1 block text-right text-[11px] text-muted-foreground">{previewText.length} / 500</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ngôn ngữ</span>
              <LanguageCombobox
                value={voiceLanguage}
                onChange={setVoiceLanguage}
                options={Object.keys(LANGUAGE_META)}
                engineLabel="Vox Premium"
                totalSupported={600}
                autoDetect={{
                  onClick: () => {
                    if (file) void detectFromAudio(file);
                    else toast.info("Tải audio mẫu trước để tự nhận diện", { duration: 1800 });
                  },
                  busy: transcribing,
                  disabled: !file,
                }}
              />
            </div>

            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Giới tính</span>
              <GenderSelect
                value={voiceGender}
                onChange={setVoiceGender}
                detecting={detectingGender}
              />
            </div>
          </div>

          <CheckboxRow label="Tôi có quyền sử dụng giọng nói này" checked={consent} onChange={setConsent} />
        </div>

        {(error || message) && (
          <div className={`mt-4 rounded-xl border px-3 py-2 text-sm ${error ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>
            {error || message}
          </div>
        )}

        <button onClick={runClone} disabled={busy} className="mt-4 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-foreground text-sm font-black text-background hover:scale-[1.01] disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          Nhân bản
        </button>
      </section>

      <aside className="flex min-h-[calc(100vh-88px)] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm">
        <div className="flex items-center justify-between border-b border-border/60 p-4">
          <div className="inline-flex items-center gap-2 text-sm font-black">
            <Music2 className="h-4 w-4" />
            Thư viện giọng nhân bản
            <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">{voices?.length ?? 0} giọng</span>
          </div>
          <button onClick={reloadVoices} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 text-xs font-bold text-muted-foreground hover:text-foreground">
            <RotateCcw className="h-3.5 w-3.5" />
            Làm mới
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!voices ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-background/35 p-12 text-center text-sm text-muted-foreground">Đang tải danh sách...</div>
          ) : voices.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-background/35 p-12 text-center">
              <Wand2 className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-bold">Chưa có voice clone nào</p>
              <p className="mt-1 text-xs text-muted-foreground">Tạo giọng mới bằng form bên trái.</p>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {voices.map((voice) => {
                const { langCode, gender, styles } = parseVoiceTags(voice);
                const meta = langCode ? LANGUAGE_META[langCode] : null;
                const date = voice.created_at ? new Date(voice.created_at) : null;
                const isPlaying = previewingId === voice.id;
                const isPending = pendingPreviewIds.has(voice.id);
                return (
                  <div
                    key={voice.id}
                    className={`flex flex-col gap-3 rounded-xl border bg-card p-4 transition ${
                      isPending
                        ? "voice-pulse-card"
                        : "border-border/60 hover:border-primary/40 hover:shadow-md"
                    }`}
                  >
                    {/* Header: cờ ngôn ngữ + tên + giới tính */}
                    <div className="flex items-start gap-3">
                      <div
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border/60 bg-background text-lg leading-none"
                        title={meta?.english || "Ngôn ngữ"}
                        aria-label={meta?.english || "Ngôn ngữ"}
                      >
                        {meta?.flag ?? <Globe className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="line-clamp-2 text-sm font-bold text-foreground">
                            {voice.name}
                          </h4>
                          {gender && (
                            <span
                              className={`inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-black ${
                                gender === "male"
                                  ? "bg-blue-500/15 text-blue-400"
                                  : "bg-pink-500/15 text-pink-400"
                              }`}
                              title={gender === "male" ? "Nam" : "Nữ"}
                            >
                              <span className="text-sm leading-none">{gender === "male" ? "♂" : "♀"}</span>
                              {gender === "male" ? "Nam" : "Nữ"}
                            </span>
                          )}
                        </div>
                        {meta && (
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {meta.native}
                            {date && <span className="ml-2 font-mono tabular-nums">· {date.toLocaleDateString("vi-VN")}</span>}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Văn bản nghe trước (text user nhập lúc clone, fallback ref_text) */}
                    {(() => {
                      const previewSnippet = getPreview(voice.id)?.text || voice.ref_text;
                      return (
                        <p className="line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-muted-foreground">
                          {previewSnippet ? `"${previewSnippet}"` : "Giọng do bạn nhân bản"}
                        </p>
                      );
                    })()}

                    {/* Tags */}
                    {styles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {styles.slice(0, 3).map((s, i) => (
                          <span
                            key={i}
                            className="rounded-md bg-muted/50 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Action row: Play + Delete */}
                    <div className="flex items-center gap-2 border-t border-border/40 pt-3">
                      {pendingPreviewIds.has(voice.id) ? (
                        <button
                          type="button"
                          disabled
                          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-primary/50 bg-primary/5 text-xs font-semibold text-primary"
                          title="Đang sinh audio nghe thử..."
                        >
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Đang tạo audio nghe thử...
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void previewVoice(voice)}
                          className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition ${
                            isPlaying
                              ? "border-primary/60 bg-primary/10 text-primary"
                              : "border-border/60 bg-background text-foreground hover:border-border hover:bg-muted/40"
                          }`}
                          title={isPlaying ? "Tạm dừng" : "Nghe thử"}
                        >
                          {isPlaying ? <PauseCircle className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                          {isPlaying ? "Tạm dừng" : "Nghe thử"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => confirmDeleteVoice(voice)}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-background text-muted-foreground transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-500"
                        title="Xoá giọng nhân bản này"
                        aria-label="Xoá giọng"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Áp dụng — full width ở dưới cùng */}
                    <button
                      type="button"
                      onClick={() => applyVoiceToTts(voice)}
                      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-foreground text-xs font-bold text-background transition hover:opacity-90"
                      title="Áp dụng + chuyển sang Văn bản thành giọng nói"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Áp dụng
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {editorMounted && editorOpen && file && audioUrl && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <button
            type="button"
            onClick={() => setEditorOpen(false)}
            aria-label="Đóng"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <div className="relative z-10 flex max-h-[92vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl">
            <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-4 py-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
                <Wand2 className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-foreground">Chỉnh sửa audio mẫu</div>
                <div className="truncate text-[11px] text-muted-foreground">{file.name}</div>
              </div>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                aria-label="Đóng"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {isOversize && (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <div className="min-w-0 flex-1 text-xs leading-5">
                    <div className="font-bold text-amber-200">
                      Audio dài {audioDuration.toFixed(1)}s — vượt giới hạn 10s
                    </div>
                    <div className="mt-0.5 text-amber-100/70">
                      Hãy kéo cửa sổ để chọn 10 giây, sau đó bấm <span className="font-bold">Áp dụng cắt</span>. Văn bản gốc sẽ tự nhận diện sau khi cắt.
                    </div>
                  </div>
                </div>
              )}

              {/* Audio player + trim trực tiếp trên waveform */}
              <div className="rounded-xl border border-border/60 bg-background p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const audio = previewAudioRef.current;
                        if (!audio) return;
                        if (playing) {
                          audio.pause();
                        } else {
                          if (audio.currentTime < trimStart || audio.currentTime >= trimEnd) {
                            audio.currentTime = trimStart;
                          }
                          void audio.play();
                        }
                      }}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-foreground text-background transition hover:scale-105"
                      aria-label={playing ? "Tạm dừng" : "Phát đoạn cắt"}
                    >
                      {playing ? <PauseCircle className="h-5 w-5" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
                    </button>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {fmtSec(currentTime)} / {fmtSec(audioDuration)}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Đoạn cắt: <span className="font-mono font-bold text-foreground">{fmtSec(trimEnd - trimStart)}</span>
                  </div>
                </div>

                {audioDuration > 0 && (
                  <>
                    {/* Trim bar - waveform + 2 handle kéo trực tiếp */}
                    <div
                      ref={trimBarRef}
                      className="relative h-28 w-full select-none rounded-lg bg-muted/50"
                      onPointerMove={handleBarPointerMove}
                      onPointerUp={handleBarPointerUp}
                      onPointerCancel={handleBarPointerUp}
                    >
                      {/* Waveform peaks */}
                      <div className="absolute inset-0 flex items-center gap-px px-1">
                        {(waveform.length > 0 ? waveform : Array.from({ length: 100 }, () => 0.3)).map((peak, i) => {
                          const t = (i / 100) * audioDuration;
                          const inRange = t >= trimStart && t <= trimEnd;
                          const h = Math.max(0.06, peak);
                          return (
                            <div
                              key={i}
                              className={`flex-1 rounded-sm transition-colors ${inRange ? "bg-primary" : "bg-muted-foreground/30"}`}
                              style={{ height: `${h * 100}%` }}
                            />
                          );
                        })}
                      </div>

                      {/* Vùng ngoài trim (overlay mờ — vẫn thấy waveform) */}
                      <div
                        className="pointer-events-none absolute inset-y-0 left-0 rounded-l-lg bg-black/30"
                        style={{ width: `${(trimStart / audioDuration) * 100}%` }}
                      />
                      <div
                        className="pointer-events-none absolute inset-y-0 right-0 rounded-r-lg bg-black/30"
                        style={{ width: `${(1 - trimEnd / audioDuration) * 100}%` }}
                      />

                      {/* Viền vàng quanh vùng cắt cho dễ nhận biết */}
                      <div
                        className="pointer-events-none absolute inset-y-0 border-y-2 border-primary/70"
                        style={{
                          left: `${(trimStart / audioDuration) * 100}%`,
                          width: `${((trimEnd - trimStart) / audioDuration) * 100}%`,
                        }}
                      />

                      {/* Vùng cắt - kéo cả khối (pan window) */}
                      <div
                        className={draggingHandle === "pan" ? "absolute inset-y-0 cursor-grabbing" : "absolute inset-y-0 cursor-grab"}
                        style={{
                          left: `${(trimStart / audioDuration) * 100}%`,
                          width: `${((trimEnd - trimStart) / audioDuration) * 100}%`,
                        }}
                        onPointerDown={(e) => handleBarPointerDown(e, "pan")}
                        title="Kéo để di chuyển cả đoạn"
                      />

                      {/* Playback cursor */}
                      {currentTime > 0 && (
                        <div
                          className="pointer-events-none absolute inset-y-0 w-0.5 bg-foreground"
                          style={{ left: `${(currentTime / audioDuration) * 100}%` }}
                        />
                      )}

                      {/* Handle BẮT ĐẦU */}
                      <div
                        onPointerDown={(e) => handleBarPointerDown(e, "start")}
                        className="absolute inset-y-0 z-10 -translate-x-1/2 cursor-ew-resize"
                        style={{ left: `${(trimStart / audioDuration) * 100}%`, width: 18 }}
                      >
                        <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-primary" />
                        <div className="absolute -top-1.5 left-1/2 h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-primary shadow-lg ring-2 ring-background" />
                        <div className="absolute -bottom-1.5 left-1/2 h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-primary shadow-lg ring-2 ring-background" />
                      </div>

                      {/* Handle KẾT THÚC */}
                      <div
                        onPointerDown={(e) => handleBarPointerDown(e, "end")}
                        className="absolute inset-y-0 z-10 -translate-x-1/2 cursor-ew-resize"
                        style={{ left: `${(trimEnd / audioDuration) * 100}%`, width: 18 }}
                      >
                        <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-primary" />
                        <div className="absolute -top-1.5 left-1/2 h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-primary shadow-lg ring-2 ring-background" />
                        <div className="absolute -bottom-1.5 left-1/2 h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-primary shadow-lg ring-2 ring-background" />
                      </div>
                    </div>

                    {/* Time labels dưới bar */}
                    <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono tabular-nums text-muted-foreground">
                      <span className="font-bold text-foreground">{fmtSec(trimStart)}</span>
                      <span>
                        {isOversize
                          ? `Cửa sổ tối đa ${MAX_RAW_DURATION}s — kéo để di chuyển`
                          : "↔ kéo 2 đầu để cắt"}
                      </span>
                      <span className="font-bold text-foreground">{fmtSec(trimEnd)}</span>
                    </div>

                    {(isOversize || trimStart > 0 || trimEnd < audioDuration) && (
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!file) return;
                            setTrimming(true);
                            try {
                              const trimmed = await sliceAudioFile(file, trimStart, trimEnd);
                              handleFileChange(trimmed);
                              // STT sẽ tự chạy qua onLoadedMetadata khi audio mới load (duration ≤ 10s)
                              toast.success(`Đã cắt audio (${fmtSec(trimEnd - trimStart)})`, { duration: 1800 });
                            } catch (e) {
                              toast.error("Cắt audio thất bại", {
                                description: e instanceof Error ? e.message : undefined,
                              });
                            } finally {
                              setTrimming(false);
                            }
                          }}
                          disabled={trimming}
                          className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-foreground text-xs font-bold text-background hover:opacity-90 disabled:opacity-60"
                        >
                          {trimming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                          Áp dụng cắt ({fmtSec(trimEnd - trimStart)})
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTrimStart(0);
                            setTrimEnd(isOversize ? MAX_RAW_DURATION : audioDuration);
                          }}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/60 bg-background/60 px-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Reset
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Văn bản gốc - auto fill từ transcript voice gốc (Whisper) */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Văn bản gốc
                  </span>
                  {transcribing && (
                    <span className="inline-flex items-center gap-1.5 text-[10px] text-primary">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Đang nhận diện...
                    </span>
                  )}
                </div>
                <textarea
                  value={originalText}
                  onChange={(e) => setOriginalText(e.target.value)}
                  maxLength={500}
                  placeholder={transcribing ? "Đang nhận diện văn bản từ audio..." : "Văn bản gốc của voice (tự điền) — bạn có thể chỉnh sửa..."}
                  disabled={transcribing}
                  className="min-h-[120px] w-full resize-none rounded-lg border border-border/60 bg-background px-3 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50 disabled:opacity-60"
                />
                <span className="mt-1 block text-right text-[11px] text-muted-foreground">
                  {originalText.length} / 500
                </span>
              </div>
            </div>

            {(() => {
              const xongDisabled = !!file && (transcribing || isOversize || audioDuration <= 0);
              const xongReason = transcribing
                ? "Vui lòng đợi nhận diện xong..."
                : isOversize
                ? "Hãy cắt audio xuống ≤ 10 giây trước"
                : audioDuration <= 0
                ? "Đang tải audio..."
                : "Hoàn tất chỉnh sửa";
              const statusText = transcribing
                ? "Đang nhận diện văn bản gốc..."
                : isOversize
                ? "Audio quá dài — hãy cắt trước khi xong"
                : audioDuration <= 0
                ? "Đang tải audio..."
                : "";
              return (
                <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 bg-muted/10 px-4 py-3">
                  {statusText ? (
                    <div className={`inline-flex items-center gap-2 text-[11px] font-semibold ${isOversize && !transcribing ? "text-amber-500" : "text-primary"}`}>
                      {transcribing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : isOversize ? (
                        <AlertTriangle className="h-3.5 w-3.5" />
                      ) : (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      {statusText}
                    </div>
                  ) : (
                    <span />
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditorOpen(false)}
                      className="inline-flex h-9 items-center rounded-lg border border-border/60 bg-background/60 px-4 text-xs font-semibold text-muted-foreground hover:text-foreground"
                    >
                      Đóng
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditorOpen(false)}
                      disabled={xongDisabled}
                      title={xongReason}
                      className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-4 text-xs font-bold text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Xong
                    </button>
                  </div>
                </div>
              );
            })()}

            <audio
              ref={previewAudioRef}
              src={audioUrl}
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration || 0;
                setAudioDuration(d);
                const alreadyDone = file && transcribedForRef.current === file;
                if (d > MAX_RAW_DURATION) {
                  // Audio dài → ép trim window về 10s đầu, KHÔNG chạy STT
                  setTrimStart(0);
                  setTrimEnd(MAX_RAW_DURATION);
                  if (!alreadyDone) {
                    toast.warning(`Audio dài ${d.toFixed(1)}s — vượt giới hạn 10s`, {
                      description: "Hãy cắt còn ≤ 10 giây để hệ thống nhận diện văn bản gốc.",
                      duration: 4000,
                    });
                  }
                } else {
                  setTrimStart(0);
                  setTrimEnd(d);
                  // Chỉ chạy STT + gender detect nếu file này chưa từng được xử lý
                  if (file && !alreadyDone) {
                    void detectFromAudio(file);
                    void detectGenderFromAudio(file);
                  }
                }
              }}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              className="hidden"
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── PROJECTS TAB ───────────────────────────────────────────────────────
function ProjectsTab() {
  const [projects, setProjects] = useState<DubbingListProject[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    void Promise.allSettled([listDubbingProjects(30), listJobs(30)]).then(([projectResult, jobResult]) => {
      setProjects(projectResult.status === "fulfilled" ? projectResult.value.projects || [] : []);
      setJobs(jobResult.status === "fulfilled" ? jobResult.value.jobs || [] : []);
    });
  }, []);

  return (
    <div>
      <PageTitle icon={Folder} title="Dự án của tôi" desc="Tất cả các dự án bạn đã tạo" />
      {!projects ? (
        <div className="rounded-2xl border border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">Đang tải dự án...</div>
      ) : projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/20 p-12 text-center text-sm text-muted-foreground">Chưa có dự án nào.</div>
      ) : (
        <div className="space-y-2.5">
          {projects.map((project) => (
            <ProjectRow
              key={project.id}
              title={project.title || project.video_filename || project.id}
              subtitle={`${project.source_language || "auto"} → ${project.target_language || "vietnamese"}`}
              meta={project.created_at ? new Date(project.created_at).toLocaleString("vi-VN") : project.id}
              status={project.status === "done" || project.status === "completed" ? "done" : "processing"}
            />
          ))}
        </div>
      )}

      {jobs.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border/60 bg-card/40 p-5">
          <h3 className="mb-3 text-sm font-semibold">Job gần đây</h3>
          <div className="space-y-2">
            {jobs.slice(0, 5).map((job) => (
              <div key={job.id} className="flex items-center justify-between rounded-lg border border-border/40 bg-background/30 px-3 py-2 text-sm">
                <span>{job.kind}</span>
                <span className="text-xs text-muted-foreground">{job.status}{typeof job.progress === "number" ? ` · ${Math.round(job.progress)}%` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── HISTORY TAB ────────────────────────────────────────────────────────
function HistoryTab({ payments }: { payments: Payment[] | null }) {
  return (
    <div>
      <PageTitle icon={Clock} title="Lịch sử xử lý" desc="Lịch sử thanh toán và các thao tác" />
      {!payments || payments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/20 p-12 text-center">
          <Clock className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">Chưa có giao dịch nào</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
                <th className="p-3 text-left font-medium">Mã</th>
                <th className="p-3 text-left font-medium">Gói</th>
                <th className="p-3 text-right font-medium">Số tiền</th>
                <th className="p-3 text-left font-medium">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.ref_code} className="border-b border-border/30 last:border-0">
                  <td className="p-3 font-mono text-xs">{p.ref_code}</td>
                  <td className="p-3 capitalize">{p.plan_id}</td>
                  <td className="p-3 text-right font-mono">{p.amount_vnd.toLocaleString("vi-VN")}đ</td>
                  <td className="p-3">
                    <StatusPill status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── SETTINGS TAB ───────────────────────────────────────────────────────
function SettingsTab({
  user,
  theme,
  setTheme,
}: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
}) {
  return (
    <div className="max-w-3xl space-y-5">
      <PageTitle icon={SettingsIcon} title="Cài đặt" desc="Tuỳ chỉnh tài khoản và giao diện" />

      <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Hồ sơ</h3>
        <div className="space-y-3">
          <SettingsRow icon={Mail} label="Email" value={user.email} badge={user.email_verified ? "Đã xác thực" : "Chưa xác thực"} badgeOk={user.email_verified} />
          <SettingsRow icon={Crown} label="Gói dịch vụ" value={user.plan.charAt(0).toUpperCase() + user.plan.slice(1)} />
          {user.plan_expires_at && (
            <SettingsRow icon={Clock} label="Hết hạn" value={new Date(user.plan_expires_at).toLocaleDateString("vi-VN")} />
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Giao diện</h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-muted/20">
              {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </div>
            <div>
              <div className="text-sm font-medium">Chế độ hiển thị</div>
              <div className="text-xs text-muted-foreground">{theme === "dark" ? "Tối" : "Sáng"}</div>
            </div>
          </div>
          <div className="inline-flex rounded-full border border-border/60 bg-card/40 p-1">
            <button onClick={() => setTheme("light")} className={`flex h-7 w-7 items-center justify-center rounded-full ${theme === "light" ? "bg-foreground text-background" : "text-muted-foreground"}`}>
              <Sun className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setTheme("dark")} className={`flex h-7 w-7 items-center justify-center rounded-full ${theme === "dark" ? "bg-foreground text-background" : "text-muted-foreground"}`}>
              <Moon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── TOPUP TAB ──────────────────────────────────────────────────────────
function TopupTab() {
  const [packs, setPacks] = useState<CreditPack[] | null>(null);

  useEffect(() => {
    fetchCreditPacks()
      .then((res) => setPacks((res.packs || []).filter((pack) => pack.is_active)))
      .catch(() => setPacks([]));
  }, []);

  return (
    <div className="max-w-4xl">
      <PageTitle icon={Wallet} title="Nạp credits" desc="Mua thêm credits — credits không hết hạn" />
      {!packs ? (
        <div className="rounded-2xl border border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">Đang tải gói credits...</div>
      ) : packs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/20 p-12 text-center text-sm text-muted-foreground">Chưa cấu hình gói credits.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          {packs.map((pack) => (
            <div
              key={pack.id}
              className={`relative rounded-2xl border p-5 transition-all hover:-translate-y-0.5 ${
                pack.is_popular ? "border-primary/40 bg-primary/[0.05] ring-1 ring-primary/20" : "border-border/60 bg-card/40"
              }`}
            >
              {pack.is_popular && (
                <div className="absolute -top-2.5 left-4 rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold uppercase text-primary-foreground">
                  Phổ biến
                </div>
              )}
              <Zap className="h-6 w-6 text-primary mb-3" />
              <div className="text-2xl font-bold">{pack.total_credits.toLocaleString("vi-VN")} credits</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {pack.base_credits.toLocaleString("vi-VN")} gốc
                {pack.bonus_credits > 0 ? ` + ${pack.bonus_credits.toLocaleString("vi-VN")} thưởng` : ""}
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-xl font-bold">{pack.price_vnd.toLocaleString("vi-VN")}đ</span>
              </div>
              <Link href={`/checkout/credits/${pack.id}`} className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/30 transition-transform hover:scale-[1.02]">
                Mua ngay
              </Link>
            </div>
          ))}
        </div>
      )}
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Áp dụng chính sách Fair Use. Credits topup không hết hạn.
      </p>
    </div>
  );
}

// ── SUPPORT TAB ────────────────────────────────────────────────────────
function SupportTab() {
  return (
    <div className="max-w-3xl">
      <PageTitle icon={HelpCircle} title="Trung tâm hỗ trợ" desc="Chúng tôi luôn sẵn sàng giúp bạn — phản hồi trong 24h" />
      <div className="grid gap-3 sm:grid-cols-2">
        <SupportLink icon={Mail} label="voxstudio.vn@gmail.com" desc="Phản hồi email trong 24h" href="mailto:voxstudio.vn@gmail.com" />
        <SupportLink icon={HelpCircle} label="Câu hỏi thường gặp" desc="Xem các câu trả lời nhanh" href="/#faq" />
        <SupportLink icon={ShieldCheck} label="Chính sách quyền riêng tư" desc="Cách bảo vệ dữ liệu của bạn" href="/privacy" />
        <SupportLink icon={FileText} label="Điều khoản dịch vụ" desc="Quy định sử dụng VoxStudio" href="/terms" />
      </div>
    </div>
  );
}

// ── HELPER COMPONENTS ──────────────────────────────────────────────────
function IconButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/50 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function BigToolCard({
  icon: Icon,
  title,
  desc,
  gradient,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  gradient: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card/40 p-5 text-left transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10"
    >
      <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} shadow-md`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{desc}</p>
      <ArrowRight className="absolute right-4 top-4 h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-1" />
    </button>
  );
}

function ProjectRow({
  title,
  subtitle,
  meta,
  status,
}: {
  title: string;
  subtitle: string;
  meta: string;
  status: "done" | "processing";
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-card/30 p-3 transition-colors hover:bg-card/60">
      <div className="flex h-10 w-14 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/30 to-fuchsia-500/20 shrink-0">
        <Play className="h-3.5 w-3.5 text-white fill-current" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs text-muted-foreground">{meta}</div>
        <div className="mt-1">
          {status === "done" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-500">
              <CheckCircle2 className="h-2.5 w-2.5" />
              Hoàn thành
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-500">
              <Loader className="h-2.5 w-2.5 animate-spin" />
              Đang xử lý
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  unit,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
      <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-background/60 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-black tracking-tight">{value}</span>
        <span className="text-xs font-semibold text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { class: string; label: string }> = {
    pending: { class: "border-yellow-500/30 bg-yellow-500/10 text-yellow-500", label: "Chờ xác nhận" },
    paid: { class: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500", label: "Đã thanh toán" },
    cancelled: { class: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400 line-through", label: "Đã huỷ" },
  };
  const cfg = map[status] || map.cancelled;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cfg.class}`}>
      {cfg.label}
    </span>
  );
}

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  suffix: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-primary"
      />
    </label>
  );
}

// ── VOICE LIBRARY: helper components ───────────────────────────────────
type FilterOption = { value: string; label: string; flag?: string; count?: number };

function FilterSelect({
  label,
  value,
  options,
  onChange,
  align = "left",
}: {
  label?: string;
  value: string;
  options: FilterOption[];
  onChange: (v: string) => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handler(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const current = options.find((o) => o.value === value) || options[0];

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      {label && (
        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-border/40 bg-background px-3 text-left text-xs font-medium text-foreground transition hover:border-border/70"
      >
        <span className="truncate">{current?.label || "Tất cả"}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          className={`absolute top-[calc(100%+4px)] z-[80] min-w-full max-h-[300px] overflow-y-auto rounded-xl border border-border/40 bg-background p-1 shadow-2xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition ${
                  selected ? "text-foreground" : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{opt.label}</span>
                {opt.count !== undefined && opt.count > 0 && (
                  <span className="text-[10px] font-medium text-muted-foreground/60">{opt.count}</span>
                )}
                {selected && <span className="text-sm font-bold text-emerald-500">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── VOICE LIBRARY MODAL ────────────────────────────────────────────────
type UnifiedVoice = {
  key: string;
  name: string;
  description: string;
  language?: string;
  langCode?: string;
  tags: string[];
  gender?: string;
  flag: string;
  source: "premium-builtin" | "user-clone" | "edge";
  previewUrl?: string | null;
};

const FAVORITE_KEY = "voxstudio:tts:favoriteVoices";

function loadFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(FAVORITE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveFavorites(favs: Set<string>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(FAVORITE_KEY, JSON.stringify(Array.from(favs)));
}

function VoiceLibraryModal({
  open,
  onClose,
  engine,
  onEngineChange,
  premiumVoices,
  userVoices,
  edgeVoices,
  selectedKey,
  onSelect,
  onCreateVoice,
}: {
  open: boolean;
  onClose: () => void;
  engine: "premium" | "cloud";
  onEngineChange: (engine: "premium" | "cloud") => void;
  premiumVoices: PremiumVoice[];
  userVoices: Voice[];
  edgeVoices: EdgeVoice[];
  selectedKey: string;
  onSelect: (key: string) => void;
  onCreateVoice?: () => void;
}) {
  const [tab, setTab] = useState<"default" | "library" | "favorite">("default");
  const [query, setQuery] = useState("");
  const [filterLang, setFilterLang] = useState<string>("all");
  const [filterGender, setFilterGender] = useState<"all" | "male" | "female">("all");
  const [filterStyle, setFilterStyle] = useState<string>("all");
  const [sortMode, setSortMode] = useState<"name-asc" | "name-desc" | "lang">("name-asc");
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const mounted = useClientMounted();
  const [engineMenuOpen, setEngineMenuOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const engineMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!engineMenuOpen) return;
    function handler(event: MouseEvent) {
      if (engineMenuRef.current && !engineMenuRef.current.contains(event.target as Node)) {
        setEngineMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [engineMenuOpen]);

  function resetVoiceFilters() {
    setFilterLang("all");
    setFilterGender("all");
    setFilterStyle("all");
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      audioRef.current?.pause();
    }
  }, [open]);

  const allVoices = useMemo<UnifiedVoice[]>(() => {
    const list: UnifiedVoice[] = [];
    if (engine === "premium") {
      for (const v of premiumVoices) {
        const langCode = resolveLangCode(v.language) || undefined;
        const meta = langCode ? LANGUAGE_META[langCode] : undefined;
        list.push({
          key: v.slug,
          name: v.display_name,
          description: v.description || `VoxStudio · ${meta?.english || v.language || "đa ngôn ngữ"} · ${v.gender}`,
          language: meta?.english || v.language,
          langCode,
          gender: v.gender,
          flag: flagFor(v.language),
          tags: [meta?.english || "Đa ngôn ngữ", v.gender].filter(Boolean) as string[],
          source: "premium-builtin",
          previewUrl: v.preview_url ? mediaUrl(v.preview_url) : null,
        });
      }
      for (const v of userVoices) {
        const parsed = parseVoiceTags(v);
        const langCode = parsed.langCode || resolveLangCode(v.language || "") || undefined;
        const meta = langCode ? LANGUAGE_META[langCode] : undefined;
        // Description ưu tiên previewText user nhập lúc clone (cached) →
        // fallback ref_text (Whisper transcript). User thấy được câu mẫu
        // mà voice sẽ đọc, không phải transcript của audio gốc.
        const cachedPreviewText = getPreview(v.id)?.text;
        const descText = cachedPreviewText || v.ref_text || "";
        list.push({
          key: v.id,
          name: v.name,
          description: descText.slice(0, 100) || "Giọng do bạn tạo",
          language: meta?.english || v.language || undefined,
          langCode,
          gender: parsed.gender || undefined,
          flag: meta?.flag || "👤",
          tags: ["Của tôi", ...(meta ? [meta.english] : []), ...parsed.styles],
          source: "user-clone",
          // hasPreview=true → modal play button enable, sẽ load blob IndexedDB
          previewUrl: cachedPreviewText ? "idb://" + v.id : null,
        });
      }
    } else {
      for (const v of edgeVoices) {
        const langCode = resolveLangCode(v.locale) || undefined;
        const meta = langCode ? LANGUAGE_META[langCode] : undefined;
        list.push({
          key: v.name,
          name: v.name.replace(/^[a-z]{2}-[A-Z]{2}-/, "").replace(/Neural$/, ""),
          description: `${meta?.native || v.locale} · ${v.gender}`,
          language: meta?.english,
          langCode,
          gender: v.gender,
          flag: flagFor(v.locale),
          tags: [meta?.english || v.locale, v.gender],
          source: "edge",
        });
      }
    }
    return list;
  }, [engine, premiumVoices, userVoices, edgeVoices]);

  const tabs = useMemo(() => {
    const t: Array<{ id: "default" | "library" | "favorite"; label: string; count: number; icon: typeof Sparkles }> = [];
    if (engine === "premium") {
      t.push({ id: "default", label: "Thư viện giọng", count: premiumVoices.length, icon: Sparkles });
      t.push({ id: "library", label: "Của tôi", count: userVoices.length, icon: Folder });
    } else {
      t.push({ id: "default", label: "Thư viện giọng", count: edgeVoices.length, icon: Sparkles });
    }
    t.push({ id: "favorite", label: "Yêu thích", count: favorites.size, icon: Crown });
    return t;
  }, [engine, premiumVoices.length, userVoices.length, edgeVoices.length, favorites.size]);

  // Pool sau khi áp dụng tab (chưa filter lang/gender) — dùng để derive options filter
  const tabPool = useMemo(() => {
    if (tab === "default") return allVoices.filter((v) => v.source === "premium-builtin" || v.source === "edge");
    if (tab === "library") return allVoices.filter((v) => v.source === "user-clone");
    return allVoices.filter((v) => favorites.has(v.key));
  }, [allVoices, tab, favorites]);

  // Danh sách ngôn ngữ + giới tính + style có sẵn trong tab (kèm số lượng)
  const langCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of tabPool) {
      if (v.langCode) map.set(v.langCode, (map.get(v.langCode) || 0) + 1);
    }
    return map;
  }, [tabPool]);

  const genderCounts = useMemo(() => {
    const counts = { male: 0, female: 0 };
    for (const v of tabPool) {
      const g = (v.gender || "").toLowerCase();
      if (g === "male") counts.male++;
      else if (g === "female") counts.female++;
    }
    return counts;
  }, [tabPool]);

  const styleCounts = useMemo(() => {
    const map = new Map<string, number>();
    const SKIP = new Set(["male", "female", "VoxStudio", "Của tôi"]);
    for (const v of tabPool) {
      for (const tag of v.tags) {
        if (!tag || SKIP.has(tag) || /^[a-z]{2}-[A-Z]{2}$/.test(tag)) continue;
        if (LANGUAGE_META[tag.toLowerCase()] || Object.values(LANGUAGE_META).some((m) => m.english === tag)) continue;
        map.set(tag, (map.get(tag) || 0) + 1);
      }
    }
    return map;
  }, [tabPool]);

  const visible = useMemo(() => {
    let pool = tabPool;
    if (filterLang !== "all") pool = pool.filter((v) => v.langCode === filterLang);
    if (filterGender !== "all") {
      pool = pool.filter((v) => (v.gender || "").toLowerCase() === filterGender);
    }
    if (filterStyle !== "all") {
      pool = pool.filter((v) => v.tags.includes(filterStyle));
    }
    const q = query.trim().toLowerCase();
    if (q) {
      pool = pool.filter((v) => {
        return (
          v.name.toLowerCase().includes(q) ||
          v.description.toLowerCase().includes(q) ||
          (v.language || "").toLowerCase().includes(q) ||
          v.tags.some((t) => t.toLowerCase().includes(q))
        );
      });
    }
    const sorted = [...pool];
    if (sortMode === "name-asc") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortMode === "name-desc") sorted.sort((a, b) => b.name.localeCompare(a.name));
    else if (sortMode === "lang") sorted.sort((a, b) => (a.langCode || "zz").localeCompare(b.langCode || "zz"));
    return sorted;
  }, [tabPool, query, filterLang, filterGender, filterStyle, sortMode]);

  function toggleFavorite(key: string) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveFavorites(next);
      return next;
    });
  }

  async function togglePreview(voice: UnifiedVoice) {
    if (!voice.previewUrl) {
      toast.info("Giọng này chưa có audio mẫu", { duration: 1800 });
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (previewKey === voice.key) {
      audio.pause();
      setPreviewKey(null);
      return;
    }
    audio.pause();

    // User-clone (`idb://<voice_id>`) → load blob từ IndexedDB → object URL
    if (voice.previewUrl.startsWith("idb://")) {
      const voiceId = voice.previewUrl.slice("idb://".length);
      try {
        const blob = await idbGet(voiceId);
        if (!blob) {
          toast.error("Audio nghe thử chưa sẵn sàng", { duration: 1800 });
          return;
        }
        const url = URL.createObjectURL(blob);
        audio.src = url;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          setPreviewKey(null);
        };
        setPreviewKey(voice.key);
        await audio.play();
      } catch (e) {
        toast.error("Không phát được preview", {
          description: e instanceof Error ? e.message : undefined,
        });
      }
      return;
    }

    // Premium voice → URL trực tiếp
    audio.src = voice.previewUrl;
    audio.load();
    setPreviewKey(voice.key);
    audio.play().catch((err) => {
      setPreviewKey(null);
      const msg = err?.message || "Không phát được audio mẫu";
      toast.error("Không phát được preview", { description: msg, duration: 2400 });
    });
  }

  function handleSelect(voice: UnifiedVoice) {
    onSelect(voice.key);
    onClose();
  }

  if (!open || !mounted) return null;

  const modal = (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <button
        type="button"
        onClick={onClose}
        aria-label="Đóng"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div className="relative z-10 flex h-[88vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl">
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/60 bg-muted/10 px-4 py-3">
          <div ref={engineMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setEngineMenuOpen((o) => !o)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-background/60 pl-2 pr-2.5 text-xs font-semibold text-foreground hover:bg-muted/40"
            >
              <EngineLogo engine={engine} size="sm" />
              <span>{engine === "premium" ? "VoxStudio" : "Edge TTS"}</span>
              <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${engineMenuOpen ? "rotate-180" : ""}`} />
            </button>
            {engineMenuOpen && (
              <div className="absolute left-0 top-[calc(100%+6px)] z-[60] w-72 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-2xl">
                <div className="p-1">
                  <ModelOption
                    active={engine === "premium"}
                    name="VoxStudio"
                    desc="Giọng đọc tự nhiên, model riêng, tiếng Việt chuẩn"
                    engineId="premium"
                    onClick={() => {
                      resetVoiceFilters();
                      onEngineChange("premium");
                      setTab("default");
                      setQuery("");
                      setEngineMenuOpen(false);
                    }}
                  />
                  <ModelOption
                    active={engine === "cloud"}
                    name="Edge TTS"
                    desc="400+ giọng, 100+ ngôn ngữ, miễn phí siêu rẻ"
                    engineId="cloud"
                    onClick={() => {
                      resetVoiceFilters();
                      onEngineChange("cloud");
                      setTab("default");
                      setQuery("");
                      setEngineMenuOpen(false);
                    }}
                  />
                </div>
                <div className="border-t border-border/60 bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground">
                  Đổi model — danh sách giọng sẽ được cập nhật.
                </div>
              </div>
            )}
          </div>

          <div className="hidden h-6 w-px bg-border/60 md:block" />

          <div className="flex items-center gap-0.5 rounded-lg bg-muted/40 p-0.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-bold transition ${
                  tab === t.id
                    ? "bg-foreground text-background shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
                <span
                  className={`rounded px-1 py-0 text-[10px] font-black ${
                    tab === t.id ? "bg-background/20 text-background" : "bg-muted/60 text-muted-foreground"
                  }`}
                >
                  {t.count}
                </span>
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="shrink-0 space-y-3 border-b border-border/60 bg-muted/20 px-4 py-3">
          {/* Row 1: Search + Sort */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm kiếm giọng đọc..."
                className="h-11 w-full rounded-xl border border-border/40 bg-background pl-10 pr-10 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-border/70"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  aria-label="Xoá tìm kiếm"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="w-[180px] shrink-0">
              <FilterSelect
                value={sortMode}
                onChange={(v) => setSortMode(v as typeof sortMode)}
                align="right"
                options={[
                  { value: "name-asc", label: "Tên A → Z" },
                  { value: "name-desc", label: "Tên Z → A" },
                  { value: "lang", label: "Theo ngôn ngữ" },
                ]}
              />
            </div>
          </div>

          {/* Row 2: Filter columns */}
          <div className="flex flex-wrap items-end gap-2">
            <FilterSelect
              label="Ngôn ngữ"
              value={filterLang}
              onChange={setFilterLang}
              options={[
                { value: "all", label: "Tất cả", flag: "🌐", count: tabPool.length },
                ...Array.from(langCounts.entries())
                  .sort((a, b) => {
                    const priority = ["vi", "en"];
                    const ai = priority.indexOf(a[0]);
                    const bi = priority.indexOf(b[0]);
                    if (ai !== -1 || bi !== -1) {
                      if (ai === -1) return 1;
                      if (bi === -1) return -1;
                      return ai - bi;
                    }
                    return b[1] - a[1];
                  })
                  .map(([code, count]) => ({
                    value: code,
                    label: LANGUAGE_META[code]?.native || code.toUpperCase(),
                    flag: LANGUAGE_META[code]?.flag,
                    count,
                  })),
              ]}
            />

            <FilterSelect
              label="Giới tính"
              value={filterGender}
              onChange={(v) => setFilterGender(v as typeof filterGender)}
              options={[
                { value: "all", label: "Tất cả", count: tabPool.length },
                { value: "female", label: "Nữ", count: genderCounts.female },
                { value: "male", label: "Nam", count: genderCounts.male },
              ]}
            />

            <FilterSelect
              label="Phong cách"
              value={filterStyle}
              onChange={setFilterStyle}
              options={[
                { value: "all", label: "Tất cả", count: tabPool.length },
                ...Array.from(styleCounts.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([style, count]) => ({ value: style, label: style, count })),
              ]}
            />

            {(filterLang !== "all" || filterGender !== "all" || filterStyle !== "all" || query) && (
              <button
                type="button"
                onClick={() => {
                  setFilterLang("all");
                  setFilterGender("all");
                  setFilterStyle("all");
                  setQuery("");
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border/60 bg-background px-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
                title="Xoá toàn bộ bộ lọc"
              >
                <X className="h-3.5 w-3.5" />
                Xoá lọc
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {visible.length === 0 ? (
            <div className="grid place-items-center px-6 py-20 text-center text-muted-foreground">
              {tab === "library" && onCreateVoice ? (
                <>
                  <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                    <Wand2 className="h-7 w-7" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">Chưa có giọng nhân bản nào</p>
                  <p className="mt-1 text-xs">Nhân bản giọng từ audio mẫu của bạn — chỉ cần 30 giây ghi âm</p>
                  <button
                    type="button"
                    onClick={() => {
                      onCreateVoice();
                      onClose();
                    }}
                    className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-xs font-bold text-background hover:opacity-90"
                  >
                    <Plus className="h-4 w-4" />
                    Tạo giọng mới
                  </button>
                </>
              ) : (
                <>
                  <Search className="mb-3 h-8 w-8 opacity-50" />
                  <p className="text-sm font-semibold text-foreground">Không tìm thấy giọng phù hợp</p>
                  <p className="mt-1 text-xs">
                    {tab === "favorite" ? "Bấm trái tim trên thẻ giọng để thêm vào yêu thích" : "Thử từ khoá khác"}
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {tab === "library" && onCreateVoice && (
                <button
                  type="button"
                  onClick={() => {
                    onCreateVoice();
                    onClose();
                  }}
                  className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4 text-primary transition hover:border-primary/70 hover:bg-primary/10"
                  style={{ minHeight: "12rem" }}
                >
                  <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/15">
                    <Plus className="h-6 w-6" />
                  </div>
                  <span className="text-sm font-bold">Tạo giọng mới</span>
                  <span className="text-[11px] font-normal text-muted-foreground">Nhân bản từ audio mẫu của bạn</span>
                </button>
              )}
              {visible.map((v) => {
                const isSelected = v.key === selectedKey;
                const isFav = favorites.has(v.key);
                const isPlaying = previewKey === v.key;
                const meta = v.langCode ? LANGUAGE_META[v.langCode] : null;
                return (
                  <div
                    key={v.key}
                    className={`flex flex-col gap-3 rounded-xl border p-4 transition ${
                      isSelected ? "border-primary/60 bg-primary/5" : "border-border/60 bg-card hover:border-border hover:bg-muted/40"
                    }`}
                  >
                    {/* Header: cờ avatar + tên + gender pill */}
                    <div className="flex items-start gap-3">
                      <div
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border/60 bg-background text-lg leading-none"
                        title={v.language || v.langCode || ""}
                      >
                        {v.flag && v.flag !== "🌐" && v.flag !== "👤"
                          ? v.flag
                          : <Globe className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="line-clamp-2 text-sm font-bold text-foreground">{v.name}</h4>
                          {isSelected ? (
                            <span className="shrink-0 rounded-md bg-primary px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-primary-foreground">
                              Đang dùng
                            </span>
                          ) : v.gender ? (
                            <span
                              className={`inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-black ${
                                v.gender === "male"
                                  ? "bg-blue-500/15 text-blue-400"
                                  : "bg-pink-500/15 text-pink-400"
                              }`}
                            >
                              <span className="text-sm leading-none">{v.gender === "male" ? "♂" : "♀"}</span>
                              {v.gender === "male" ? "Nam" : "Nữ"}
                            </span>
                          ) : null}
                        </div>
                        {meta && (
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {meta.native}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Quote / description */}
                    <div className="rounded-lg bg-muted/30 px-3 py-2">
                      <p className="line-clamp-2 min-h-[2.5rem] text-xs italic leading-5 text-muted-foreground">
                        {v.description ? `"${v.description}"` : "—"}
                      </p>
                    </div>

                    {/* Tags (style + nguồn — bỏ language tag vì đã có ở subtitle) */}
                    {v.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {v.tags
                          .filter((t) => t !== meta?.english && t !== "male" && t !== "female")
                          .slice(0, 3)
                          .map((tag, i) => (
                            <span
                              key={i}
                              className="rounded-md bg-muted/50 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
                            >
                              {tag}
                            </span>
                          ))}
                      </div>
                    )}

                    {/* Footer actions: heart + play + Áp dụng/Dùng */}
                    <div className="flex items-center justify-end gap-1 border-t border-border/40 pt-3">
                      <button
                        type="button"
                        onClick={() => toggleFavorite(v.key)}
                        className={`grid h-8 w-8 place-items-center rounded-lg transition ${
                          isFav
                            ? "bg-red-500/15 text-red-500"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        }`}
                        aria-label={isFav ? "Bỏ yêu thích" : "Yêu thích"}
                        title={isFav ? "Bỏ yêu thích" : "Yêu thích"}
                      >
                        <Heart className={`h-3.5 w-3.5 ${isFav ? "fill-current" : ""}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => togglePreview(v)}
                        disabled={!v.previewUrl}
                        className={`grid h-8 w-8 place-items-center rounded-lg transition ${
                          v.previewUrl
                            ? isPlaying
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                            : "cursor-not-allowed text-muted-foreground/40"
                        }`}
                        aria-label={isPlaying ? "Tạm dừng" : "Nghe thử"}
                        title={v.previewUrl ? (isPlaying ? "Tạm dừng" : "Nghe thử") : "Không có preview"}
                      >
                        {isPlaying ? <PauseCircle className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelect(v)}
                        className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition ${
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "bg-foreground text-background hover:opacity-90"
                        }`}
                      >
                        <Sparkles className="h-3 w-3" />
                        {isSelected ? "Đã chọn" : "Áp dụng"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <audio
          ref={audioRef}
          onEnded={() => setPreviewKey(null)}
          onError={() => {
            if (previewKey) {
              setPreviewKey(null);
              toast.error("Không tải được audio mẫu — file có thể đã bị xoá", { duration: 2400 });
            }
          }}
          className="hidden"
        />
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

// ── GENDER SELECT ──────────────────────────────────────────────────────
function GenderSelect({
  value,
  onChange,
  detecting,
}: {
  value: "male" | "female" | "";
  onChange: (v: "male" | "female" | "") => void;
  detecting?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handler(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const display = value === "male"
    ? { icon: "♂", label: "Nam", className: "text-blue-400" }
    : value === "female"
    ? { icon: "♀", label: "Nữ", className: "text-pink-400" }
    : null;

  return (
    <div ref={ref} className="relative mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-12 w-full items-center justify-between gap-3 rounded-lg border bg-background px-3 text-left transition ${
          open ? "border-primary/60 ring-2 ring-primary/15" : "border-border/60 hover:border-border"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {detecting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm font-semibold text-muted-foreground">Đang phát hiện...</span>
            </>
          ) : display ? (
            <>
              <span className={`text-lg font-bold leading-none ${display.className}`}>{display.icon}</span>
              <span className="text-sm font-semibold text-foreground">{display.label}</span>
            </>
          ) : (
            <span className="text-sm font-semibold text-muted-foreground">— Chọn giới tính —</span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-[80] overflow-hidden rounded-xl border border-border/60 bg-popover p-1 shadow-2xl">
          {([
            ["female", "Nữ", "♀", "text-pink-400"],
            ["male", "Nam", "♂", "text-blue-400"],
          ] as const).map(([id, label, icon, color]) => {
            const selected = value === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-semibold transition ${
                  selected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted/50"
                }`}
              >
                <span className={`text-lg font-bold leading-none ${color}`}>{icon}</span>
                <span className="flex-1">{label}</span>
                {selected && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── LANGUAGE COMBOBOX ──────────────────────────────────────────────────
function LanguageCombobox({
  value,
  onChange,
  options,
  engineLabel,
  totalSupported,
  autoDetect,
}: {
  value: string;
  onChange: (code: string) => void;
  options: string[];
  engineLabel: string;
  totalSupported?: number;
  autoDetect?: { onClick: () => void; busy: boolean; disabled?: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Sort: vi → en → A-Z theo tên Anh
  const sorted = useMemo(() => {
    const priority = ["vi", "en"];
    return [...options].sort((a, b) => {
      const ai = priority.indexOf(a);
      const bi = priority.indexOf(b);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return (LANGUAGE_META[a]?.english || a).localeCompare(LANGUAGE_META[b]?.english || b);
    });
  }, [options]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((code) => {
      const meta = LANGUAGE_META[code];
      if (!meta) return false;
      return (
        code.toLowerCase().includes(q) ||
        meta.english.toLowerCase().includes(q) ||
        meta.native.toLowerCase().includes(q)
      );
    });
  }, [sorted, query]);

  useEffect(() => {
    if (!open) return;
    function handler(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      setHighlight(0);
    }, 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const timer = window.setTimeout(() => setHighlight(0), 0);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.querySelector<HTMLElement>(`[data-idx="${highlight}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  function handleKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const code = filtered[highlight];
      if (code) {
        onChange(code);
        setOpen(false);
        setQuery("");
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  const currentMeta = LANGUAGE_META[value];

  return (
    <div ref={wrapperRef} className="relative mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex h-12 w-full items-center justify-between gap-3 rounded-lg border bg-background px-3 text-left transition ${
          open ? "border-primary/60 ring-2 ring-primary/15" : "border-border/60 hover:border-border"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {currentMeta?.flag ? (
            <span className="text-lg leading-none">{currentMeta.flag}</span>
          ) : (
            <Globe className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="truncate text-sm font-semibold text-foreground">
            {currentMeta?.native || value.toUpperCase()}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-xl border border-border/70 bg-popover shadow-2xl backdrop-blur">
          <div className="space-y-2 border-b border-border/50 p-2">
            {autoDetect && (
              <button
                type="button"
                disabled={autoDetect.busy || autoDetect.disabled}
                onClick={() => {
                  autoDetect.onClick();
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-2 text-left text-xs font-bold text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {autoDetect.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                <span className="flex-1">
                  {autoDetect.busy ? "Đang nhận diện..." : "Tự nhận diện ngôn ngữ"}
                </span>
              </button>
            )}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKey}
                placeholder="Tìm ngôn ngữ, vd: viet, english, ja..."
                className="h-9 w-full rounded-lg border border-border/60 bg-background pl-8 pr-7 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                  className="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  aria-label="Xoá tìm kiếm"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          <div ref={listRef} role="listbox" className="max-h-[280px] overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="grid place-items-center px-3 py-8 text-center text-xs text-muted-foreground">
                <Search className="mb-2 h-5 w-5 opacity-50" />
                Không tìm thấy ngôn ngữ phù hợp
              </div>
            ) : (
              filtered.map((code, idx) => {
                const meta = LANGUAGE_META[code];
                const selected = code === value;
                const isHigh = idx === highlight;
                return (
                  <button
                    key={code}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-idx={idx}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => {
                      onChange(code);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${
                      isHigh ? "bg-muted/60" : ""
                    } ${selected ? "bg-primary/10" : ""}`}
                  >
                    {meta?.flag ? (
                      <span className="text-lg leading-none">{meta.flag}</span>
                    ) : (
                      <Globe className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={`truncate text-xs font-semibold ${selected ? "text-primary" : "text-foreground"}`}>
                        {meta?.native || code.toUpperCase()}
                      </span>
                      <span className="truncate text-[10px] text-muted-foreground">
                        {meta?.english || ""}
                      </span>
                    </span>
                    <span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                      {code}
                    </span>
                    {selected && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border/50 bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground">
            <span>
              {filtered.length}/{sorted.length} hiển thị
              {totalSupported && totalSupported > sorted.length ? (
                <span className="ml-1 text-primary">· {totalSupported}+ hỗ trợ</span>
              ) : null}
            </span>
            <span className="font-semibold">{engineLabel}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function SelectField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="mt-1.5 flex w-full items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm">
        <span>{value}</span>
        <span className="text-[10px] font-bold uppercase text-muted-foreground">Cố định</span>
      </div>
    </div>
  );
}

function SettingsRow({
  icon: Icon,
  label,
  value,
  badge,
  badgeOk,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  badge?: string;
  badgeOk?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-sm font-medium truncate">{value}</div>
      </div>
      {badge && (
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
            badgeOk
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
              : "border-yellow-500/30 bg-yellow-500/10 text-yellow-500"
          }`}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

function SupportLink({
  icon: Icon,
  label,
  desc,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  desc: string;
  href: string;
}) {
  return (
    <Link href={href} className="group flex items-start gap-3 rounded-xl border border-border/60 bg-card/40 p-4 transition-colors hover:border-primary/30">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/5">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

// ── ENGINE LOGO ────────────────────────────────────────────────────────
function EngineLogo({
  engine,
  size = "md",
}: {
  engine: "premium" | "cloud";
  size?: "sm" | "md";
}) {
  const px = size === "sm" ? 20 : 36;
  const className = size === "sm" ? "h-5 w-5" : "h-9 w-9";
  const src = engine === "premium" ? "/logo.png" : "/edge-logo.svg";
  const alt = engine === "premium" ? "VoxStudio" : "Microsoft Edge";
  return (
    <Image
      src={src}
      alt={alt}
      width={px}
      height={px}
      className={`${className} shrink-0 rounded-md object-contain`}
    />
  );
}

// ── MODEL OPTION (dropdown row) ────────────────────────────────────────
function ModelOption({
  engineId,
  name,
  desc,
  active,
  onClick,
}: {
  engineId: "premium" | "cloud";
  name: string;
  desc: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition-colors ${
        active ? "bg-foreground/10" : "hover:bg-muted/50"
      }`}
    >
      <EngineLogo engine={engineId} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold">{name}</span>
          {active && (
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{desc}</div>
      </div>
    </button>
  );
}

// ── COMPACT AUDIO PLAYER ───────────────────────────────────────────────
type SubtitlePayload = {
  format: "srt" | "json";
  text: string;
  duration: number;
  meta: { engine: string; voice: string; sampleRate: number; language: string };
};

function CompactAudioPlayer({
  src,
  duration: durationProp,
  onReuse,
  subtitle,
}: {
  src: string;
  duration?: number;
  onReuse?: () => void;
  subtitle?: SubtitlePayload;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(durationProp ?? 0);
  const [downloadOpen, setDownloadOpen] = useState(false);

  useEffect(() => {
    if (!downloadOpen) return;
    function handler(event: MouseEvent) {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(event.target as Node)) {
        setDownloadOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [downloadOpen]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrent(el.currentTime || 0);
    const onMeta = () => setTotal(el.duration || durationProp || 0);
    const onEnd = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnd);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [src, durationProp]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) el.pause();
    else el.play();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !total) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    el.currentTime = pct * total;
    setCurrent(el.currentTime);
  };

  const fmt = (s: number) => {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${m}:${ss.toString().padStart(2, "0")}`;
  };

  const pct = total > 0 ? (current / total) * 100 : 0;

  return (
    <div className="flex items-center gap-3 rounded-full border border-border/60 bg-background/40 p-1.5 pr-3">
      <button
        type="button"
        onClick={toggle}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background hover:scale-105 transition-transform"
        aria-label={playing ? "Tạm dừng" : "Phát"}
      >
        {playing ? <PauseCircle className="h-5 w-5" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
      </button>

      <div
        onClick={seek}
        className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-muted/60"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-foreground transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
        {fmt(current)} / {fmt(total)}
      </span>

      {onReuse && (
        <button
          type="button"
          onClick={onReuse}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          aria-label="Dùng lại"
          title="Dùng lại"
        >
          <Repeat className="h-3.5 w-3.5" />
        </button>
      )}
      {subtitle ? (
        <div ref={downloadMenuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setDownloadOpen((v) => !v)}
            className={`inline-flex h-7 items-center gap-1 rounded-full px-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors ${
              downloadOpen ? "bg-muted/60 text-foreground" : ""
            }`}
            aria-label="Tải xuống"
            title="Tải xuống"
            aria-expanded={downloadOpen}
            aria-haspopup="menu"
          >
            <Download className="h-3.5 w-3.5" />
            <ChevronDown className={`h-3 w-3 transition-transform ${downloadOpen ? "rotate-180" : ""}`} />
          </button>
          {downloadOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-1.5 min-w-[180px] overflow-hidden rounded-xl border border-border/70 bg-popover/95 p-1 shadow-2xl backdrop-blur"
            >
              <a
                href={src}
                download
                onClick={() => setDownloadOpen(false)}
                role="menuitem"
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-foreground hover:bg-muted/60"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/10">
                  <Music2 className="h-3.5 w-3.5" />
                </span>
                <span className="flex flex-col items-start">
                  <span>Audio</span>
                  <span className="text-[10px] font-normal text-muted-foreground">.wav · {fmt(total)}</span>
                </span>
              </a>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  downloadSubtitleFile(subtitle.text, subtitle.duration, subtitle.format, subtitle.meta);
                  setDownloadOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-foreground hover:bg-muted/60"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
                  <FileText className="h-3.5 w-3.5" />
                </span>
                <span className="flex flex-col items-start">
                  <span>Phụ đề</span>
                  <span className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">.{subtitle.format}</span>
                </span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <a
          href={src}
          download
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          aria-label="Tải audio"
          title="Tải audio"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
      )}

      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
    </div>
  );
}
