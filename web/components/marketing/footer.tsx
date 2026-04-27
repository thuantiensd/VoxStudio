import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function MarketingFooter() {
  const t = useTranslations("landing.footer");
  const tBrand = useTranslations("brand");

  const sections = [
    {
      title: t("product"),
      links: [
        { href: "/#features", label: t("links.features") },
        { href: "/pricing",   label: t("links.pricing") },
        { href: "/download",  label: t("links.download") },
      ],
    },
    {
      title: t("support"),
      links: [
        { href: "/contact",   label: t("links.contact") },
        { href: "/#faq",      label: t("links.faq") },
        { href: "mailto:voxstudio.vn@gmail.com", label: t("links.support") },
      ],
    },
    {
      title: t("legal"),
      links: [
        { href: "/terms",   label: t("links.terms") },
        { href: "/privacy", label: t("links.privacy") },
      ],
    },
  ];

  return (
    <footer className="border-t border-border/60 bg-card/20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
        <div className="grid gap-8 md:grid-cols-[2fr_1fr_1fr_1fr]">
          {/* Brand */}
          <div>
            <Link href="/" className="flex items-center gap-2 mb-3">
              <Image src="/logo.png" alt="VoxStudio" width={28} height={28}
                     className="h-7 w-7 rounded-md" />
              <span className="text-sm font-bold">{tBrand("name")}</span>
            </Link>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-xs">
              {t("tagline")}
            </p>
          </div>

          {sections.map((section) => (
            <div key={section.title}>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                {section.title}
              </h4>
              <ul className="space-y-2">
                {section.links.map((l) => (
                  <li key={l.href + l.label}>
                    <Link href={l.href}
                          className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 pt-6 border-t border-border/40 text-xs text-muted-foreground">
          {t("copyright")}
        </div>
      </div>
    </footer>
  );
}
