"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ArrowRight, Mic2, Languages, Zap } from "lucide-react";
import createGlobe from "cobe";

export function GlobeSection() {
  const t = useTranslations("landing.globe");

  return (
    <section className="relative overflow-hidden py-20 sm:py-28">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="blob-glow-purple absolute left-1/4 top-1/2 h-[500px] w-[500px] -translate-y-1/2 rounded-full opacity-40" />
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          {/* Globe column — flags chạy phía sau, globe nổi trên */}
          <div className="relative order-1 mx-auto aspect-square w-full max-w-[560px]">
            <FlagBackdrop />
            <div className="absolute inset-0 z-10">
              <Globe />
            </div>
          </div>

          <div className="order-2 text-center lg:text-left">
            <div className="pill-badge mb-4">{t("sectionLabel")}</div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              {t("title1")}{" "}
              <span className="text-gradient-brand">{t("title2")}</span>
            </h2>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg">
              {t("subtitle")}
            </p>

            <ul className="mt-8 flex flex-col gap-4">
              <FeatureBullet
                icon={Mic2}
                title={t("bullet1Title")}
                desc={t("bullet1Desc")}
              />
              <FeatureBullet
                icon={Languages}
                title={t("bullet2Title")}
                desc={t("bullet2Desc")}
              />
              <FeatureBullet
                icon={Zap}
                title={t("bullet3Title")}
                desc={t("bullet3Desc")}
              />
            </ul>

            <Link
              href="/download"
              className="mt-8 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10"
            >
              {t("cta")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

const FLAGS = [
  "🇻🇳", "🇺🇸", "🇯🇵", "🇰🇷", "🇨🇳", "🇫🇷", "🇬🇧", "🇩🇪", "🇪🇸", "🇮🇹",
  "🇷🇺", "🇧🇷", "🇲🇽", "🇨🇦", "🇦🇺", "🇮🇳", "🇹🇭", "🇮🇩", "🇲🇾", "🇸🇬",
  "🇵🇭", "🇳🇱", "🇸🇪", "🇳🇴", "🇩🇰", "🇫🇮", "🇵🇱", "🇹🇷", "🇸🇦", "🇦🇪",
  "🇪🇬", "🇿🇦", "🇦🇷", "🇨🇱", "🇨🇴", "🇵🇹", "🇬🇷", "🇮🇪", "🇨🇭", "🇧🇪",
];

/**
 * FlagBackdrop — 5 hàng cờ chạy ngang phía sau globe.
 * Hàng chẵn chạy ←, hàng lẻ chạy → để cảm giác dynamic global flow.
 * Mỗi hàng dùng slice FLAGS khác offset để không trùng pattern.
 */
/**
 * FlagBackdrop — 3 hàng cờ chạy ngang phía sau globe.
 * Hàng 1+3: forward (←), hàng 2: reverse (→). Speed khác nhau cho organic.
 */
/**
 * FlagBackdrop — 3 hàng cờ chạy ngang phía sau globe.
 * Hàng 1+3 forward, hàng 2 reverse (animation-direction: reverse trên cùng keyframe).
 */
function FlagBackdrop() {
  const rotate = (arr: string[], n: number) => [...arr.slice(n), ...arr.slice(0, n)];
  const rows = [
    { items: rotate(FLAGS, 0),  reverse: false, speed: "38s" },
    { items: rotate(FLAGS, 13), reverse: true,  speed: "45s" },
    { items: rotate(FLAGS, 26), reverse: false, speed: "32s" },
  ];
  return (
    <div className="marquee-mask absolute -inset-x-12 inset-y-0 flex flex-col justify-center gap-3 overflow-hidden opacity-80 sm:-inset-x-20">
      {rows.map((row, i) => (
        <div
          key={i}
          className="marquee-track flex w-max gap-4 sm:gap-5"
          style={{
            animationDuration: row.speed,
            animationDirection: row.reverse ? "reverse" : "normal",
          }}
        >
          {[...row.items, ...row.items].map((flag, j) => (
            <div
              key={j}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-2xl backdrop-blur-sm sm:h-16 sm:w-16 sm:text-3xl"
              aria-hidden
            >
              {flag}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function FeatureBullet({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <li className="flex items-start gap-3 text-left">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-gradient-to-br from-primary/15 to-accent/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground">{desc}</div>
      </div>
    </li>
  );
}

function Globe() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerInteracting = useRef<number | null>(null);
  const pointerMovement = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let width = canvas.offsetWidth || 500;
    let phi = 0;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const globe = createGlobe(canvas, {
      devicePixelRatio: dpr,
      width: width * dpr,
      height: width * dpr,
      phi: 0,
      theta: 0.3,
      dark: 1,
      diffuse: 1.2,
      mapSamples: 16000,
      mapBrightness: 6,
      baseColor: [0.3, 0.2, 0.6],
      markerColor: [0.55, 0.85, 1],
      glowColor: [0.3, 0.22, 0.6],
      markers: [
        { location: [21.03, 105.85], size: 0.05 },
        { location: [10.78, 106.7], size: 0.04 },
        { location: [35.68, 139.65], size: 0.04 },
        { location: [37.57, 126.98], size: 0.04 },
        { location: [48.86, 2.35], size: 0.04 },
        { location: [34.05, -118.24], size: 0.04 },
        { location: [40.71, -74.01], size: 0.04 },
        { location: [13.76, 100.5], size: 0.03 },
        { location: [-33.87, 151.21], size: 0.03 },
        { location: [51.51, -0.13], size: 0.04 },
      ],
    });

    let isVisible = true;
    let isPaused = false;

    const tick = () => {
      if (isVisible && !isPaused) {
        if (!pointerInteracting.current) phi += 0.005;
        globe.update({
          phi: phi + pointerMovement.current / 200,
          width: width * dpr,
          height: width * dpr,
        });
      }
      rafId = requestAnimationFrame(tick);
    };
    let rafId = requestAnimationFrame(tick);

    const onResize = () => {
      width = canvas.offsetWidth || 500;
    };
    window.addEventListener("resize", onResize);

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) isVisible = e.isIntersecting;
      },
      { threshold: 0.1 }
    );
    io.observe(canvas);
    const onVis = () => {
      isPaused = document.hidden;
    };
    document.addEventListener("visibilitychange", onVis);

    const onPointerDown = (e: PointerEvent) => {
      pointerInteracting.current = e.clientX - pointerMovement.current;
      canvas.style.cursor = "grabbing";
    };
    const onPointerUp = () => {
      pointerInteracting.current = null;
      canvas.style.cursor = "grab";
    };
    const onMouseMove = (e: MouseEvent) => {
      if (pointerInteracting.current !== null) {
        pointerMovement.current = e.clientX - pointerInteracting.current;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (pointerInteracting.current !== null && e.touches[0]) {
        pointerMovement.current = e.touches[0].clientX - pointerInteracting.current;
      }
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerout", onPointerUp);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("touchmove", onTouchMove, { passive: true });

    return () => {
      cancelAnimationFrame(rafId);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerout", onPointerUp);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("touchmove", onTouchMove);
      globe.destroy();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: "100%",
        contain: "layout paint size",
        cursor: "grab",
        touchAction: "pan-y",
      }}
    />
  );
}
