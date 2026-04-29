import type { Metadata } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth-context";
import "../globals.css";

export const metadata: Metadata = {
  title: "VoxStudio — Lồng tiếng video chuyên nghiệp bằng AI",
  description:
    "Phần mềm desktop lồng tiếng AI, clone giọng 3 giây, dịch phụ đề. Chạy trên máy của bạn, riêng tư, miễn phí dùng thử. Dành cho creator và studio.",
  openGraph: {
    title: "VoxStudio — Lồng tiếng video chuyên nghiệp bằng AI",
    description:
      "Auto Dub video, voice clone, dịch phụ đề bằng AI — chạy trực tiếp trên máy bạn.",
    type: "website",
    images: ["/logo.png"],
  },
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  return (
    <html lang={locale} className="dark" suppressHydrationWarning>
      <body className="min-h-full bg-background font-sans antialiased">
        <NextIntlClientProvider>
          <AuthProvider>
            <TooltipProvider>
              {children}
              <Toaster />
            </TooltipProvider>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
