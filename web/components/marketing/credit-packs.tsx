"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Zap, ArrowRight, Loader2, Check } from "lucide-react";
import { fetchCreditPacks, type CreditPack } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

/**
 * CreditPacks — section bán credit packs (topup), đặt sau Pricing.
 * Gói nhỏ → lớn, có bonus cho gói lớn. Click "Mua ngay" → /checkout/credits/{id}
 * (nếu đã login) hoặc /sign-in?next=...
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

  const formatVnd = (vnd: number) => {
    if (locale === "vi") return `${(vnd / 1000).toFixed(0)}k`;
    return vnd.toLocaleString("vi-VN") + "đ";
  };
  const formatCredits = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
    return n.toLocaleString();
  };

  return (
    <section className="border-y border-border/40 bg-card/20 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">
            {t("creditsEyebrow")}
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight max-w-2xl mx-auto">
            {t("creditsTitle")}
          </h2>
          <p className="mt-3 max-w-xl mx-auto text-sm text-muted-foreground">
            {t("creditsSubtitle")}
          </p>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="text-center py-10">
            <Loader2 className="h-5 w-5 animate-spin inline-block text-muted-foreground" />
          </div>
        ) : !packs || packs.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">
            {t("creditsLoginRequired")}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {packs.map((pack) => (
              <PackCard
                key={pack.id}
                pack={pack}
                formatVnd={formatVnd}
                formatCredits={formatCredits}
                t={t}
                locale={locale}
                isAuthed={!!user}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function PackCard({
  pack,
  formatVnd,
  formatCredits,
  t,
  locale,
  isAuthed,
}: {
  pack: CreditPack;
  formatVnd: (n: number) => string;
  formatCredits: (n: number) => string;
  t: ReturnType<typeof useTranslations>;
  locale: string;
  isAuthed: boolean;
}) {
  const priceDisplay = locale === "vi"
    ? formatVnd(pack.price_vnd)
    : `$${(pack.price_usd / 100).toFixed(0)}`;

  const checkoutHref = isAuthed
    ? `/checkout/credits/${pack.id}`
    : `/sign-in?next=${encodeURIComponent(`/checkout/credits/${pack.id}`)}`;

  return (
    <div
      className={`relative flex flex-col rounded-2xl border bg-background p-5 transition-all hover:shadow-lg ${
        pack.is_popular
          ? "border-primary shadow-lg shadow-primary/10"
          : "border-border/60"
      }`}
    >
      {pack.is_popular && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
          ⭐ HOT
        </div>
      )}

      <div className="mb-4">
        <h3 className="text-lg font-bold">{pack.name}</h3>
      </div>

      <div className="mb-3 flex items-baseline gap-1">
        <span className="text-2xl font-bold">{priceDisplay}</span>
        {locale === "vi" && (
          <span className="text-xs text-muted-foreground">VND</span>
        )}
      </div>

      <div className="mb-4 inline-flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-semibold text-primary self-start">
        <Zap className="h-3 w-3" />
        {t("creditsTotal", { total: formatCredits(pack.total_credits) })}
      </div>

      {pack.bonus_percent > 0 && (
        <div className="mb-3 text-xs text-muted-foreground">
          <span className="text-emerald-500 font-semibold">
            {t("creditsBonus", { percent: pack.bonus_percent })}
          </span>
        </div>
      )}

      <ul className="mb-5 flex-1 space-y-1.5 text-xs text-muted-foreground">
        <li className="flex items-start gap-1.5">
          <Check className="h-3 w-3 text-primary mt-0.5 flex-shrink-0" />
          <span>{formatCredits(pack.base_credits)} ký tự TTS cơ bản</span>
        </li>
        {pack.bonus_credits > 0 && (
          <li className="flex items-start gap-1.5">
            <Check className="h-3 w-3 text-primary mt-0.5 flex-shrink-0" />
            <span>+{formatCredits(pack.bonus_credits)} bonus credits</span>
          </li>
        )}
        <li className="flex items-start gap-1.5">
          <Check className="h-3 w-3 text-primary mt-0.5 flex-shrink-0" />
          <span>Không hết hạn</span>
        </li>
      </ul>

      <Link
        href={checkoutHref}
        className={`flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
          pack.is_popular
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "border border-border/60 hover:bg-muted/40"
        }`}
      >
        {t("creditsBuy")}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
