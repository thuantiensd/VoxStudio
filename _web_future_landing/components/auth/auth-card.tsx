import Image from "next/image";
import { Link } from "@/i18n/navigation";

export function AuthCard({
  title, subtitle, children, footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen flex flex-col bg-background overflow-hidden">
      {/* Decorative gradient blur */}
      <div aria-hidden
           className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
        <div className="h-[420px] w-[700px] rounded-full bg-primary/15 blur-3xl" />
      </div>
      <div aria-hidden
           className="pointer-events-none absolute -top-32 right-1/3 -z-10 h-[260px] w-[260px] rounded-full bg-pink-500/10 blur-3xl" />

      <header className="border-b border-border/40 py-4 backdrop-blur-md bg-background/40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Link href="/" className="inline-flex items-center gap-2">
            <Image src="/logo.png" alt="VoxStudio" width={28} height={28}
                   className="h-7 w-7 rounded-md" />
            <span className="text-sm font-semibold">VoxStudio</span>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 py-10 sm:p-8">
        <div className="w-full max-w-[440px]">
          <div className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur-md p-7 sm:p-8 shadow-2xl shadow-black/20">
            <h1 className="text-2xl sm:text-[26px] font-semibold tracking-tight mb-2">
              {title}
            </h1>
            {subtitle && (
              <p className="text-sm text-muted-foreground mb-7 leading-relaxed">
                {subtitle}
              </p>
            )}
            {children}
          </div>
          {footer && (
            <div className="mt-5 text-center text-sm text-muted-foreground">
              {footer}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
