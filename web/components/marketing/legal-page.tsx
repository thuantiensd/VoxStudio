"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PageShell } from "@/components/marketing/page-shell";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";

type Section = { title: string; body: string };

/**
 * LegalPage — shared layout cho Terms + Privacy.
 *
 * Tính năng:
 *   - Back button + breadcrumb về trang chủ
 *   - Sticky table of contents (anchor links) trên desktop
 *   - Article semantic + h1/h2 hierarchy chuẩn SEO
 *   - Last updated date
 */
export function LegalPage({
  namespace,
}: {
  namespace: "termsPage" | "privacyPage";
}) {
  const t = useTranslations(namespace);
  const sections = t.raw("sections") as Section[];
  const isTerms = namespace === "termsPage";
  const Icon = isTerms ? FileText : ShieldCheck;

  return (
    <PageShell>
      <article className="py-10 sm:py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          {/* Back button */}
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("backHome")}
          </Link>

          {/* Header */}
          <div className="mt-6 mb-10 border-b border-border/40 pb-8">
            <div className="flex items-start gap-4">
              <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-gradient-to-br from-primary/15 to-accent/10 sm:flex">
                <Icon className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                  {t("title")}
                </h1>
                <p className="mt-2 text-xs text-muted-foreground sm:text-sm">
                  {t("lastUpdated")}
                </p>
              </div>
            </div>
            <p className="mt-6 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              {t("intro")}
            </p>
          </div>

          {/* Body — TOC + content */}
          <div className="grid gap-10 lg:grid-cols-[220px_1fr] lg:gap-12">
            {/* TOC — sticky on desktop */}
            <aside className="hidden lg:block">
              <div className="sticky top-24">
                <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">
                  {t("tocTitle")}
                </div>
                <nav className="flex flex-col gap-1.5">
                  {sections.map((s, i) => (
                    <a
                      key={i}
                      href={`#section-${i}`}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {s.title}
                    </a>
                  ))}
                </nav>
              </div>
            </aside>

            {/* Sections */}
            <div className="max-w-3xl space-y-8">
              {sections.map((s, i) => (
                <section
                  key={i}
                  id={`section-${i}`}
                  className="scroll-mt-24"
                >
                  <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
                    {s.title}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
                    {s.body}
                  </p>
                </section>
              ))}

              {/* Footer note */}
              <div className="mt-12 rounded-xl border border-border/60 bg-card/40 p-5">
                <p className="text-sm text-muted-foreground">
                  {t("footerNote")}{" "}
                  <Link
                    href="/contact"
                    className="font-semibold text-primary hover:underline"
                  >
                    {t("footerCta")}
                  </Link>
                  .
                </p>
              </div>
            </div>
          </div>
        </div>
      </article>
    </PageShell>
  );
}
