import { useTranslations } from "next-intl";
import {
  Mic2, Wand2, Captions, FileText, KeyRound,
  BookOpen, Layers, Download, Lock,
} from "lucide-react";

const FEATURE_ICONS = {
  dub:           Wand2,
  voiceClone:    Mic2,
  subtitleEditor: Captions,
  stt:           FileText,
  byok:          KeyRound,
  topicGlossary: BookOpen,
  batch:         Layers,
  downloader:    Download,
  privacy:       Lock,
} as const;

const ITEM_KEYS = [
  "dub", "voiceClone", "subtitleEditor", "stt", "byok",
  "topicGlossary", "batch", "downloader", "privacy",
] as const;

export function Features() {
  const t = useTranslations("landing.features");

  return (
    <section id="features" className="py-20 sm:py-28 bg-card/20 border-y border-border/40">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
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

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {ITEM_KEYS.map((k) => {
            const Icon = FEATURE_ICONS[k];
            return (
              <div
                key={k}
                className="group relative rounded-2xl border border-border/60 bg-card/50 p-6 transition-colors hover:border-primary/40"
              >
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mb-1.5 text-base font-semibold">
                  {t(`items.${k}.title`)}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t(`items.${k}.desc`)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
