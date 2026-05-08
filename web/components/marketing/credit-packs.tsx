"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Film, ArrowRight, Loader2 } from "lucide-react";
import { fetchCreditPacks, type CreditPack } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

/**
 * CreditPacks — section topup phút lồng tiếng (dubbing minutes).
 * Đặt sau Pricing tier cards. Style minimal, clean — focus 3 tiers.
 */
export function CreditPacks() {
  const t = useTranslations("landing.pricing");
  const locale = useLocale();
  const { user } = useAuth();
  const [packs, setPacks] = useState<CreditPack[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCreditPacks()
      .then((r) => setPacks(r.packs || []))
      .catch(() => setPacks([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="relative overflow-hidden border-y border-border/40 py-16 sm:py-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        {/* Header — minimal */}
        <div className="text-center mb-10">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <Film className="h-3 w-3" />
            {t("creditsEyebrow")}
          </div>
          <h2 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
            {t("creditsTitle")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
            {t("creditsSubtitle")}
          </p>
        </div>

        {/* Topup cards */}
        {loading ? (
          <div className="text-center py-10">
            <Loader2 className="h-5 w-5 animate-spin inline-block text-muted-foreground" />
          </div>
        ) : !packs || packs.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">
            {t("creditsLoginRequired")}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {packs.map((pack) => (
              <PackCard key={pack.id} pack={pack} t={t} locale={locale} isAuthed={!!user} />
            ))}
          </div>
        )}

        {/* Fair use disclaimer */}
        <p className="mt-6 text-center text-[11px] text-muted-foreground/70">
          {t("fairUseHint")}
        </p>
      </div>
    </section>
  );
}

function PackCard({
  pack,
  t,
  locale,
  isAuthed,
}: {
  pack: CreditPack;
  t: ReturnType<typeof useTranslations>;
  locale: string;
  isAuthed: boolean;
}) {
  const priceDisplay = locale === "vi"
    ? `${(pack.price_vnd / 1_000).toFixed(0)}k`
    : `$${(pack.price_usd / 100).toFixed(0)}`;

  const checkoutHref = isAuthed
    ? `/checkout/credits/${pack.id}`
    : `/sign-in?next=${encodeURIComponent(`/checkout/credits/${pack.id}`)}`;

  return (
    <Link
      href={checkoutHref}
      className={`group relative flex items-center justify-between rounded-2xl border bg-card/40 p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 ${
        pack.is_popular ? "border-primary/40 ring-1 ring-primary/20" : "border-border/60"
      }`}
    >
      <div>
        <div className="flex items-center gap-2 text-base font-bold">
          <Film className="h-4 w-4 text-primary" />
          {pack.name}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {t("creditsBuy")}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-2xl font-bold">{priceDisplay}</div>
          {locale === "vi" && (
            <div className="text-[10px] uppercase text-muted-foreground/60">VND</div>
          )}
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}
