"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Mic, Wand2, Film, ArrowRight, Play, Volume2, Music2 } from "lucide-react";

/**
 * ToolsShowcase — 3 sản phẩm chính của VoxStudio.
 * Layout: Studio Dubbing là flagship (large card chiếm 2 cột),
 * TTS + Voice Cloning là 2 card nhỏ (1 cột).
 *
 * Khác KingCong: VoxStudio đặt Dubbing làm flagship (USP), không phải TTS.
 * Mỗi card glass-morphism với hover glow.
 */
export function ToolsShowcase() {
  const t = useTranslations("landing.tools");

  return (
    <section className="relative py-20 sm:py-28">
      {/* Background blob */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="blob-glow-purple absolute top-1/2 right-0 h-[500px] w-[500px] -translate-y-1/2 rounded-full opacity-50" />
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* Section header */}
        <div className="mx-auto max-w-2xl text-center">
          <div className="pill-badge mb-4">
            {t("sectionLabel")}
          </div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            {t("title1")}{" "}
            <span className="text-gradient-brand">{t("title2")}</span>
          </h2>
          <p className="mt-4 text-base text-muted-foreground sm:text-lg">
            {t("subtitle")}
          </p>
        </div>

        {/* Cards grid: 1 large + 2 small (responsive 1 col mobile, 3 col desktop) */}
        <div className="mt-16 grid gap-5 lg:grid-cols-3 lg:grid-rows-2">
          {/* Flagship — Studio Dubbing (chiếm 2 cột × 2 rows trên desktop) */}
          <ToolCard
            icon={Film}
            label={t("dubbing.label")}
            title={t("dubbing.title")}
            description={t("dubbing.description")}
            ctaText={t("dubbing.cta")}
            ctaHref="/#features"
            featured
            className="lg:col-span-2 lg:row-span-2"
          >
            {/* Decorative — film strip + waveform */}
            <FilmStripDecoration />
          </ToolCard>

          {/* TTS */}
          <ToolCard
            icon={Mic}
            label={t("tts.label")}
            title={t("tts.title")}
            description={t("tts.description")}
            ctaText={t("tts.cta")}
            ctaHref="/#features"
            iconColor="from-violet-500 to-fuchsia-500"
          />

          {/* Voice Cloning */}
          <ToolCard
            icon={Wand2}
            label={t("clone.label")}
            title={t("clone.title")}
            description={t("clone.description")}
            ctaText={t("clone.cta")}
            ctaHref="/#features"
            iconColor="from-fuchsia-500 to-pink-500"
          />
        </div>
      </div>
    </section>
  );
}

interface ToolCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  title: string;
  description: string;
  ctaText: string;
  ctaHref: string;
  featured?: boolean;
  iconColor?: string;
  className?: string;
  children?: React.ReactNode;
}

function ToolCard({
  icon: Icon,
  label,
  title,
  description,
  ctaText,
  ctaHref,
  featured = false,
  iconColor = "from-purple-500 to-violet-500",
  className = "",
  children,
}: ToolCardProps) {
  return (
    <div
      className={`glass-card group relative flex flex-col overflow-hidden rounded-2xl p-6 transition-all sm:p-8 ${className}`}
    >
      {/* Icon — gradient bg */}
      <div
        className={`mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${iconColor} shadow-lg shadow-primary/20`}
      >
        <Icon className="h-6 w-6 text-white" />
      </div>

      {/* Label small caps */}
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary/80">
        {label}
      </div>

      {/* Title */}
      <h3
        className={`mb-3 font-bold tracking-tight ${featured ? "text-3xl sm:text-4xl" : "text-xl sm:text-2xl"}`}
      >
        {title}
      </h3>

      {/* Description */}
      <p
        className={`text-muted-foreground ${featured ? "max-w-md text-base sm:text-lg" : "text-sm"}`}
      >
        {description}
      </p>

      {/* Spacer cho flagship card có decoration ở dưới */}
      {featured && children}

      {/* CTA arrow link */}
      <Link
        href={ctaHref}
        className="mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-medium text-primary transition-colors hover:text-accent"
      >
        {ctaText}
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
      </Link>
    </div>
  );
}

/**
 * FilmStripDecoration — multi-track DAW mockup cho Dubbing flagship card.
 * Mô phỏng giao diện studio chuyên nghiệp: timeline ruler, 3 track với
 * avatar + name, waveform riêng từng track, scrubber animation.
 *
 * Heights pre-computed để tránh hydration mismatch.
 */
