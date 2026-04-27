import { useTranslations } from "next-intl";
import { PageShell } from "@/components/marketing/page-shell";
import { Pricing } from "@/components/marketing/pricing";
import { Sparkles, ShieldCheck } from "lucide-react";

const ROWS = [
  "dubLength", "voiceClones", "downloads", "batch", "byok", "support",
] as const;

export default function PricingPage() {
  const t = useTranslations("pricingPage");

  return (
    <PageShell>
      <section className="py-16 sm:py-20 text-center border-b border-border/40">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
            {t("subtitle")}
          </p>
        </div>
      </section>

      <Pricing />

      {/* Comparison table */}
      <section className="py-16 border-t border-border/40">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight mb-8 text-center">
            {t("compareTitle")}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="text-left text-sm font-semibold py-4 px-4">
                    {t("feature")}
                  </th>
                  <th className="text-center text-sm font-semibold py-4 px-4">Free</th>
                  <th className="text-center text-sm font-semibold py-4 px-4 text-primary">
                    Pro
                  </th>
                  <th className="text-center text-sm font-semibold py-4 px-4">Studio</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row} className="border-b border-border/40">
                    <td className="text-sm py-4 px-4 font-medium">
                      {t(`comparison.${row}`)}
                    </td>
                    <td className="text-sm text-center py-4 px-4 text-muted-foreground">
                      {t(`comparison.${row}Free`)}
                    </td>
                    <td className="text-sm text-center py-4 px-4 font-medium">
                      {t(`comparison.${row}Pro`)}
                    </td>
                    <td className="text-sm text-center py-4 px-4 text-muted-foreground">
                      {t(`comparison.${row}Studio`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* LTD + Guarantee */}
      <section className="py-16 border-t border-border/40 bg-card/20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-border/60 bg-background p-6">
            <Sparkles className="h-6 w-6 text-primary mb-3" />
            <h3 className="text-lg font-semibold mb-2">{t("ltdTitle")}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{t("ltdDesc")}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background p-6">
            <ShieldCheck className="h-6 w-6 text-primary mb-3" />
            <h3 className="text-lg font-semibold mb-2">{t("guaranteeTitle")}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{t("guaranteeDesc")}</p>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
