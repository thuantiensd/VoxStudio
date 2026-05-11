export const PLAN_IDS = ["free", "pro", "studio", "premium"] as const;

export type PlanId = (typeof PLAN_IDS)[number];

export type PlanCatalogItem = {
  id: PlanId;
  name: string;
  priceUsdCents: number;
  priceVnd: number;
  ltdPriceUsdCents: number;
  ltdPriceVnd: number;
  ltdSlotsTotal: number;
  features: {
    dubbing: boolean;
    stt: boolean;
    tts: boolean;
    translate: boolean;
    download: boolean;
    voiceClone: boolean;
    videoDownload: boolean;
    batch: boolean;
    api: boolean;
    priorityQueue: boolean;
    export4k: boolean;
    export1080p: boolean;
    watermarkFree: boolean;
    commercialUse: boolean;
    webhooks: boolean;
    teamWorkspace: boolean;
  };
  limits: {
    concurrentJobs: number;
    dailyJobs: number;
    dailyDownloads: number;
    dubbingMinMonth: number;
    sttMinMonth: number;
    ttsCharsMonth: number;
    ttsMaxCharsRequest: number;
    voiceCloneMax: number;
    projectMax: number;
  };
};

export const PLAN_CATALOG: Record<PlanId, PlanCatalogItem> = {
  free: {
    id: "free",
    name: "Free",
    priceUsdCents: 0,
    priceVnd: 0,
    ltdPriceUsdCents: 0,
    ltdPriceVnd: 0,
    ltdSlotsTotal: 0,
    features: {
      dubbing: true,
      stt: true,
      tts: true,
      translate: true,
      download: true,
      voiceClone: true,
      videoDownload: true,
      batch: false,
      api: false,
      priorityQueue: false,
      export4k: false,
      export1080p: false,
      watermarkFree: false,
      commercialUse: false,
      webhooks: false,
      teamWorkspace: false,
    },
    limits: {
      concurrentJobs: 1,
      dailyJobs: 10,
      dailyDownloads: 15,
      dubbingMinMonth: 3,
      sttMinMonth: 30,
      ttsCharsMonth: 30_000,
      ttsMaxCharsRequest: 1_000,
      voiceCloneMax: 1,
      projectMax: 5,
    },
  },
  pro: {
    id: "pro",
    name: "Creator",
    priceUsdCents: 1_500,
    priceVnd: 375_000,
    ltdPriceUsdCents: 30_000,
    ltdPriceVnd: 7_499_000,
    ltdSlotsTotal: 100,
    features: {
      dubbing: true,
      stt: true,
      tts: true,
      translate: true,
      download: true,
      voiceClone: true,
      videoDownload: true,
      batch: false,
      api: false,
      priorityQueue: false,
      export4k: false,
      export1080p: true,
      watermarkFree: true,
      commercialUse: false,
      webhooks: false,
      teamWorkspace: false,
    },
    limits: {
      concurrentJobs: 2,
      dailyJobs: 50,
      dailyDownloads: -1,
      dubbingMinMonth: 20,
      sttMinMonth: 500,
      ttsCharsMonth: 500_000,
      ttsMaxCharsRequest: 10_000,
      voiceCloneMax: 3,
      projectMax: 30,
    },
  },
  studio: {
    id: "studio",
    name: "Studio",
    priceUsdCents: 3_900,
    priceVnd: 975_000,
    ltdPriceUsdCents: 78_000,
    ltdPriceVnd: 19_499_000,
    ltdSlotsTotal: 100,
    features: {
      dubbing: true,
      stt: true,
      tts: true,
      translate: true,
      download: true,
      voiceClone: true,
      videoDownload: true,
      batch: true,
      api: false,
      priorityQueue: true,
      export4k: true,
      export1080p: true,
      watermarkFree: true,
      commercialUse: true,
      webhooks: false,
      teamWorkspace: false,
    },
    limits: {
      concurrentJobs: 3,
      dailyJobs: 200,
      dailyDownloads: -1,
      dubbingMinMonth: 100,
      sttMinMonth: 2_000,
      ttsCharsMonth: 2_000_000,
      ttsMaxCharsRequest: 50_000,
      voiceCloneMax: 10,
      projectMax: 100,
    },
  },
  premium: {
    id: "premium",
    name: "Scale",
    priceUsdCents: 9_900,
    priceVnd: 2_475_000,
    ltdPriceUsdCents: 198_000,
    ltdPriceVnd: 49_499_000,
    ltdSlotsTotal: 30,
    features: {
      dubbing: true,
      stt: true,
      tts: true,
      translate: true,
      download: true,
      voiceClone: true,
      videoDownload: true,
      batch: true,
      api: true,
      priorityQueue: true,
      export4k: true,
      export1080p: true,
      watermarkFree: true,
      commercialUse: true,
      webhooks: true,
      teamWorkspace: true,
    },
    limits: {
      concurrentJobs: 5,
      dailyJobs: -1,
      dailyDownloads: -1,
      dubbingMinMonth: 300,
      sttMinMonth: -1,
      ttsCharsMonth: 5_000_000,
      ttsMaxCharsRequest: -1,
      voiceCloneMax: -1,
      projectMax: -1,
    },
  },
};

export function formatPlanLimit(value: number, suffix = "") {
  return value === -1 ? "Không giới hạn" : `${value.toLocaleString("vi-VN")}${suffix}`;
}