const TRACK_HEIGHTS = [
  [29, 31, 33, 35, 37, 39, 40, 42, 43, 44, 45, 46, 47, 47, 48, 48, 48, 47, 47, 46, 45, 44, 42, 40, 39, 37, 35, 33, 31, 29, 27, 25, 23, 22, 21, 20, 20, 20, 21, 22, 23, 25, 27, 29, 31, 33, 35, 37, 39, 40, 42, 43, 44, 45, 46, 47, 47, 48, 48, 48],
  [43, 44, 45, 46, 47, 47, 48, 48, 48, 47, 47, 46, 45, 44, 42, 40, 39, 37, 35, 33, 31, 29, 27, 25, 23, 22, 21, 20, 20, 20, 21, 22, 23, 25, 27, 29, 31, 33, 35, 37, 39, 40, 42, 43, 44, 45, 46, 47, 47, 48, 48, 48, 47, 47, 46, 45, 44, 42, 40, 39],
  [48, 47, 47, 46, 45, 44, 42, 40, 39, 37, 35, 33, 31, 29, 27, 25, 23, 22, 21, 20, 20, 20, 21, 22, 23, 25, 27, 29, 31, 33, 35, 37, 39, 40, 42, 43, 44, 45, 46, 47, 47, 48, 48, 48, 47, 47, 46, 45, 44, 42, 40, 39, 37, 35, 33, 31, 29, 27, 25, 23],
];

const TRACKS_META = [
  {
    icon: Mic,
    name: "Mai Anh",
    role: "Người dẫn",
    barClass: "from-violet-400 via-violet-500/80 to-violet-600/30",
    chipClass: "from-violet-500/30 to-violet-500/10 border-violet-500/30 text-violet-200",
  },
  {
    icon: Volume2,
    name: "Minh Quân",
    role: "Nhân vật A",
    barClass: "from-fuchsia-400 via-fuchsia-500/80 to-fuchsia-600/30",
    chipClass: "from-fuchsia-500/30 to-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-200",
  },
  {
    icon: Music2,
    name: "Nhạc nền",
    role: "BGM · Mix",
    barClass: "from-pink-400 via-pink-500/80 to-pink-600/30",
    chipClass: "from-pink-500/30 to-pink-500/10 border-pink-500/30 text-pink-200",
  },
];

const TIMECODES = ["00:00", "00:15", "00:30", "00:45", "01:00"];

function FilmStripDecoration() {
  return (
    <div className="mt-8 rounded-xl border border-white/10 bg-black/30 p-3 backdrop-blur-sm sm:mt-10 sm:p-4">
      {/* Toolbar — transport + status */}
      <div className="mb-3 flex items-center justify-between border-b border-white/5 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent shadow-lg shadow-primary/30">
            <Play className="h-3 w-3 fill-white text-white" />
          </div>
          <div className="flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_6px_theme(colors.emerald.400)]" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-300/80">
              Đang render
            </span>
          </div>
        </div>
        <div className="hidden items-center gap-3 text-[10px] font-mono text-muted-foreground/60 sm:flex">
          <span>3 TRACK</span>
          <span>·</span>
          <span>48 kHz</span>
          <span>·</span>
          <span>STEREO</span>
        </div>
      </div>

      {/* Timeline ruler */}
      <div className="mb-2 flex items-center gap-2">
        <div className="w-[88px] shrink-0 sm:w-[110px]" />
        <div className="relative flex flex-1 justify-between border-b border-white/10 pb-1">
          {TIMECODES.map((t, i) => (
            <span
              key={i}
              className="text-[9px] font-mono text-muted-foreground/50"
            >
              {t}
            </span>
          ))}
          {/* Active scrubber line — animation pulse */}
          <div className="absolute left-[35%] top-0 h-3 w-px bg-primary shadow-[0_0_4px_theme(colors.primary)]" />
        </div>
      </div>

      {/* Tracks */}
      <div className="relative flex flex-col gap-2">
        {/* Vertical scrubber line — extends through all tracks */}
        <div
          className="pointer-events-none absolute top-0 h-full w-px bg-primary/60"
          style={{ left: "calc(88px + 8px + 35% * (100% - 88px - 8px) / 100%)" }}
        />

        {TRACKS_META.map((track, i) => {
          const Icon = track.icon;
          return (
            <div key={i} className="flex items-center gap-2">
              {/* Track header — avatar + name */}
              <div
                className={`flex w-[88px] shrink-0 items-center gap-1.5 rounded-md border bg-gradient-to-br px-2 py-1.5 sm:w-[110px] sm:gap-2 ${track.chipClass}`}
              >
                <Icon className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10px] font-semibold leading-tight sm:text-[11px]">
                    {track.name}
                  </div>
                  <div className="truncate text-[8px] text-current/60 sm:text-[9px]">
                    {track.role}
                  </div>
                </div>
              </div>
              {/* Waveform */}
              <div className="flex flex-1 items-center gap-0.5">
                {TRACK_HEIGHTS[i].map((h, j) => (
                  <div
                    key={j}
                    className={`w-1 rounded-full bg-gradient-to-b ${track.barClass}`}
                    style={{ height: `${h * 0.85}px` }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
