"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";

const KEYS = ["q1", "q2", "q3", "q4", "q5", "q6"] as const;

export function FAQ() {
  const t = useTranslations("landing.faq");
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="text-center mb-10">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">
            {t("eyebrow")}
          </div>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("title")}
          </h2>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/40 divide-y divide-border/40">
          {KEYS.map((k) => {
            const open = openKey === k;
            return (
              <div key={k}>
                <button
                  onClick={() => setOpenKey(open ? null : k)}
                  className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-muted/30 transition-colors"
                >
                  <span className="flex-1 text-sm font-medium">{t(`items.${k}.q`)}</span>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${
                      open ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {open && (
                  <div className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed">
                    {t(`items.${k}.a`)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
