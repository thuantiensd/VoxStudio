import { useTranslations } from "next-intl";
import { Globe2, Mic2, Cpu, FileVideo } from "lucide-react";

export function Trust() {
  const t = useTranslations("landing.trust");

  const stats = [
    { icon: Globe2,    label: t("stat1"), value: t("stat1Value") },
    { icon: Mic2,      label: t("stat2"), value: t("stat2Value") },
    { icon: Cpu,       label: t("stat3"), value: t("stat3Value") },
    { icon: FileVideo, label: t("stat4"), value: t("stat4Value") },
  ];

  return (
    <section className="border-y border-border/40 bg-card/30 py-10">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="flex flex-col items-center text-center">
                <Icon className="h-5 w-5 text-primary mb-2" />
                <div className="text-xs text-muted-foreground">{s.label}</div>
                <div className="mt-0.5 text-sm font-semibold">{s.value}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
