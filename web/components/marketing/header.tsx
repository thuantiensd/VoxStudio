"use client";
import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/marketing/language-switcher";
import { Menu, X, User as UserIcon, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export function MarketingHeader() {
  const t = useTranslations();
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);

  const navItems = [
    { href: "/#features", label: t("nav.features") },
    { href: "/pricing",   label: t("nav.pricing") },
    { href: "/download",  label: t("nav.download") },
    { href: "/contact",   label: t("nav.contact") },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.png" alt="VoxStudio" width={28} height={28}
                 className="h-7 w-7 rounded-md" priority />
          <span className="text-sm font-semibold tracking-tight">
            {t("brand.name")}
          </span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}
                  className="hover:text-foreground transition-colors">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground hidden sm:inline-flex" />
          ) : user ? (
            <Link href="/account"
                  className={`${buttonVariants({ variant: "outline", size: "sm" })} hidden sm:inline-flex`}>
              <UserIcon className="mr-1.5 h-3.5 w-3.5" />
              {t("nav.account")}
            </Link>
          ) : (
            <>
              <Link href="/sign-in"
                    className={`${buttonVariants({ variant: "ghost", size: "sm" })} hidden sm:inline-flex`}>
                {t("nav.signIn")}
              </Link>
              <Link href="/download"
                    className={`${buttonVariants({ size: "sm" })} hidden sm:inline-flex`}>
                {t("nav.downloadCta")}
              </Link>
            </>
          )}
          <button onClick={() => setOpen((o) => !o)}
                  className="md:hidden p-2 rounded-md hover:bg-muted"
                  aria-label="Menu">
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden border-t border-border/40 bg-background">
          <nav className="mx-auto max-w-6xl px-4 py-3 flex flex-col gap-1 text-sm">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}
                    onClick={() => setOpen(false)}
                    className="px-2 py-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                {item.label}
              </Link>
            ))}
            {user ? (
              <Link href="/account" onClick={() => setOpen(false)}
                    className={`${buttonVariants({ size: "sm", variant: "outline" })} mt-2`}>
                {t("nav.account")}
              </Link>
            ) : (
              <>
                <Link href="/sign-in" onClick={() => setOpen(false)}
                      className={`${buttonVariants({ size: "sm", variant: "outline" })} mt-2`}>
                  {t("nav.signIn")}
                </Link>
                <Link href="/download" onClick={() => setOpen(false)}
                      className={`${buttonVariants({ size: "sm" })} mt-1`}>
                  {t("nav.downloadCta")}
                </Link>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
