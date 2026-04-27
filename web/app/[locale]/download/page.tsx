import { useTranslations } from "next-intl";
import { PageShell } from "@/components/marketing/page-shell";
import { buttonVariants } from "@/components/ui/button";
import {
  Apple, Monitor, Terminal, Download as DownloadIcon, Clock, HardDrive, Cpu,
} from "lucide-react";
import {
  DOWNLOADS, downloadUrl, LATEST_VERSION, RELEASED_AT,
} from "@/lib/downloads";

export default function DownloadPage() {
  const t = useTranslations("downloadPage");

  const cards = [
    { key: "macArm" as const,   icon: Apple,    title: t("macArm"),   primary: true },
    { key: "macIntel" as const, icon: Apple,    title: t("macIntel") },
    { key: "windows" as const,  icon: Monitor,  title: t("windows") },
    { key: "linux" as const,    icon: Terminal, title: t("linux") },
  ];

  return (
    <PageShell>
      {/* Hero */}
      <section className="py-16 sm:py-20 text-center border-b border-border/40">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">
            {t("eyebrow")}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-4 text-base text-muted-foreground sm:text-lg">
            {t("subtitle")}
          </p>
          <div className="mt-6 inline-flex items-center gap-3 rounded-full border border-border/60 bg-card/40 px-4 py-1.5 text-xs">
            <span className="font-mono font-semibold">{t("version")} {LATEST_VERSION}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{t("released")} {RELEASED_AT}</span>
          </div>
        </div>
      </section>

      {/* Download cards */}
      <section className="py-12">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {cards.map((c) => {
              const meta = DOWNLOADS[c.key];
              const Icon = c.icon;
              const url = downloadUrl(c.key);
              return (
                <div
                  key={c.key}
                  className={`relative rounded-2xl border bg-card/40 p-6 ${
                    c.primary ? "border-primary/60 shadow-lg shadow-primary/10" : "border-border/60"
                  }`}
                >
                  {c.primary && (
                    <div className="absolute -top-3 right-5 px-2.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wider">
                      {t("latest")}
                    </div>
                  )}
                  <div className="flex items-start gap-4">
                    <div className="grid h-12 w-12 place-items-center rounded-lg bg-primary/10 text-primary flex-shrink-0">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold">{c.title}</h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span>{t("version")} {LATEST_VERSION}</span>
                        {meta.available && (
                          <span>·  {t("size")} {meta.size}</span>
                        )}
                      </div>
                      <div className="mt-4">
                        {meta.available ? (
                          <a
                            href={url}
                            className={`${buttonVariants({ size: "sm" })} inline-flex`}
                          >
                            <DownloadIcon className="mr-1.5 h-3.5 w-3.5" />
                            {t("downloadNow")}
                          </a>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium border border-border/60 text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {t("comingSoon")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Instructions */}
      <section className="py-12 border-t border-border/40 bg-card/20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="text-2xl font-semibold mb-6">{t("instructionsTitle")}</h2>
          <ol className="space-y-3">
            {(["mac1", "mac2", "mac3"] as const).map((k, i) => (
              <li key={k} className="flex gap-4">
                <div className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-primary text-xs font-bold flex-shrink-0">
                  {i + 1}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed pt-0.5">
                  {t(`instructions.${k}`)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* System requirements */}
      <section className="py-12 border-t border-border/40">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-primary" />
            {t("systemReq")}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("systemReqMac")}
          </p>
        </div>
      </section>

      {/* Checksum */}
      <section className="py-12 border-t border-border/40 bg-card/20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="text-2xl font-semibold mb-2 flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            {t("checksumTitle")}
          </h2>
          <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
            {t("checksumDesc")}
          </p>
          <pre className="rounded-lg border border-border/60 bg-card/60 p-4 text-xs font-mono overflow-x-auto">
{`shasum -a 256 ~/Downloads/VoxStudio-arm64.dmg`}
          </pre>
        </div>
      </section>
    </PageShell>
  );
}
