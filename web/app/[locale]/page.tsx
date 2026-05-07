import { MarketingHeader } from "@/components/marketing/header";
import { Hero } from "@/components/marketing/hero";
import { ToolsShowcase } from "@/components/marketing/tools-showcase";
import { VoiceLibrary } from "@/components/marketing/voice-library";
import { GlobeSection } from "@/components/marketing/globe-section";
import { Demo } from "@/components/marketing/demo";
import { UseCases } from "@/components/marketing/use-cases";
import { Pricing } from "@/components/marketing/pricing";
import { FAQ } from "@/components/marketing/faq";
import { SeoContent } from "@/components/marketing/seo-content";
import { CTA } from "@/components/marketing/cta";
import { MarketingFooter } from "@/components/marketing/footer";

// Section flow:
//   1. Hero — hook (TTS + Dubbing + Clone all-in-one)
//   2. Tools showcase — USP, Studio Dubbing flagship
//   3. Voice library — quality + variety
//   4. Globe — global vision (aspirational)
//   5. Demo inline — try before buy
//   6. Use cases — target audience
//   7. Pricing → FAQ → CTA cuối
export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <main className="flex-1">
        <Hero />
        <ToolsShowcase />
        <VoiceLibrary />
        <GlobeSection />
        <Demo />
        <UseCases />
        <Pricing />
        <FAQ />
        <SeoContent />
        <CTA />
      </main>
      <MarketingFooter />
    </div>
  );
}
