"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Check, Sparkles } from "lucide-react";

const PLAN_KEYS = ["free", "pro", "studio", "premium"] as const;
type PlanKey = (typeof PLAN_KEYS)[number];

type BillingPeriod = "monthly" | "yearly";

export function Pricing({ hideHeader = false }: { hideHeader?: boolean } = {}) {
  const t = useTranslations("landing.pricing");
  const locale = useLocale();
  const [billing, setBilling] = useState<BillingPeriod>("monthly");

  return (
    <section
      id="pricing"
      className={`relative overflow-hidden ${hideHeader ? "py-12 sm:py-16" : "py-20 sm:py-28"}`}
    >
      {/* Subtle radial accent — premium SaaS feel */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 h-[600px] w-[1000px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/[0.06] blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {!hideHeader && (
          <div className="mx-auto max-w-2xl text-center mb-10">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary mb-3">
              {t("eyebrow")}
            </div>
            <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-5xl">
              {t("title")}
            </h2>
            <p className="mx-auto mt-4 text-base text-muted-foreground sm:text-lg">
              {t("subtitle")}
            </p>
          </div>
        )}

        {/* Billing toggle */}
        <div className="flex items-center justify-center mb-10">
          <BillingToggle billing={billing} setBilling={setBilling} t={t} />
        </div>

        {/* Plan cards */}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {PLAN_KEYS.map((key) => (
            <PlanCard
              key={key}
              planKey={key}
              billing={billing}
              locale={locale}
            />
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground/70">
          {t("fairUseHint")}
        </p>
      </div>
    </section>
  );
}

function BillingToggle({
  billing,
  setBilling,
  t,
}: {
  billing: BillingPeriod;
  setBilling: (b: BillingPeriod) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/40 p-1 backdrop-blur-sm">
      <button
        onClick={() => setBilling("monthly")}
        className={`relative rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
          billing === "monthly"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {t("billingMonthly")}
      </button>
      <button
        onClick={() => setBilling("yearly")}
        className={`relative inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
          billing === "yearly"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {t("billingYearly")}
        <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-500">
          {t("billingSave")}
        </span>
      </button>
    </div>
  );
}

function PlanCard({
  planKey,
  billing,
  locale,
}: {
  planKey: PlanKey;
  billing: BillingPeriod;
  locale: string;
}) {
  const t = useTranslations(`landing.pricing.${planKey}`);
  const tShared = useTranslations("landing.pricing");
  const features = t.raw("features") as string[];
  const isPopular = planKey === "studio";
  const isFree = planKey === "free";
  const isScale = planKey === "premium";

  // USD as source of truth
  const priceUsdRaw = parseInt(t("price").replace(/[^0-9]/g, ""), 10) || 0;
  const yearlyDiscount = 0.3; // 30% off
  const monthlyEquivPrice = billing === "yearly"
    ? Math.round(priceUsdRaw * (1 - yearlyDiscount))
    : priceUsdRaw;

  // Display price logic
  let displayPrice: string;
  if (isFree) {
    displayPrice = locale === "vi" ? "0đ" : "$0";
  } else if (locale === "vi") {
    const vnd = monthlyEquivPrice * 25_000;
    displayPrice = `${(vnd / 1_000).toFixed(0)}k`;
  } else {
    displayPrice = `$${monthlyEquivPrice}`;
  }

  // CTA href: Scale → /contact (sales), others → checkout
  const ctaHref = isFree
    ? "/sign-up"
    : isScale
      ? "/contact"
      : `/checkout/${planKey}`;

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-card/40 p-6 transition-all duration-300 hover:-translate-y-1 sm:p-7 ${
        isPopular
          ? "border-primary/40 shadow-2xl shadow-primary/20 ring-1 ring-primary/20"
          : "border-border/60 hover:border-border"
      }`}
    >
      {/* Glow background — only for popular */}
      {isPopular && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.12] via-transparent to-transparent"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/30 blur-3xl"
          />
        </>
      )}

      {/* Badge */}
      {isPopular ? (
        <div className="relative mb-5">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow-lg shadow-primary/40">
            <Sparkles className="h-3 w-3" />
            {tShared("popular")}
          </span>
        </div>
      ) : t.raw("badge") ? (
        <div className="mb-5">
          <span className="inline-flex items-center rounded-full border border-border/60 bg-card/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {t("badge")}
          </span>
        </div>
      ) : (
        <div className="mb-5 h-[26px]" />
      )}

      {/* Plan name + tagline */}
      <div className="relative mb-6">
        <h3 className="text-lg font-bold tracking-tight">{t("name")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("desc")}</p>
      </div>

      {/* Price */}
      <div className="relative mb-6">
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-bold tracking-tight">
            {displayPrice}
          </span>
          {!isFree && (
            <span className="text-sm text-muted-foreground">
              {tShared("perMonth")}
            </span>
          )}
        </div>
        {!isFree && billing === "yearly" && (
          <p className="mt-1 text-[11px] text-emerald-500 font-medium">
            {tShared("yearlyBilled", {
              total: locale === "vi"
                ? `${(priceUsdRaw * 12 * 0.7 * 25_000 / 1_000).toFixed(0)}k`
                : `$${(priceUsdRaw * 12 * 0.7).toFixed(0)}`,
            })}
          </p>
        )}
        {!isFree && billing === "monthly" && (
          <p className="mt-1 text-[11px] text-muted-foreground/80">
            {tShared("billingMonthly")}
          </p>
        )}
      </div>

      {/* CTA */}
      <Link
        href={ctaHref}
        className={`relative inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
          isPopular
            ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:shadow-primary/50 hover:scale-[1.02]"
            : isFree
              ? "border border-border/60 bg-card/40 hover:bg-muted/40"
              : "bg-foreground text-background hover:opacity-90"
        }`}
      >
        {t("cta")}
      </Link>

      {/* Features list */}
      <ul className="relative mt-7 space-y-2.5 flex-1">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] text-foreground/80">
            <Check
              className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
                isPopular ? "text-primary" : "text-foreground/60"
              }`}
            />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
