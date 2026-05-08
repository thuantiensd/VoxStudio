import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PageShell } from "@/components/marketing/page-shell";
import { Pricing } from "@/components/marketing/pricing";
import { CreditPacks } from "@/components/marketing/credit-packs";
import { FAQ } from "@/components/marketing/faq";
import {
  Sparkles,
  ShieldCheck,
  Check,
  X,
  CreditCard,
  Infinity as InfinityIcon,
  Headphones,
  ArrowRight,
} from "lucide-react";

const ROWS = [
  "tts",
  "dubLength",
  "stt",
  "voiceClones",
  "projects",
  "downloads",
  "batch",
  "byok",
  "support",
] as const;

export default function PricingPage() {
  const t = useTranslations("pricingPage");

  return (
    <PageShell>
      {/* Hero */}
      <section className="relative overflow-hidden pt-12 pb-8 sm:pt-16 sm:pb-12 text-center">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="blob-glow-purple absolute left-1/2 top-1/2 h-[450px] w-[450px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25" />
        </div>
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <div className="pill-badge mb-4">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            {t("eyebrow")}
          </div>
          <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            {t("title")}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            {t("subtitle")}
          </p>

          {/* Trust strip */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground sm:text-sm">
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-primary" />
              {t("trust1")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-primary" />
              {t("trust2")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-primary" />
              {t("trust3")}
            </span>
          </div>
        </div>
      </section>

      {/* Pricing cards (gói tháng) */}
      <Pricing hideHeader />

      {/* Credit packs (topup pay-as-you-go) */}
      <CreditPacks />

      {/* Comparison table */}
      <section className="py-14 sm:py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <div className="text-center mb-8">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-primary mb-2">
              {t("compareEyebrow")}
            </div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {t("compareTitle")}
            </h2>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card/40 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/20">
                    <th className="text-left text-xs font-semibold py-3 px-3 sm:text-sm">
                      {t("feature")}
                    </th>
                    <th className="text-center text-xs font-semibold py-3 px-3 sm:text-sm">
                      Free
                    </th>
                    <th className="text-center text-xs font-semibold py-3 px-3 sm:text-sm">
                      Pro
                    </th>
                    <th className="text-center text-xs font-semibold py-3 px-3 text-primary bg-primary/5 sm:text-sm">
                      Studio
                    </th>
                    <th className="text-center text-xs font-semibold py-3 px-3 sm:text-sm">
                      Premium
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row, i) => (
                    <tr
                      key={row}
                      className={`border-b border-border/40 last:border-b-0 ${
                        i % 2 === 1 ? "bg-muted/10" : ""
                      }`}
                    >
                      <td className="text-xs py-3 px-3 font-medium sm:text-sm">
                        {t(`comparison.${row}`)}
                      </td>
                      <td className="text-xs text-center py-3 px-3 text-muted-foreground sm:text-sm">
                        {t(`comparison.${row}Free`)}
                      </td>
                      <td className="text-xs text-center py-3 px-3 sm:text-sm">
                        {t(`comparison.${row}Pro`)}
                      </td>
                      <td className="text-xs text-center py-3 px-3 font-semibold bg-primary/5 sm:text-sm">
                        {t(`comparison.${row}Studio`)}
                      </td>
                      <td className="text-xs text-center py-3 px-3 sm:text-sm">
                        {t(`comparison.${row}Premium`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Value props strip */}
      <section className="py-10 border-y border-border/40 bg-card/20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <div className="grid gap-5 sm:grid-cols-3">
            <ValueProp
              icon={InfinityIcon}
              title={t("valueLifetimeTitle")}
              desc={t("valueLifetimeDesc")}
            />
            <ValueProp
              icon={CreditCard}
              title={t("valueCancelTitle")}
              desc={t("valueCancelDesc")}
            />
            <ValueProp
              icon={Headphones}
              title={t("valueSupportTitle")}
              desc={t("valueSupportDesc")}
            />
          </div>
        </div>
      </section>

      {/* LTD + Guarantee */}
      <section className="py-14 sm:py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {t("offersTitle")}
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
              {t("offersSubtitle")}
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="relative rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card/40 to-card/20 p-6 overflow-hidden">
              <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-primary/15 blur-2xl" />
              <Sparkles className="h-6 w-6 text-primary mb-3" />
              <h3 className="text-lg font-semibold mb-1.5">{t("ltdTitle")}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                {t("ltdDesc")}
              </p>
              <Link
                href="/contact"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
              >
                {t("ltdCta")}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
              <ShieldCheck className="h-6 w-6 text-primary mb-3" />
              <h3 className="text-lg font-semibold mb-1.5">
                {t("guaranteeTitle")}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                {t("guaranteeDesc")}
              </p>
              <ul className="space-y-1.5 text-sm">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>{t("guarantee1")}</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>{t("guarantee2")}</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>{t("guarantee3")}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <FAQ />

      {/* Final CTA */}
      <section className="relative overflow-hidden py-14 sm:py-20 border-t border-border/40">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="blob-glow-purple absolute left-1/2 top-1/2 h-[320px] w-[320px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25" />
        </div>
        <div className="mx-auto max-w-2xl px-4 sm:px-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {t("finalCtaTitle")}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
            {t("finalCtaSubtitle")}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/download"
              className="btn-glow inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105"
            >
              {t("finalCtaPrimary")}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-muted/40"
            >
              {t("finalCtaSecondary")}
            </Link>
          </div>
        </div>
      </section>
    </PageShell>
  );
}

function ValueProp({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-gradient-to-br from-primary/15 to-accent/10">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <div className="text-sm font-semibold mb-0.5">{title}</div>
        <div className="text-xs text-muted-foreground leading-relaxed sm:text-sm">{desc}</div>
      </div>
    </div>
  );
}
