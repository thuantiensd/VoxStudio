"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  ArrowRight,
  Play,
  Sparkles,
  Globe2,
  Zap,
  ShieldCheck,
} from "lucide-react";

/**
 * Hero — VoxStudio brand identity (purple-first).
 *
 * Layout:
 *   [pill badge với pulsing dot]
 *   [HEADING + GRADIENT]
 *   [Subtitle]
 *   [CTAs]
 *   [DemoShowcase] — animated text + waveform showcasing TTS conversion
 *   [Stats row qualitative — bỏ số cụ thể]
 */
export function Hero() {
  const t = useTranslations("landing.hero");

  return (
    <section className="relative overflow-hidden pt-24 pb-16 sm:pt-32 sm:pb-24">
      {/* Glow blobs — purple + magenta */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="blob-glow-purple absolute top-1/3 left-1/2 -translate-x-1/2 h-[600px] w-[900px] rounded-full" />
        <div className="blob-glow-magenta absolute bottom-0 right-1/4 h-[400px] w-[400px] rounded-full" />
      </div>

      {/* Subtle grid overlay */}
      <div aria-hidden
        className="absolute inset-0 -z-10 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div className="mx-auto max-w-5xl px-4 text-center sm:px-6">
        {/* Pill badge */}
        <div className="pill-badge mb-8">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          {t("badge")}
        </div>

        {/* Giant headline với gradient line cuối */}
        <h1 className="text-balance text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl xl:text-8xl">
          {t("headline1")}
          <br />
          <span className="text-gradient-brand">{t("headline2")}</span>
        </h1>

        {/* Subtitle */}
        <p className="mx-auto mt-8 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg lg:text-xl">
          {t("subheadline")}
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <Link
            href="/download"
            className="btn-glow inline-flex items-center justify-center gap-2 rounded-full bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground transition-transform hover:scale-105"
          >
            {t("ctaPrimary")}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="#demo"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-8 py-3.5 text-sm font-semibold text-foreground backdrop-blur-sm transition-colors hover:border-primary/50 hover:bg-primary/10"
          >
            <Play className="h-4 w-4" fill="currentColor" />
            {t("ctaSecondary")}
          </Link>
        </div>

        {/* Demo showcase — text → audio conversion in real-time visual */}
        <DemoShowcase className="mt-16" />

        {/* Stats — qualitative thay vì số cụ thể */}
        <div className="mt-16 grid grid-cols-2 gap-8 sm:grid-cols-4 sm:gap-4">
          <Stat icon={Sparkles} label={t("statVoices")} />
          <Stat icon={Globe2} label={t("statLanguages")} />
          <Stat icon={Zap} label={t("statClone")} />
          <Stat icon={ShieldCheck} label={t("statUptime")} />
        </div>
      </div>
    </section>
  );
}

function Stat({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-gradient-to-br from-primary/15 to-accent/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="text-sm font-semibold text-foreground sm:text-base">
        {label}
      </div>
    </div>
  );
}

/**
 * DemoShowcase — animated typewriter text + soundwave bars cycling.
 * Visual demo về TTS: text được "gõ" ra → biến thành audio waveform.
 *
 * Cycle qua 3 sample texts để show diversity (Vietnamese / English / Japanese).
 * Mỗi cycle ~5s: type 2.5s + waveform 2.5s.
 *
 * Glass-morphism card với gradient border + animated content.
 */
function DemoShowcase({ className = "" }: { className?: string }) {
  const samples = [
    {
      flag: "🇻🇳",
      voice: "Mai Anh",
      text: "Chào mừng đến với VoxStudio — nơi giọng nói AI chạm đến trái tim.",
    },
    {
      flag: "🇺🇸",
      voice: "Emma",
      text: "Welcome to VoxStudio — where AI voices touch the heart.",
    },
    {
      flag: "🇯🇵",
      voice: "ゆき",
      text: "VoxStudioへようこそ。AIの声が心に届く場所です。",
    },
  ];

  const [activeIdx, setActiveIdx] = useState(0);
  const [typedChars, setTypedChars] = useState(0);
  const [phase, setPhase] = useState<"typing" | "playing">("typing");

  const current = samples[activeIdx];

  // Typing phase + transition to playing
  useEffect(() => {
    if (phase === "typing") {
      if (typedChars < current.text.length) {
        const t = setTimeout(() => setTypedChars((n) => n + 1), 40);
        return () => clearTimeout(t);
      }
      // Finished typing → switch to playing waveform
      const t = setTimeout(() => setPhase("playing"), 500);
      return () => clearTimeout(t);
    }
    // Playing phase: hold 2.5s, rồi cycle sang sample kế tiếp
    const t = setTimeout(() => {
      setActiveIdx((i) => (i + 1) % samples.length);
      setTypedChars(0);
      setPhase("typing");
    }, 2500);
    return () => clearTimeout(t);
  }, [phase, typedChars, current.text, samples.length]);

  return (
    <div
      className={`glass-card mx-auto max-w-3xl rounded-3xl p-6 sm:p-8 ${className}`}
    >
      {/* Header — voice info + demo label */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full text-base font-bold text-white"
            style={{
              background:
                "linear-gradient(135deg, #7C5CFF 0%, #FF6BCB 100%)",
            }}
          >
            {current.voice.slice(0, 1)}
          </div>
          <div className="text-left">
            <div className="text-sm font-semibold">{current.voice}</div>
            <div className="text-xs text-muted-foreground">
              {current.flag} Live demo
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-primary/70">
          <Sparkles className="h-3 w-3" />
          AI Voice
        </div>
      </div>

      {/* Typewriter text */}
      <div className="mb-6 min-h-[80px] text-left text-lg font-medium leading-relaxed sm:text-xl">
        <span className="text-foreground">
          {current.text.slice(0, typedChars)}
        </span>
        {phase === "typing" && (
          <span className="ml-0.5 inline-block h-5 w-[2px] animate-pulse bg-primary align-middle sm:h-6" />
        )}
      </div>

      {/* Waveform — đứng yên khi typing, animate khi playing */}
      <DemoWaveform playing={phase === "playing"} />
    </div>
  );
}

function DemoWaveform({ playing }: { playing: boolean }) {
  const heights = [
    18, 32, 24, 42, 28, 52, 36, 48,
    58, 42, 32, 60, 48, 38, 28, 52,
    42, 32, 58, 36, 46, 60, 38, 24,
    52, 32, 42, 50, 38, 56, 30, 46,
    36, 50, 28, 44, 32, 48, 26, 40,
  ];

  return (
    <div className="flex h-16 items-center justify-center gap-0.5 sm:gap-1">
      {heights.map((h, i) => (
        <div
          key={i}
          className="w-1 rounded-full sm:w-1.5"
          style={{
            height: playing ? `${h}px` : "8px",
            background: "linear-gradient(180deg, #7C5CFF 0%, #FF6BCB 100%)",
            animation: playing
              ? `soundwave-bounce ${800 + ((i * 37) % 500)}ms ease-in-out ${
                  (i * 30) % 600
                }ms infinite`
              : "none",
            opacity: playing ? 0.7 + (i % 4) * 0.075 : 0.4,
            transition: "height 300ms ease-out, opacity 300ms",
            transformOrigin: "center",
          }}
        />
      ))}
    </div>
  );
}
