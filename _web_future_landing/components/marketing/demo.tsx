import { useTranslations } from "next-intl";
import { Play } from "lucide-react";

export function Demo() {
  const t = useTranslations("landing.demo");

  return (
    <section id="demo" className="py-20 sm:py-28">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="text-center mb-10">
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

        {/* Video placeholder */}
        <div className="relative aspect-video rounded-2xl border border-border/60 bg-card/40 overflow-hidden group">
          <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-pink-500/10" />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
            <button
              className="mb-5 grid h-16 w-16 place-items-center rounded-full bg-primary text-primary-foreground shadow-2xl shadow-primary/40 transition-transform hover:scale-105"
              aria-label="Play demo"
              type="button"
            >
              <Play className="h-7 w-7 fill-current ml-0.5" />
            </button>
            <div className="text-sm font-semibold">{t("watchLabel")}</div>
            <p className="mt-2 text-xs text-muted-foreground max-w-md">
              {t("placeholder")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
