import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Check, ArrowRight } from "lucide-react";

const PLAN_KEYS = ["free", "pro", "studio"] as const;
type PlanKey = (typeof PLAN_KEYS)[number];

export function Pricing({ hideHeader = false }: { hideHeader?: boolean } = {}) {
  const t = useTranslations("landing.pricing");
  const locale = useLocale();

  return (
    <section
      id="pricing"
      className={`bg-card/20 border-y border-border/40 ${hideHeader ? "py-12 sm:py-16 border-t-0" : "py-20 sm:py-28"}`}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {!hideHeader && (
          <div className="text-center mb-12">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">
              {t("eyebrow")}
            </div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("title")}
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-base text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3 max-w-5xl mx-auto">
          {PLAN_KEYS.map((key) => (
            <PlanCard key={key} planKey={key} locale={locale} />
          ))}
        </div>

        <p className="mt-10 text-center text-sm text-muted-foreground">
          {t("ltdHint")}
        </p>
        {!hideHeader && (
          <div className="mt-4 text-center">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {t("viewFull")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

function PlanCard({ planKey, locale }: { planKey: PlanKey; locale: string }) {
  const t = useTranslations(`landing.pricing.${planKey}`);
  const tShared = useTranslations("landing.pricing");
  const features = t.raw("features") as string[];
  const isPro = planKey === "pro";
  const isFree = planKey === "free";

  const priceUsd = t("price");
  const priceVnd = isFree ? null : (t("priceVnd") as string);
  const displayPrice = locale === "vi" && priceVnd ? priceVnd : priceUsd;

  return (
    <div className={`relative rounded-2xl border bg-background p-6 sm:p-7 flex flex-col ${
      isPro ? "border-primary shadow-lg shadow-primary/10" : "border-border/60"
    }`}>
      {isPro && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wider">
          {tShared("popular")}
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-base font-bold mb-1">{t("name")}</h3>
        <p className="text-xs text-muted-foreground">{t("desc")}</p>
      </div>

      <div className="mb-6 flex items-baseline gap-1">
        <span className="text-3xl font-bold">{displayPrice}</span>
        {!isFree && (
          <span className="text-sm text-muted-foreground">{tShared("perMonth")}</span>
        )}
      </div>

      <ul className="mb-7 space-y-2.5 flex-1">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <Link
        href={isFree ? "/sign-up" : `/checkout/${planKey}`}
        className={buttonVariants({
          size: "lg",
          variant: isPro ? "default" : "outline",
        })}
      >
        {t("cta")}
      </Link>
    </div>
  );
}
