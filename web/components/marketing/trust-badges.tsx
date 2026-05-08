import { useTranslations } from "next-intl";
import { Lock, RotateCcw, Zap, Activity } from "lucide-react";

/**
 * TrustBadges — 4 badges premium SaaS (Stripe, refund, GPU, uptime).
 * Đặt dưới pricing để build trust trước khi user click CTA.
 */
export function TrustBadges() {
  const t = useTranslations("landing.pricing.trust");

  const badges = [
    { icon: Lock, label: t("stripe"), sub: t("stripeSub") },
    { icon: RotateCcw, label: t("refund"), sub: t("refundSub") },
    { icon: Zap, label: t("gpu"), sub: t("gpuSub") },
    { icon: Activity, label: t("uptime"), sub: t("uptimeSub") },
  ];

  return (
    <section className="border-y border-border/40 bg-card/20 py-10 sm:py-12">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
          {badges.map(({ icon: Icon, label, sub }, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-xl border border-border/40 bg-background/40 p-4 backdrop-blur-sm"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/5">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold">{label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
