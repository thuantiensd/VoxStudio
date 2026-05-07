"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";

/**
 * VoiceLibrary — showcase 31 preset voices thay vì 3D globe của KingCong.
 *
 * Identity: VoxStudio nhấn mạnh "voice library curated", không phải
 * "global reach". Mỗi voice có avatar gradient + name + language flag.
 *
 * Layout: orbital arrangement — voices floating quanh center "VoxStudio"
 * label, kết hợp grid xếp lớp tạo depth.
 */

interface PreviewVoice {
  slug: string;
  name: string;
  lang: string;
  flag: string;
  gradient: [string, string];
}

// Curated preview của 12 voices đại diện cho 6 ngôn ngữ (2 per lang).
// Full 31 voices show trong app.
const PREVIEW_VOICES: PreviewVoice[] = [
  { slug: "nu_mai_anh", name: "Mai Anh", lang: "Tiếng Việt", flag: "🇻🇳", gradient: ["#8B5CF6", "#6366F1"] },
  { slug: "nam_quoc_bao", name: "Quốc Bảo", lang: "Tiếng Việt", flag: "🇻🇳", gradient: ["#06B6D4", "#3B82F6"] },
  { slug: "en_emma", name: "Emma", lang: "English", flag: "🇺🇸", gradient: ["#EC4899", "#F43F5E"] },
  { slug: "en_michael", name: "Michael", lang: "English", flag: "🇬🇧", gradient: ["#10B981", "#14B8A6"] },
  { slug: "zh_meilin", name: "美琳", lang: "中文", flag: "🇨🇳", gradient: ["#F59E0B", "#EF4444"] },
  { slug: "zh_wei", name: "伟", lang: "中文", flag: "🇨🇳", gradient: ["#A855F7", "#EC4899"] },
  { slug: "jp_yuki", name: "ゆき", lang: "日本語", flag: "🇯🇵", gradient: ["#3B82F6", "#06B6D4"] },
  { slug: "jp_haruto", name: "ハルト", lang: "日本語", flag: "🇯🇵", gradient: ["#14B8A6", "#10B981"] },
  { slug: "kr_minji", name: "민지", lang: "한국어", flag: "🇰🇷", gradient: ["#F97316", "#F59E0B"] },
  { slug: "kr_junho", name: "준호", lang: "한국어", flag: "🇰🇷", gradient: ["#D946EF", "#A855F7"] },
  { slug: "fr_camille", name: "Camille", lang: "Français", flag: "🇫🇷", gradient: ["#0EA5E9", "#6366F1"] },
  { slug: "fr_louis", name: "Louis", lang: "Français", flag: "🇫🇷", gradient: ["#EAB308", "#F97316"] },
];

function _initials(name: string): string {
  const trimmed = name.trim();
  // Chinese/Japanese/Korean — lấy 1 ký tự đầu
  if (/[一-鿿぀-ゟ゠-ヿ가-힯]/.test(trimmed)) {
    return trimmed.slice(0, 1);
  }
  // Latin — lấy first + last initial
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function VoiceLibrary() {
  const t = useTranslations("landing.voices");

  return (
    <section className="relative overflow-hidden py-20 sm:py-28">
      {/* Background blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="blob-glow-magenta absolute top-0 left-1/3 h-[500px] w-[500px] rounded-full opacity-40" />
        <div className="blob-glow-purple absolute bottom-0 right-1/4 h-[400px] w-[400px] rounded-full opacity-50" />
      </div>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <div className="pill-badge mb-4">{t("sectionLabel")}</div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            {t("title1")}{" "}
            <span className="text-gradient-brand">{t("title2")}</span>
          </h2>
          <p className="mt-4 text-base text-muted-foreground sm:text-lg">
            {t("subtitle")}
          </p>
        </div>

        {/* Voice grid 4 cols × 3 rows desktop, responsive */}
        <div className="mt-16 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {PREVIEW_VOICES.map((voice) => (
            <VoiceCard key={voice.slug} voice={voice} />
          ))}
        </div>

        {/* Footer CTA — link đến full library */}
        <div className="mt-12 text-center">
          <Link
            href="/download"
            className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10"
          >
            {t("cta")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function VoiceCard({ voice }: { voice: PreviewVoice }) {
  return (
    <div className="glass-card group flex items-center gap-3 rounded-xl p-4 transition-all hover:scale-[1.02]">
      {/* Avatar gradient với initials */}
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold text-white shadow-lg"
        style={{
          background: `linear-gradient(135deg, ${voice.gradient[0]} 0%, ${voice.gradient[1]} 100%)`,
        }}
      >
        {_initials(voice.name)}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">
          {voice.name}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {voice.flag} {voice.lang}
        </div>
      </div>
    </div>
  );
}
