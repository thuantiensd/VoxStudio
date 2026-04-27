import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { ArrowRight, Play } from "lucide-react";

export function CTA() {
  const t = useTranslations("landing.cta");

  return (
    <section className="relative overflow-hidden border-t border-border/60 py-20 sm:py-24">
      <div aria-hidden
           className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
        <div className="h-[400px] w-[700px] rounded-full bg-primary/15 blur-3xl" />
      </div>
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          {t("title")}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          {t("subtitle")}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/download"
                className={`${buttonVariants({ size: "lg" })} w-full sm:w-auto`}>
            {t("button")}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
          <Link href="/#demo"
                className={`${buttonVariants({ size: "lg", variant: "outline" })} w-full sm:w-auto`}>
            <Play className="mr-2 h-4 w-4" />
            {t("secondary")}
          </Link>
        </div>
      </div>
    </section>
  );
}
