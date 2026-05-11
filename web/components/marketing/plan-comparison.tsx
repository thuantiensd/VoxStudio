"use client";

import { useLocale, useTranslations } from "next-intl";
import { Check, Minus } from "lucide-react";
import { PLAN_CATALOG, PLAN_IDS, type PlanCatalogItem } from "@/lib/plans";

type CompareRow = {
  label: string;
  value: (plan: PlanCatalogItem) => string | boolean;
};

const rows: CompareRow[] = [
  { label: "TTS / tháng", value: (plan) => chars(plan.limits.ttsCharsMonth) },
  { label: "TTS tối đa mỗi lần", value: (plan) => chars(plan.limits.ttsMaxCharsRequest) },
  { label: "Lồng tiếng / tháng", value: (plan) => minutes(plan.limits.dubbingMinMonth) },
  { label: "Speech-to-Text / tháng", value: (plan) => minutes(plan.limits.sttMinMonth) },
  { label: "Voice clone", value: (plan) => count(plan.limits.voiceCloneMax, "giọng") },
  { label: "Project đang lưu", value: (plan) => count(plan.limits.projectMax, "project") },
  { label: "Job / ngày", value: (plan) => count(plan.limits.dailyJobs, "job") },
  { label: "Job song song", value: (plan) => count(plan.limits.concurrentJobs, "job") },
  { label: "Tải video / ngày", value: (plan) => count(plan.limits.dailyDownloads, "lượt") },
  { label: "BYOK dịch phụ đề", value: () => true },
  { label: "Không watermark", value: (plan) => plan.features.watermarkFree },
  { label: "Xuất 1080p", value: (plan) => plan.features.export1080p },
  { label: "Xuất 4K", value: (plan) => plan.features.export4k },
  { label: "Batch processing", value: (plan) => plan.features.batch },
  { label: "Ưu tiên GPU queue", value: (plan) => plan.features.priorityQueue },
  { label: "License thương mại", value: (plan) => plan.features.commercialUse },
  { label: "Developer API", value: (plan) => plan.features.api },
  { label: "Webhooks", value: (plan) => plan.features.webhooks },
  { label: "Team workspace", value: (plan) => plan.features.teamWorkspace },
];

export function PlanComparison() {
  const t = useTranslations("pricingPage");
  const locale = useLocale();

  return (
    <section className="border-y border-border/40 bg-card/20 py-14 sm:py-18">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              {t("compareEyebrow")}
            </div>
            <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
              {t("compareTitle")}
            </h2>
          </div>
          <p className="max-w-xl text-sm text-muted-foreground">
            Số liệu khớp backend quota hiện tại: concurrent jobs, daily jobs,
            TTS chars, STT phút, dubbing phút và voice clone đều đang được server kiểm soát.
          </p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card/50">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/30">
                <th className="w-[260px] p-4 text-left font-semibold">
                  {t("feature")}
                </th>
                {PLAN_IDS.map((id) => {
                  const plan = PLAN_CATALOG[id];
                  return (
                    <th key={id} className="p-4 text-left font-semibold">
                      <div>{displayName(plan.id)}</div>
                      <div className="mt-1 text-xs font-normal text-muted-foreground">
                        {price(plan, locale)}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-border/35 last:border-0">
                  <td className="p-4 font-medium text-foreground/85">{row.label}</td>
                  {PLAN_IDS.map((id) => (
                    <td key={id} className="p-4 text-muted-foreground">
                      <FeatureValue value={row.value(PLAN_CATALOG[id])} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function FeatureValue({ value }: { value: string | boolean }) {
  if (value === true) {
    return <Check className="h-4 w-4 text-emerald-500" />;
  }
  if (value === false) {
    return <Minus className="h-4 w-4 text-muted-foreground/50" />;
  }
  return <span>{value}</span>;
}

function displayName(id: PlanCatalogItem["id"]) {
  if (id === "free") return "Free";
  if (id === "pro") return "Creator";
  if (id === "studio") return "Studio";
  return "Scale";
}

function price(plan: PlanCatalogItem, locale: string) {
  if (plan.priceUsdCents === 0) return locale === "vi" ? "0đ/tháng" : "$0/mo";
  if (locale === "vi") return `${(plan.priceVnd / 1_000).toLocaleString("vi-VN")}k/tháng`;
  return `$${plan.priceUsdCents / 100}/mo`;
}

function chars(value: number) {
  if (value === -1) return "Không giới hạn";
  return `${value.toLocaleString("vi-VN")} ký tự`;
}

function minutes(value: number) {
  if (value === -1) return "Không giới hạn";
  return `${value.toLocaleString("vi-VN")} phút`;
}

function count(value: number, unit: string) {
  if (value === -1) return "Không giới hạn";
  return `${value.toLocaleString("vi-VN")} ${unit}`;
}
