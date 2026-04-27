import { MarketingHeader } from "@/components/marketing/header";
import { Hero } from "@/components/marketing/hero";
import { Trust } from "@/components/marketing/trust";
import { Demo } from "@/components/marketing/demo";
import { Features } from "@/components/marketing/features";
import { UseCases } from "@/components/marketing/use-cases";
import { Pricing } from "@/components/marketing/pricing";
import { FAQ } from "@/components/marketing/faq";
import { CTA } from "@/components/marketing/cta";
import { MarketingFooter } from "@/components/marketing/footer";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <main className="flex-1">
        <Hero />
        <Trust />
        <Demo />
        <Features />
        <UseCases />
        <Pricing />
        <FAQ />
        <CTA />
      </main>
      <MarketingFooter />
    </div>
  );
}
