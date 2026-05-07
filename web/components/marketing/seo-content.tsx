import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Mic2, Film, Wand2, Globe2, ArrowRight } from "lucide-react";

/**
 * SeoContent — long-form content section nhắm tới SEO + giải thích sản phẩm.
 * Đặt sau FAQ (gần cuối page) để Google index được nội dung keyword-rich.
 *
 * Strategy: cluster các từ khoá chính (chuyển văn bản thành giọng nói,
 * text to speech tiếng Việt, lồng tiếng video AI, voice cloning) trong
 * H2/H3 + paragraphs tự nhiên, không stuffing.
 */
export function SeoContent() {
  const t = useTranslations("landing.seo");

  return (
    <section className="relative overflow-hidden border-y border-border/40 bg-card/20 py-20 sm:py-28">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="blob-glow-purple absolute right-1/4 top-1/2 h-[400px] w-[400px] -translate-y-1/2 rounded-full opacity-20" />
      </div>

      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        {/* Section header */}
        <div className="text-center mb-12 sm:mb-16">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">
            {t("eyebrow")}
          </div>
          <h2 className="mx-auto max-w-3xl text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            {t("title")}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
            {t("subtitle")}
          </p>
        </div>

        {/* Content blocks — h3 + paragraphs */}
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-10">
          <ContentBlock
            icon={Mic2}
            title={t("ttsTitle")}
            paragraphs={[t("ttsP1"), t("ttsP2")]}
          />
          <ContentBlock
            icon={Film}
            title={t("dubbingTitle")}
            paragraphs={[t("dubbingP1"), t("dubbingP2")]}
          />
          <ContentBlock
            icon={Wand2}
            title={t("cloneTitle")}
            paragraphs={[t("cloneP1"), t("cloneP2")]}
          />
          <ContentBlock
            icon={Globe2}
            title={t("globalTitle")}
            paragraphs={[t("globalP1"), t("globalP2")]}
          />
        </div>

        {/* Trust paragraph + CTA */}
        <div className="mt-14 rounded-2xl border border-border/60 bg-card/40 p-6 sm:p-8">
          <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {t("trustTitle")}
          </h3>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed sm:text-base">
            {t("trustBody")}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/#features"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              {t("ctaFeatures")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <span className="text-muted-foreground/40">·</span>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              {t("ctaPricing")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function ContentBlock({
  icon: Icon,
  title,
  paragraphs,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  paragraphs: string[];
}) {
  return (
    <article className="group">
      <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-gradient-to-br from-primary/15 to-accent/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <h3 className="text-xl font-semibold tracking-tight mb-3 sm:text-2xl">
        {title}
      </h3>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </article>
  );
}
