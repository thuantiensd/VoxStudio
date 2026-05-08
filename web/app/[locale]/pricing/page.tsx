import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PageShell } from "@/components/marketing/page-shell";
import { Pricing } from "@/components/marketing/pricing";
import { CreditPacks } from "@/components/marketing/credit-packs";
import { TrustBadges } from "@/components/marketing/trust-badges";
import { FAQ } from "@/components/marketing/faq";
import { ArrowRight, Check } from "lucide-react";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing.pricing" });
  return {
    title: locale === "vi"
      ? "Bảng giá VoxStudio — Đơn giản, minh bạch"
      : "VoxStudio Pricing — Simple, transparent",
    description: t("subtitle"),
    alternates: {
      canonical: `/${locale}/pricing`,
      languages: { vi: "/vi/pricing", en: "/en/pricing" },
    },
    robots: { index: true, follow: true },
  };
}

export default function PricingPage() {
  const t = useTranslations("pricingPage");
  const tPricing = useTranslations("landing.pricing");

  return (
    <PageShell>
      {/* HERO — premium clean */}
      <section className="relative overflow-hidden pt-16 pb-4 sm:pt-24 text-center">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/[0.08] blur-3xl" />
        </div>
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-primary mb-5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            {tPricing("eyebrow")}
          </div>
          <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            {tPricing("title")}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
            {tPricing("subtitle")}
          </p>

          {/* Inline trust strip */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground sm:text-sm">
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-emerald-500" />
              {t("trust1")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-emerald-500" />
              {t("trust2")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-emerald-500" />
              {t("trust3")}
            </span>
          </div>
        </div>
      </section>

      {/* PRICING CARDS — focus, no overcrowding */}
      <Pricing hideHeader />

      {/* TRUST BADGES — Stripe / Refund / GPU / Uptime */}
      <TrustBadges />

      {/* CREDITS TOPUP — dubbing minutes */}
      <CreditPacks />

      {/* FAQ */}
      <FAQ />

      {/* FINAL CTA */}
      <section className="relative overflow-hidden border-t border-border/40 py-16 sm:py-20">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-1/2 h-[300px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/[0.08] blur-3xl" />
        </div>
        <div className="mx-auto max-w-2xl px-4 sm:px-6 text-center">
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            {t("finalCtaTitle")}
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground sm:text-base">
            {t("finalCtaSubtitle")}
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:scale-[1.02] hover:shadow-primary/50"
            >
              {t("finalCtaPrimary")}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-card/40 px-6 py-3 text-sm font-semibold transition-colors hover:bg-muted/40"
            >
              {t("finalCtaSecondary")}
            </Link>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
