import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalPage } from "@/components/marketing/legal-page";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "privacyPage" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: {
      canonical: `/${locale}/privacy`,
      languages: {
        vi: "/vi/privacy",
        en: "/en/privacy",
      },
    },
    openGraph: {
      title: t("metaTitle"),
      description: t("metaDescription"),
      type: "article",
      locale,
    },
    robots: { index: true, follow: true },
  };
}

export default function PrivacyPage() {
  return <LegalPage namespace="privacyPage" />;
}
