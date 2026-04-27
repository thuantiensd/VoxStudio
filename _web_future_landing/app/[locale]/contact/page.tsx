import { useTranslations } from "next-intl";
import { PageShell } from "@/components/marketing/page-shell";
import { Mail, MessageCircle, Code2, Building2 } from "lucide-react";

const CHANNELS = [
  { key: "email",  icon: Mail,          href: "mailto:voxstudio.vn@gmail.com" },
  { key: "zalo",   icon: MessageCircle, href: null },
  { key: "github", icon: Code2,         href: "https://github.com/thuantiensd/VoxStudio" },
] as const;

export default function ContactPage() {
  const t = useTranslations("contactPage");

  return (
    <PageShell>
      <section className="py-16 sm:py-20 text-center border-b border-border/40">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
            {t("subtitle")}
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 grid gap-5 md:grid-cols-3">
          {CHANNELS.map((c) => {
            const Icon = c.icon;
            const Wrap: React.ElementType = c.href ? "a" : "div";
            const wrapProps = c.href
              ? { href: c.href, target: c.href.startsWith("http") ? "_blank" : undefined,
                  rel: c.href.startsWith("http") ? "noopener noreferrer" : undefined }
              : {};
            return (
              <Wrap
                key={c.key}
                {...wrapProps}
                className="group rounded-2xl border border-border/60 bg-card/40 p-6 transition-colors hover:border-primary/40 block"
              >
                <Icon className="h-6 w-6 text-primary mb-3" />
                <h3 className="text-base font-semibold mb-1">
                  {t(`channels.${c.key}Title`)}
                </h3>
                <div className="text-sm font-mono text-primary mb-2 break-all">
                  {t(`channels.${c.key}Value`)}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t(`channels.${c.key}Desc`)}
                </p>
              </Wrap>
            );
          })}
        </div>
      </section>

      <section className="py-12 border-t border-border/40 bg-card/20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <Building2 className="h-7 w-7 text-primary mb-3" />
          <h2 className="text-xl font-semibold mb-2">{t("businessTitle")}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("businessDesc")}
          </p>
        </div>
      </section>
    </PageShell>
  );
}
