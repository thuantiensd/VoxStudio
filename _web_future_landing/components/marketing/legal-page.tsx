import { useTranslations } from "next-intl";
import { PageShell } from "@/components/marketing/page-shell";

type Section = { title: string; body: string };

export function LegalPage({ namespace }: { namespace: "termsPage" | "privacyPage" }) {
  const t = useTranslations(namespace);
  const sections = t.raw("sections") as Section[];

  return (
    <PageShell>
      <article className="py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("title")}
          </h1>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("lastUpdated")}
          </p>
          <p className="mt-6 text-base text-muted-foreground leading-relaxed">
            {t("intro")}
          </p>

          <div className="mt-10 space-y-8">
            {sections.map((s, i) => (
              <section key={i}>
                <h2 className="text-lg font-semibold mb-2">{s.title}</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {s.body}
                </p>
              </section>
            ))}
          </div>
        </div>
      </article>
    </PageShell>
  );
}
