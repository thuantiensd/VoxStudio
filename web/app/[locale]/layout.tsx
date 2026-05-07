import type { Metadata } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth-context";
import "../globals.css";

// Be Vietnam Pro — sans-serif designed cho tiếng Việt + Latin, render đẹp
// dấu thanh + chữ cái có dấu (ô, ơ, ư, ă, đ). Subset latin + vietnamese
// để bundle nhỏ, không tải tất cả glyph.
const beVietnam = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-be-vietnam",
  display: "swap",
});

export const metadata: Metadata = {
  title:
    "VoxStudio — Chuyển văn bản thành giọng nói AI · Lồng tiếng video tiếng Việt",
  description:
    "VoxStudio: nền tảng AI chuyển văn bản thành giọng nói (text-to-speech) tiếng Việt tự nhiên, lồng tiếng video chuyên nghiệp, nhân bản giọng nói trong 5 giây. Hỗ trợ 646 ngôn ngữ. Miễn phí dùng thử.",
  keywords: [
    "chuyển văn bản thành giọng nói",
    "text to speech tiếng việt",
    "TTS tiếng việt",
    "lồng tiếng video AI",
    "đọc văn bản AI",
    "AI voice tiếng việt",
    "voice cloning",
    "nhân bản giọng nói",
    "phần mềm lồng tiếng",
    "VoxStudio",
  ],
  openGraph: {
    title:
      "VoxStudio — Chuyển văn bản thành giọng nói AI · Lồng tiếng video tiếng Việt",
    description:
      "AI đọc văn bản tự nhiên như người thật · Lồng tiếng video chuẩn phòng thu · Nhân bản giọng 5 giây · 646 ngôn ngữ.",
    type: "website",
    images: ["/logo.png"],
  },
  robots: { index: true, follow: true },
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
    <html lang={locale} className={`dark ${beVietnam.variable}`} suppressHydrationWarning>
      <body className="min-h-full bg-background font-sans antialiased" style={{ fontFamily: "var(--font-be-vietnam), Inter, system-ui, sans-serif" }}>
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
