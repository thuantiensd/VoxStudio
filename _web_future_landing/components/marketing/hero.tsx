import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { ArrowRight, Play, Apple } from "lucide-react";

export function Hero() {
  const t = useTranslations("landing.hero");

  return (
    <section className="relative overflow-hidden py-20 sm:py-28">
      {/* Decorative gradient blur */}
      <div aria-hidden
           className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
        <div className="h-[500px] w-[800px] rounded-full bg-primary/15 blur-3xl" />
      </div>
      <div aria-hidden
           className="pointer-events-none absolute -top-20 right-1/3 -z-10 h-[300px] w-[300px] rounded-full bg-pink-500/10 blur-3xl" />

      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/50 px-3 py-1 text-xs text-muted-foreground backdrop-blur-sm">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          {t("badge")}
        </div>

        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
          {t("headline")}
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg">
          {t("subheadline")}
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/download"
            className={`${buttonVariants({ size: "lg" })} w-full sm:w-auto`}
          >
            <Apple className="mr-2 h-4 w-4" />
            {t("ctaPrimary")}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
          <Link
            href="/#demo"
            className={`${buttonVariants({ size: "lg", variant: "outline" })} w-full sm:w-auto`}
          >
            <Play className="mr-2 h-4 w-4" />
            {t("ctaSecondary")}
          </Link>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          {t("platforms")}
        </p>
      </div>
    </section>
  );
}
