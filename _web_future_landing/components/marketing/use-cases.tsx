import { useTranslations } from "next-intl";
import { Video, GraduationCap, Mic, Briefcase } from "lucide-react";

const ICONS = {
  creator: Video,
  edu:     GraduationCap,
  podcast: Mic,
  agency:  Briefcase,
} as const;

const KEYS = ["creator", "edu", "podcast", "agency"] as const;

export function UseCases() {
  const t = useTranslations("landing.useCases");

  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="text-center mb-12">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">
            {t("eyebrow")}
          </div>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("title")}
          </h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {KEYS.map((k) => {
            const Icon = ICONS[k];
            return (
              <div key={k}
                   className="rounded-xl border border-border/60 bg-card/40 p-5 hover:border-primary/40 transition-colors">
                <Icon className="h-6 w-6 text-primary mb-3" />
                <h3 className="text-base font-semibold mb-1">{t(`items.${k}.title`)}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{t(`items.${k}.desc`)}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
