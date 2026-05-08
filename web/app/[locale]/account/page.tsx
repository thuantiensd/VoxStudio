"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import {
  Loader2,
  LogOut,
  AlertTriangle,
  ArrowRight,
  LayoutDashboard,
  Wallet,
  Zap,
  Mic2,
  Wand2,
  Film,
  FileText,
  Repeat,
  Music2,
  PanelLeft,
  Bell,
  Sun,
  Moon,
  Sparkles,
  Search,
  Gift,
  Play,
  Clock,
  CheckCircle2,
  Loader,
  Settings as SettingsIcon,
  HelpCircle,
  Folder,
  Download,
  Upload,
  FileUp,
  Trash2,
  Save,
  PauseCircle,
  RotateCcw,
  ChevronRight,
  ChevronDown,
  CircleDot,
  ShieldCheck,
  Mail,
  Crown,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  API_BASE,
  cloneVoice,
  createDubbingProject,
  downloadToProject,
  fetchCreditPacks,
  fetchDownloadInfo,
  generateCloudTts,
  generateTts,
  listEdgeVoices,
  listDubbingProjects,
  listJobs,
  listMyPayments,
  listPremiumVoices,
  listVoices,
  me,
  transcribeAudio,
  type CreditPack,
  type DownloadInfo,
  type DubbingListProject,
  type DubbingProject,
  type EdgeVoice,
  type Job,
  type Payment,
  type PremiumVoice,
  type SttResult,
  type TtsResult,
  type Voice,
} from "@/lib/api";

type Tab =
  | "home"
  | "video-download"
  | "tts"
  | "subtitle"
  | "dubbing"
  | "projects"
  | "history"
  | "voice-models"
  | "saved-voices"
  | "settings"
  | "topup"
  | "support";

const NAV_SECTIONS: {
  title: string;
  items: { id: Tab; label: string; icon: typeof LayoutDashboard; badge?: string }[];
}[] = [
  {
    title: "TỔNG QUAN",
    items: [{ id: "home", label: "Trang chủ", icon: LayoutDashboard }],
  },
  {
    title: "CÔNG CỤ AI",
    items: [
      { id: "video-download", label: "Tải video", icon: Film },
      { id: "tts", label: "Văn bản thành giọng nói", icon: FileText },
      { id: "subtitle", label: "Chuyển đổi phụ đề", icon: Repeat },
      { id: "dubbing", label: "Lồng tiếng video", icon: Mic2 },
    ],
  },
  {
    title: "QUẢN LÝ",
    items: [
      { id: "projects", label: "Dự án của tôi", icon: Folder },
      { id: "history", label: "Lịch sử xử lý", icon: Clock },
      { id: "voice-models", label: "Mẫu giọng nói", icon: Music2 },
      { id: "saved-voices", label: "Giọng đã lưu", icon: Wand2 },
    ],
  },
  {
    title: "TÀI KHOẢN",
    items: [
      { id: "settings", label: "Cài đặt", icon: SettingsIcon },
      { id: "topup", label: "Nạp credits", icon: Wallet },
      { id: "support", label: "Hỗ trợ", icon: HelpCircle },
    ],
  },
];

function mediaUrl(url: string) {
  if (!url) return "";
  try {
    return new URL(url, `${API_BASE}/`).toString();
  } catch {
    return url;
  }
}

const TTS_HISTORY_KEY = "voxstudio:tts:history";
const TTS_HISTORY_LIMIT = 30;

type TtsHistoryItem = {
  id: string;
  text: string;
  engine: "premium" | "cloud";
  language: string;
  voiceKey: string;
  voiceLabel: string;
  createdAt: string;
  status: "processing" | "done" | "failed";
  credits: number;
  charCount: number;
  audioUrl?: string;
  duration?: number;
  sampleRate?: number;
  error?: string;
};

function createHistoryId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function estimateTtsCredits(value: string) {
  return Math.max(1, Math.ceil(value.length / 20));
}

function loadTtsHistory(): TtsHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TTS_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<TtsHistoryItem>[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Partial<TtsHistoryItem> & { id: string; text: string } => typeof item?.id === "string" && typeof item?.text === "string")
      .map<TtsHistoryItem>((item) => ({
        id: item.id,
        text: item.text,
        engine: item.engine === "cloud" ? "cloud" : "premium",
        language: typeof item.language === "string" ? item.language : "vi",
        voiceKey: typeof item.voiceKey === "string" ? item.voiceKey : "",
        voiceLabel: typeof item.voiceLabel === "string" ? item.voiceLabel : "Giọng mặc định",
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        status: item.status === "failed" ? "failed" : "done",
        credits: typeof item.credits === "number" ? item.credits : estimateTtsCredits(item.text),
        charCount: typeof item.charCount === "number" ? item.charCount : item.text.length,
        audioUrl: typeof item.audioUrl === "string" ? item.audioUrl : undefined,
        duration: typeof item.duration === "number" ? item.duration : undefined,
        sampleRate: typeof item.sampleRate === "number" ? item.sampleRate : undefined,
        error: typeof item.error === "string" ? item.error : undefined,
      }))
      .slice(0, TTS_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function saveTtsHistory(items: TtsHistoryItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TTS_HISTORY_KEY, JSON.stringify(items.slice(0, TTS_HISTORY_LIMIT)));
  } catch {}
}

function formatDuration(seconds?: number) {
  if (typeof seconds !== "number" || Number.isNaN(seconds) || seconds <= 0) return "--:--";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

function formatHistoryTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return `${date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} ${date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}`;
}

export default function AccountPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("tts");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem("voxstudio:theme") as "dark" | "light" | null) || "dark";
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("voxstudio:theme", theme);
  }, [theme]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/sign-in?next=/account");
      return;
    }
    listMyPayments()
      .then((r) => setPayments(r.payments || []))
      .catch(() => setPayments([]));
  }, [user, authLoading, router]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const planName = user.plan.charAt(0).toUpperCase() + user.plan.slice(1);
  const isPaid = user.plan !== "free";
  const initial = (user.name || user.email)[0].toUpperCase();
  const displayName = user.name || user.email.split("@")[0];
  const credits = user.credit_balance || 0;

  return (
    <div className="theme-black flex min-h-screen bg-background text-foreground">
      {/* SIDEBAR */}
      {sidebarOpen && (
        <aside className="hidden w-[270px] shrink-0 border-r border-border/60 bg-card/60 lg:flex lg:flex-col">
          <div className="flex h-14 items-center gap-2 border-b border-border/60 px-4">
            <Link href="/" className="inline-flex items-center gap-2">
              <Image src="/logo.png" alt="VoxStudio" width={24} height={24} className="h-6 w-6 rounded" />
              <span className="text-sm font-bold tracking-tight">VoxStudio</span>
            </Link>
          </div>

          {/* User card */}
          <div className="m-3 flex items-center gap-2.5 rounded-xl border border-border/60 bg-background/40 px-3 py-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-foreground text-xs font-bold text-background">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{displayName}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                Gói {planName}
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
            {NAV_SECTIONS.map((section) => (
              <div key={section.title}>
                <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70">
                  {section.title}
                </div>
                <div className="flex flex-col gap-0.5">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        data-account-tab-desktop={item.id}
                        onClick={() => setActiveTab(item.id)}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                          isActive
                            ? "border border-primary/20 bg-primary/10 text-primary"
                            : "border border-transparent text-foreground/75 hover:bg-muted/50 hover:text-foreground"
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 text-left">{item.label}</span>
                        {item.badge && (
                          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary">
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Bottom credits chip */}
          <div className="m-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-3">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <Zap className="h-3 w-3 text-emerald-500" />
                <span className="font-bold">Credits</span>
              </div>
              <span className="font-mono font-bold text-emerald-500">
                {credits.toLocaleString("vi-VN")}
              </span>
            </div>
            <button
              onClick={() => setActiveTab("topup")}
              className="mt-2 w-full rounded-md bg-emerald-500/10 py-1 text-[10px] font-semibold text-emerald-500 hover:bg-emerald-500/20"
            >
              Nạp thêm
            </button>
          </div>
        </aside>
      )}

      {/* MAIN */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* TOP BAR */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-background/90 px-4 backdrop-blur-sm sm:px-6">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="hidden h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground lg:flex"
          >
            <PanelLeft className="h-4 w-4" />
          </button>

          <Link href="/" className="inline-flex items-center gap-2 lg:hidden">
            <Image src="/logo.png" alt="VoxStudio" width={24} height={24} className="h-6 w-6 rounded" />
            <span className="text-sm font-black tracking-tight">VoxStudio</span>
          </Link>

          <div className="relative hidden flex-1 max-w-md sm:block">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Tìm công cụ, dự án..."
              className="w-full rounded-lg border border-border/60 bg-card/50 py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground/60 focus:border-primary/40 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <IconButton icon={Gift} label="Nạp credits" onClick={() => setActiveTab("topup")} />
            <IconButton icon={Bell} label="Lịch sử xử lý" onClick={() => setActiveTab("history")} />
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              aria-label="Đổi giao diện"
            >
              {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
            <Link
              href="/pricing"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-bold text-emerald-500"
            >
              <Zap className="h-3 w-3" />
              {credits} credits
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-md shadow-primary/30 hover:scale-105 transition-transform"
            >
              {isPaid ? "Quản lý gói" : "Nâng cấp gói"}
            </Link>
            <button
              onClick={() => {
                logout();
                router.replace("/");
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        <div className="border-b border-border/60 bg-background/95 px-3 py-2 lg:hidden">
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV_SECTIONS.flatMap((section) => section.items).map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  data-account-tab={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-bold ${
                    isActive
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border/60 bg-card/50 text-muted-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* CONTENT — render theo activeTab */}
        <main className="flex-1 p-4 sm:p-6">
          {!user.email_verified && (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/[0.05] p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-yellow-500" />
              <div className="flex-1 text-sm">
                Email chưa xác thực — bạn cần xác thực để mua gói.{" "}
                <Link href="/verify" className="font-semibold text-primary hover:underline">
                  Xác thực ngay
                </Link>
              </div>
            </div>
          )}

          {activeTab === "home" && (
            <HomeTab user={user} setActiveTab={setActiveTab} />
          )}
          {activeTab === "video-download" && <VideoDownloadTab />}
          {activeTab === "tts" && <TtsTab />}
          {activeTab === "subtitle" && <SubtitleTab />}
          {activeTab === "dubbing" && <DubbingTab />}
          {activeTab === "projects" && <ProjectsTab />}
          {activeTab === "history" && <HistoryTab payments={payments} />}
          {activeTab === "voice-models" && <VoiceModelsTab />}
          {activeTab === "saved-voices" && <SavedVoicesTab />}
          {activeTab === "settings" && <SettingsTab user={user} theme={theme} setTheme={setTheme} />}
          {activeTab === "topup" && <TopupTab />}
          {activeTab === "support" && <SupportTab />}
        </main>
      </div>
    </div>
  );
}

// ── PAGE TITLE — used at top of each tab ──────────────────────────────
function PageTitle({ icon: Icon, title, desc }: { icon: React.ComponentType<{ className?: string }>; title: string; desc: string }) {
  return (
    <div className="mb-6 flex items-start gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/5">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

// ── HOME TAB ───────────────────────────────────────────────────────────
function HomeTab({
  user,
  setActiveTab,
}: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  setActiveTab: (t: Tab) => void;
}) {
  const displayName = user.name || user.email.split("@")[0];
  const [usage, setUsage] = useState<{
    dubbing_min: number;
    stt_min: number;
    tts_chars: number;
    translate_tokens: number;
    clone_min: number;
  } | null>(null);
  const [projects, setProjects] = useState<DubbingListProject[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    void Promise.allSettled([me(), listDubbingProjects(5), listJobs(5)]).then(([account, projectResult, jobResult]) => {
      if (account.status === "fulfilled") setUsage(account.value.usage_month);
      setProjects(projectResult.status === "fulfilled" ? projectResult.value.projects || [] : []);
      setJobs(jobResult.status === "fulfilled" ? jobResult.value.jobs || [] : []);
    });
  }, []);

  const planName = user.plan.charAt(0).toUpperCase() + user.plan.slice(1);
  const credits = user.credit_balance || 0;
  const latestActivity = jobs[0] || null;

  return (
    <div className="space-y-5">
      <div className="grid overflow-hidden rounded-2xl border border-border/60 bg-card/40 shadow-sm lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="border-b border-border/60 p-6 lg:border-b-0 lg:border-r">
          <div className="mb-5 inline-flex rounded-xl border border-border/60 bg-background/45 p-1 text-xs font-semibold">
            <button className="rounded-lg bg-foreground px-5 py-2 text-background">Tổng quan</button>
            <button onClick={() => setActiveTab("settings")} className="rounded-lg px-5 py-2 text-muted-foreground hover:text-foreground">Hồ sơ</button>
            <button onClick={() => setActiveTab("topup")} className="rounded-lg px-5 py-2 text-muted-foreground hover:text-foreground">Ví credits</button>
          </div>

          <div className="flex flex-col gap-5 rounded-2xl border border-border/50 bg-background/45 p-5 sm:flex-row sm:items-center">
            <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full border border-border/60 bg-foreground text-2xl font-black text-background">
              {(user.name || user.email)[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-3xl font-black tracking-tight">{displayName}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
                <span className="rounded-full border border-border/60 bg-card/60 px-3 py-1">{user.email}</span>
                <span className="rounded-full border border-border/60 bg-card/60 px-3 py-1">Gói {planName}</span>
                <span className="rounded-full border border-border/60 bg-card/60 px-3 py-1">{user.email_verified ? "Đã xác thực" : "Chưa xác thực"}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:w-80">
              <div className="rounded-xl border border-border/60 bg-card/70 p-4">
                <div className="text-[11px] font-bold uppercase text-muted-foreground">Credits</div>
                <div className="mt-2 text-3xl font-black">{credits.toLocaleString("vi-VN")}</div>
              </div>
              <div className="rounded-xl border border-border/60 bg-card/70 p-4">
                <div className="text-[11px] font-bold uppercase text-muted-foreground">Dự án</div>
                <div className="mt-2 text-3xl font-black">{projects?.length ?? 0}</div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile icon={FileText} label="TTS tháng này" value={(usage?.tts_chars || 0).toLocaleString("vi-VN")} unit="ký tự" />
            <StatTile icon={Repeat} label="STT tháng này" value={(usage?.stt_min || 0).toLocaleString("vi-VN")} unit="phút" />
            <StatTile icon={Mic2} label="Dubbing" value={(usage?.dubbing_min || 0).toLocaleString("vi-VN")} unit="phút" />
            <StatTile icon={Wand2} label="Clone voice" value={(usage?.clone_min || 0).toLocaleString("vi-VN")} unit="phút" />
          </div>
        </div>

        <div className="flex flex-col p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-bold">Tác vụ gần đây</div>
            <button onClick={() => setActiveTab("projects")} className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
              Xem tất cả
            </button>
          </div>
          <div className="flex min-h-56 flex-1 flex-col justify-center rounded-2xl border border-dashed border-border/60 bg-background/35 p-5">
            {latestActivity ? (
              <div className="space-y-3">
                <ProjectRow
                  title={latestActivity.kind}
                  subtitle={latestActivity.current_step || "Tác vụ hệ thống"}
                  meta={latestActivity.created_at ? new Date(latestActivity.created_at).toLocaleString("vi-VN") : latestActivity.id}
                  status={latestActivity.status === "done" || latestActivity.status === "completed" ? "done" : "processing"}
                />
                <div className="text-xs text-muted-foreground">
                  {latestActivity.error || "Dữ liệu lấy trực tiếp từ hàng đợi xử lý của VoxStudio."}
                </div>
              </div>
            ) : (
              <div className="text-center">
                <Clock className="mx-auto h-9 w-9 text-muted-foreground/50" />
                <p className="mt-3 text-sm font-semibold">Chưa có hoạt động nào</p>
                <p className="mt-1 text-xs text-muted-foreground">Tạo TTS, STT hoặc dubbing để thấy lịch sử tại đây.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <BigToolCard icon={FileText} title="Văn bản thành giọng nói" desc="VoxStudio và Edge TTS, có lịch sử audio." gradient="from-zinc-100 to-zinc-500" onClick={() => setActiveTab("tts")} />
        <BigToolCard icon={Repeat} title="Giọng nói thành văn bản" desc="Tạo SRT/JSON subtitle từ audio/video." gradient="from-zinc-100 to-zinc-500" onClick={() => setActiveTab("subtitle")} />
        <BigToolCard icon={Mic2} title="Lồng tiếng tự động" desc="Tạo project dubbing thật trên backend." gradient="from-zinc-100 to-zinc-500" onClick={() => setActiveTab("dubbing")} />
        <BigToolCard icon={Wand2} title="Nhân bản giọng nói" desc="Clone voice từ audio mẫu của bạn." gradient="from-zinc-100 to-zinc-500" onClick={() => setActiveTab("saved-voices")} />
      </div>
    </div>
  );
}

// ── VIDEO DOWNLOAD TAB ─────────────────────────────────────────────────
function VideoDownloadTab() {
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<DownloadInfo | null>(null);
  const [busyInfo, setBusyInfo] = useState(false);
  const [busyProject, setBusyProject] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const platforms = [
    { name: "YouTube", color: "bg-red-500" },
    { name: "Facebook", color: "bg-blue-600" },
    { name: "TikTok", color: "bg-foreground" },
    { name: "Instagram", color: "bg-gradient-to-br from-pink-500 to-yellow-500" },
    { name: "Twitter", color: "bg-sky-400" },
    { name: "Vimeo", color: "bg-cyan-500" },
    { name: "LinkedIn", color: "bg-blue-700" },
    { name: "Twitch", color: "bg-purple-600" },
  ];

  async function inspectUrl() {
    setError("");
    setMessage("");
    setInfo(null);
    if (!url.trim()) {
      setError("Dán link video trước khi kiểm tra.");
      return;
    }
    setBusyInfo(true);
    try {
      setInfo(await fetchDownloadInfo({ url: url.trim() }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đọc được thông tin video.");
    } finally {
      setBusyInfo(false);
    }
  }

  async function createProject() {
    setError("");
    setMessage("");
    if (!url.trim()) {
      setError("Dán link video trước khi tạo dự án.");
      return;
    }
    setBusyProject(true);
    try {
      const res = await downloadToProject({
        url: url.trim(),
        target_language: "vietnamese",
        source_language: "auto",
        enable_dubbing: true,
        enable_subtitle: true,
      });
      const reader = res.body?.getReader();
      if (!reader) {
        setMessage("Đã gửi yêu cầu tạo dự án tải video.");
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let doneLabel = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const raw of events) {
          const line = raw.split("\n").find((item) => item.startsWith("data: "));
          if (!line) continue;
          const payload = JSON.parse(line.slice(6)) as { label?: string; project_id?: string; step?: string };
          doneLabel = payload.project_id
            ? `Đã tạo dự án ${payload.project_id}. Mở tab Dự án để xem.`
            : payload.label || doneLabel;
          setMessage(doneLabel);
        }
      }
      if (!doneLabel) setMessage("Đã tạo yêu cầu tải video.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được dự án từ link.");
    } finally {
      setBusyProject(false);
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-88px)] gap-4 xl:grid-cols-[minmax(0,1fr)_370px]">
      <section className="flex flex-col rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-xs font-bold text-muted-foreground">
            <Film className="h-4 w-4 text-primary" />
            Tải video từ URL
          </div>
          <span className="rounded-full border border-border/60 bg-background/50 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
            YouTube · TikTok · Facebook
          </span>
        </div>

        <div className="flex min-h-[54vh] flex-1 flex-col rounded-2xl border border-primary/50 bg-background p-5">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Link video
          </label>
          <textarea
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Dán link video cần tải hoặc tạo project dubbing..."
            className="mt-3 min-h-40 flex-1 resize-none rounded-xl border border-border/60 bg-card/40 px-4 py-4 text-sm font-semibold leading-6 outline-none placeholder:text-muted-foreground/55 focus:border-primary/60"
          />

          <div className="mt-5 grid gap-2 sm:grid-cols-4">
            {platforms.slice(0, 8).map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => setUrl((value) => value || `https://${p.name.toLowerCase()}.com/`)}
                className="rounded-xl border border-border/60 bg-card/50 px-3 py-3 text-left text-xs font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground"
              >
                <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${p.color}`} />
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/50 p-2">
          <button onClick={inspectUrl} disabled={busyInfo} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-4 text-xs font-bold text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-60">
            {busyInfo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Kiểm tra
          </button>
          <button onClick={() => setUrl("")} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-4 text-xs font-bold text-muted-foreground hover:bg-muted/50 hover:text-foreground">
            <Trash2 className="h-4 w-4" />
            Xoá
          </button>
          <div className="ml-auto text-xs font-semibold text-muted-foreground">
            {url.trim() ? "Sẵn sàng tạo dự án" : "Chờ link video"}
          </div>
          <button onClick={createProject} disabled={busyProject} className="inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-5 text-xs font-black text-background hover:scale-[1.01] disabled:opacity-60">
            {busyProject ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Tạo dự án
          </button>
        </div>
      </section>

      <aside className="flex min-h-[calc(100vh-88px)] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm">
        <div className="flex items-center justify-between border-b border-border/60 p-4">
          <div className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3 text-xs font-bold text-background">
            <FileText className="h-3.5 w-3.5" />
            Kết quả
          </div>
          <button onClick={inspectUrl} disabled={busyInfo || !url.trim()} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-40" title="Làm mới thông tin">
            {busyInfo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>}
          {message && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{message}</div>}
          {info ? (
            <div className="rounded-2xl border border-border/60 bg-background/45 p-4">
              {info.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={info.thumbnail} alt="" className="mb-4 aspect-video w-full rounded-xl object-cover" />
              )}
              <h3 className="line-clamp-2 text-sm font-black">{info.title || "Video đã đọc được"}</h3>
              <div className="mt-2 text-xs leading-5 text-muted-foreground">
                {[info.platform, info.author, info.duration ? `${Math.round(info.duration / 60)} phút` : ""].filter(Boolean).join(" · ") || "Có thể tạo project từ link này."}
              </div>
            </div>
          ) : (
            <div className="flex min-h-72 items-center justify-center rounded-2xl border border-dashed border-border/60 bg-background/35 p-8 text-center">
              <div>
                <Download className="mx-auto h-9 w-9 text-muted-foreground/50" />
                <p className="mt-3 text-sm font-bold">Chưa kiểm tra video</p>
                <p className="mt-1 text-xs text-muted-foreground">Dán link rồi bấm Kiểm tra để xem metadata.</p>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ── TTS TAB ────────────────────────────────────────────────────────────
function TtsTab() {
  const [tab, setTab] = useState<"text" | "file">("text");
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [engine, setEngine] = useState<"premium" | "cloud">(() => {
    if (typeof window === "undefined") return "premium";
    return (localStorage.getItem("voxstudio:tts:engine") as "premium" | "cloud" | null) || "premium";
  });
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!modelMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [modelMenuOpen]);
  const [voiceId, setVoiceId] = useState(() => (typeof window === "undefined" ? "" : localStorage.getItem("voxstudio:tts:voiceId") || ""));
  const [edgeVoice, setEdgeVoice] = useState(() => (typeof window === "undefined" ? "" : localStorage.getItem("voxstudio:tts:edgeVoice") || ""));
  const [language, setLanguage] = useState(() => (typeof window === "undefined" ? "vi" : localStorage.getItem("voxstudio:tts:language") || "vi"));
  const [speed, setSpeed] = useState(() => {
    if (typeof window === "undefined") return 1;
    return Number(localStorage.getItem("voxstudio:tts:speed") || 1);
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [numStep, setNumStep] = useState(() => {
    if (typeof window === "undefined") return 32;
    return Number(localStorage.getItem("voxstudio:tts:numStep") || 32);
  });
  const [guidanceScale, setGuidanceScale] = useState(() => {
    if (typeof window === "undefined") return 2;
    return Number(localStorage.getItem("voxstudio:tts:guidanceScale") || 2);
  });
  const [tShift, setTShift] = useState(() => {
    if (typeof window === "undefined") return 0.1;
    return Number(localStorage.getItem("voxstudio:tts:tShift") || 0.1);
  });
  const [layerPenaltyFactor, setLayerPenaltyFactor] = useState(() => {
    if (typeof window === "undefined") return 5;
    return Number(localStorage.getItem("voxstudio:tts:layerPenaltyFactor") || 5);
  });
  const [positionTemperature, setPositionTemperature] = useState(() => {
    if (typeof window === "undefined") return 5;
    return Number(localStorage.getItem("voxstudio:tts:positionTemperature") || 5);
  });
  const [classTemperature, setClassTemperature] = useState(() => {
    if (typeof window === "undefined") return 0;
    return Number(localStorage.getItem("voxstudio:tts:classTemperature") || 0);
  });
  const [denoise, setDenoise] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("voxstudio:tts:denoise") !== "false";
  });
  const [preprocessPrompt, setPreprocessPrompt] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("voxstudio:tts:preprocessPrompt") !== "false";
  });
  const [postprocessOutput, setPostprocessOutput] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("voxstudio:tts:postprocessOutput") !== "false";
  });
  const [audioChunkDuration, setAudioChunkDuration] = useState(() => {
    if (typeof window === "undefined") return 15;
    return Number(localStorage.getItem("voxstudio:tts:audioChunkDuration") || 15);
  });
  const [panel, setPanel] = useState<"settings" | "history">("settings");
  const [charLimit, setCharLimit] = useState<number | null>(1000);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [premiumVoices, setPremiumVoices] = useState<PremiumVoice[]>([]);
  const [edgeVoices, setEdgeVoices] = useState<EdgeVoice[]>([]);
  const [result, setResult] = useState<TtsResult | null>(null);
  const [history, setHistory] = useState<TtsHistoryItem[]>(loadTtsHistory);
  const [historyNewestFirst, setHistoryNewestFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([listVoices(), listPremiumVoices(), listEdgeVoices(), me()]).then((items) => {
      if (cancelled) return;
      const [userVoices, builtIn, edge, account] = items;
      setVoices(userVoices.status === "fulfilled" ? userVoices.value.voices || [] : []);
      setPremiumVoices(builtIn.status === "fulfilled" ? builtIn.value.voices || [] : []);
      setEdgeVoices(edge.status === "fulfilled" ? edge.value.voices || [] : []);
      if (account.status === "fulfilled") {
        const limit = account.value.plan?.limits?.tts_max_chars_request;
        if (typeof limit === "number") setCharLimit(limit === -1 ? null : limit);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const overLimit = charLimit !== null && text.length > charLimit;
  const filteredEdgeVoices = edgeVoices.filter((voice) => {
    if (!language) return true;
    const prefix = language === "vi" ? "vi-" : `${language}-`;
    return voice.locale?.toLowerCase().startsWith(prefix);
  });
  const premiumVoiceLabel =
    premiumVoices.find((voice) => voice.slug === voiceId)?.display_name ||
    voices.find((voice) => voice.id === voiceId)?.name ||
    "Giọng mặc định";
  const cloudVoiceLabel = edgeVoices.find((voice) => voice.name === edgeVoice)?.name || "Tự động chọn giọng";
  const selectedVoiceKey = engine === "premium" ? voiceId : edgeVoice;
  const selectedVoiceLabel = engine === "premium" ? premiumVoiceLabel : cloudVoiceLabel;
  const visibleHistory = historyNewestFirst ? history : [...history].reverse();

  function writeHistory(mutator: (items: TtsHistoryItem[]) => TtsHistoryItem[]) {
    setHistory((items) => {
      const next = mutator(items).slice(0, TTS_HISTORY_LIMIT);
      saveTtsHistory(next);
      return next;
    });
  }

  function pushHistory(item: TtsHistoryItem) {
    writeHistory((items) => [item, ...items]);
  }

  function reloadHistory() {
    setHistory(loadTtsHistory());
  }

  function deleteHistoryItem(id: string) {
    writeHistory((items) => items.filter((item) => item.id !== id));
  }

  function clearHistoryItems() {
    writeHistory(() => []);
  }

  function reuseHistoryItem(item: TtsHistoryItem) {
    setText(item.text);
    setEngine(item.engine);
    setLanguage(item.language);
    if (item.engine === "premium") setVoiceId(item.voiceKey);
    else setEdgeVoice(item.voiceKey);
    setTab("text");
    setPanel("settings");
    setResult(null);
    setError("");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  async function generate() {
    setError("");
    setResult(null);
    if (!text.trim()) {
      setError("Nhập văn bản trước khi tạo giọng nói.");
      return;
    }
    if (overLimit) {
      setError(`Văn bản vượt giới hạn ${charLimit?.toLocaleString("vi-VN")} ký tự/lần của gói hiện tại.`);
      return;
    }
    setBusy(true);
    const sourceText = text;
    const createdAt = new Date().toISOString();
    const voiceLabel = selectedVoiceLabel;
    const voiceKey = selectedVoiceKey;
    const creditCost = estimateTtsCredits(sourceText);
    const tempId = createHistoryId();

    // 1. Push processing item ngay lập tức + switch sang lịch sử
    pushHistory({
      id: tempId,
      text: sourceText,
      engine,
      language,
      voiceKey,
      voiceLabel,
      createdAt,
      status: "processing",
      credits: creditCost,
      charCount: sourceText.length,
    });
    setPanel("history");

    try {
      const next =
        engine === "premium"
          ? await generateTts({
              text,
              voice_id: voiceId || null,
              language,
              speed,
              num_step: numStep,
              guidance_scale: guidanceScale,
              t_shift: tShift,
              layer_penalty_factor: layerPenaltyFactor,
              position_temperature: positionTemperature,
              class_temperature: classTemperature,
              denoise,
              preprocess_prompt: preprocessPrompt,
              postprocess_output: postprocessOutput,
              audio_chunk_duration: audioChunkDuration,
            })
          : await generateCloudTts({ text, voice: edgeVoice || null, language, speed });
      setResult(next);
      // 2. Update item status = "done" với audio url
      writeHistory((items) =>
        items.map((it) =>
          it.id === tempId
            ? {
                ...it,
                status: "done",
                audioUrl: next.audio_url,
                duration: next.duration,
                sampleRate: next.sample_rate,
              }
            : it,
        ),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Không tạo được giọng nói.";
      setError(message);
      // 3. Update item status = "failed" với error message
      writeHistory((items) =>
        items.map((it) =>
          it.id === tempId
            ? { ...it, status: "failed", error: message }
            : it,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function saveSettings() {
    localStorage.setItem("voxstudio:tts:engine", engine);
    localStorage.setItem("voxstudio:tts:voiceId", voiceId);
    localStorage.setItem("voxstudio:tts:edgeVoice", edgeVoice);
    localStorage.setItem("voxstudio:tts:language", language);
    localStorage.setItem("voxstudio:tts:speed", String(speed));
    localStorage.setItem("voxstudio:tts:numStep", String(numStep));
    localStorage.setItem("voxstudio:tts:guidanceScale", String(guidanceScale));
    localStorage.setItem("voxstudio:tts:tShift", String(tShift));
    localStorage.setItem("voxstudio:tts:layerPenaltyFactor", String(layerPenaltyFactor));
    localStorage.setItem("voxstudio:tts:positionTemperature", String(positionTemperature));
    localStorage.setItem("voxstudio:tts:classTemperature", String(classTemperature));
    localStorage.setItem("voxstudio:tts:denoise", String(denoise));
    localStorage.setItem("voxstudio:tts:preprocessPrompt", String(preprocessPrompt));
    localStorage.setItem("voxstudio:tts:postprocessOutput", String(postprocessOutput));
    localStorage.setItem("voxstudio:tts:audioChunkDuration", String(audioChunkDuration));
    setError("Đã lưu cài đặt TTS trên trình duyệt này.");
  }

  function normalizeText() {
    setText((value) =>
      value
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    );
  }

  function clearText() {
    setText("");
    setResult(null);
    setError("");
  }

  function insertPause() {
    const token = ' <break time="0.5s" /> ';
    const target = textareaRef.current;
    if (!target) {
      setText((value) => `${value}${token}`);
      return;
    }
    const start = target.selectionStart;
    const end = target.selectionEnd;
    setText((value) => `${value.slice(0, start)}${token}${value.slice(end)}`);
    window.setTimeout(() => {
      target.focus();
      const next = start + token.length;
      target.setSelectionRange(next, next);
    }, 0);
  }

  function resetSettings() {
    setEngine("premium");
    setVoiceId("");
    setEdgeVoice("");
    setLanguage("vi");
    setSpeed(1);
    setNumStep(32);
    setGuidanceScale(2);
    setTShift(0.1);
    setLayerPenaltyFactor(5);
    setPositionTemperature(5);
    setClassTemperature(0);
    setDenoise(true);
    setPreprocessPrompt(true);
    setPostprocessOutput(true);
    setAudioChunkDuration(15);
    setError("");
  }

  async function loadTextFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".txt")) {
      setError("Hiện tab web hỗ trợ đọc file .txt để đảm bảo xử lý chạy thật.");
      return;
    }
    setText(await file.text());
    setTab("text");
  }

  return (
    <div className="min-h-[calc(100vh-88px)] text-foreground">
      <div className="grid min-h-[calc(100vh-88px)] gap-4 xl:grid-cols-[minmax(0,1fr)_410px]">
        <section className="flex min-h-[calc(100vh-88px)] flex-col rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm sm:p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <FileText className="h-4 w-4 text-primary" />
              <span>Văn bản thành giọng nói</span>
            </div>
            <div className="inline-flex rounded-lg border border-border/60 bg-muted/30 p-1">
              <button onClick={() => setTab("text")} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${tab === "text" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
                Văn bản
              </button>
              <button onClick={() => setTab("file")} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${tab === "file" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
                File .txt
              </button>
            </div>
          </div>

          {tab === "text" ? (
            <>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Nhập hoặc dán văn bản cần chuyển thành giọng nói..."
                className="min-h-[58vh] flex-1 resize-none rounded-xl border border-primary/60 bg-background px-5 py-5 text-[15px] font-semibold leading-7 text-foreground outline-none shadow-sm placeholder:text-muted-foreground/55 focus:border-primary sm:px-6"
              />
            </>
          ) : (
            <label className="flex min-h-[58vh] flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-background/40 py-16 text-sm text-muted-foreground hover:border-primary/40">
              <FileUp className="h-8 w-8" />
              <span>Tải file .txt</span>
              <span className="text-xs">Nội dung file sẽ được đưa vào khung văn bản</span>
              <input type="file" accept=".txt,text/plain" className="hidden" onChange={(event) => void loadTextFile(event.target.files?.[0])} />
            </label>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/50 p-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 text-xs font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground">
              <Upload className="h-3.5 w-3.5" />
              Tải .txt
              <input type="file" accept=".txt,text/plain" className="hidden" onChange={(event) => void loadTextFile(event.target.files?.[0])} />
            </label>
            <button onClick={clearText} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 text-xs font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground">
              <Trash2 className="h-3.5 w-3.5" />
              Xoá
            </button>
            <button onClick={normalizeText} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 text-xs font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground">
              <Repeat className="h-3.5 w-3.5" />
              Chuẩn hoá
            </button>
            <button onClick={insertPause} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 text-xs font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground">
              <PauseCircle className="h-3.5 w-3.5" />
              Khoảng dừng
            </button>
            <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
              <span className={overLimit ? "text-red-400" : ""}>
                {text.length.toLocaleString("vi-VN")} / {charLimit === null ? "Không giới hạn" : charLimit.toLocaleString("vi-VN")} ký tự
              </span>
              <span className="hidden sm:inline">|</span>
              <span className="font-semibold text-primary">{Math.max(1, Math.ceil(text.length / 20)).toLocaleString("vi-VN")} credits</span>
            </div>
          </div>

          {error && (
            <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${error.startsWith("Đã lưu") ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"}`}>
              {error}
            </div>
          )}

        </section>

        <aside className="flex min-h-[calc(100vh-88px)] flex-col rounded-2xl border border-border/60 bg-card/70 shadow-sm">
          <div className="relative flex items-center justify-between gap-3 border-b border-border/60 p-4">
            <div className="inline-flex items-center gap-2">
              <button type="button" onClick={() => setPanel("settings")} className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold ${panel === "settings" ? "bg-foreground text-background" : "bg-muted/40 text-muted-foreground hover:text-foreground"}`}>
                <SettingsIcon className="h-3.5 w-3.5" />
                Cài đặt
              </button>
              <button type="button" onClick={() => setPanel("history")} className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold ${panel === "history" ? "bg-foreground text-background" : "bg-muted/40 text-muted-foreground hover:text-foreground"}`}>
                <Clock className="h-3.5 w-3.5" />
                Lịch sử
              </button>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {/* Model selector — custom dropdown với logo */}
              <div ref={modelMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setModelMenuOpen((o) => !o)}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-background/60 pl-2 pr-2.5 text-xs font-semibold text-foreground hover:bg-muted/40"
                >
                  <EngineLogo engine={engine} size="sm" />
                  <span>{engine === "premium" ? "VoxStudio" : "Edge TTS"}</span>
                  <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${modelMenuOpen ? "rotate-180" : ""}`} />
                </button>

                {modelMenuOpen && (
                  <div className="absolute right-0 top-[calc(100%+6px)] z-[60] w-72 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-2xl">
                    <div className="p-1">
                      <ModelOption
                        active={engine === "premium"}
                        name="VoxStudio"
                        desc="Giọng đọc tự nhiên, model riêng, tiếng Việt chuẩn"
                        engineId="premium"
                        onClick={() => {
                          setEngine("premium");
                          setModelMenuOpen(false);
                        }}
                      />
                      <ModelOption
                        active={engine === "cloud"}
                        name="Edge TTS"
                        desc="400+ giọng, 100+ ngôn ngữ, miễn phí siêu rẻ"
                        engineId="cloud"
                        onClick={() => {
                          setEngine("cloud");
                          setModelMenuOpen(false);
                        }}
                      />
                    </div>
                    <div className="border-t border-border/60 bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground">
                      Bạn có thể đổi model bất kỳ lúc nào — settings sẽ được lưu.
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>

          {panel === "settings" ? (
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
              <label className="block text-xs font-semibold text-muted-foreground">
                Ngôn ngữ
                <select value={language} onChange={(event) => setLanguage(event.target.value)} className="mt-2 h-12 w-full rounded-lg border border-border/60 bg-background px-3 text-sm font-semibold text-foreground outline-none focus:border-primary/50">
                  <option value="vi">Tiếng Việt</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                  <option value="ko">한국어</option>
                  <option value="zh">中文</option>
                </select>
              </label>

              {engine === "premium" ? (
                <label className="block text-xs font-semibold text-muted-foreground">
                  Chọn giọng nói
                  <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)} className="mt-2 h-12 w-full rounded-lg border border-border/60 bg-background px-3 text-sm font-semibold text-foreground outline-none focus:border-primary/50">
                    <option value="">Giọng mặc định</option>
                    {premiumVoices.length > 0 && (
                      <optgroup label="VoxStudio">
                        {premiumVoices.map((voice) => (
                          <option key={voice.slug} value={voice.slug}>{voice.display_name}</option>
                        ))}
                      </optgroup>
                    )}
                    {voices.length > 0 && (
                      <optgroup label="Giọng của tôi">
                        {voices.map((voice) => (
                          <option key={voice.id} value={voice.id}>{voice.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </label>
              ) : (
                <label className="block text-xs font-semibold text-muted-foreground">
                  Giọng Edge TTS
                  <select value={edgeVoice} onChange={(event) => setEdgeVoice(event.target.value)} className="mt-2 h-12 w-full rounded-lg border border-border/60 bg-background px-3 text-sm font-semibold text-foreground outline-none focus:border-primary/50">
                    <option value="">Tự động chọn giọng</option>
                    {filteredEdgeVoices.map((voice) => (
                      <option key={voice.name} value={voice.name}>{voice.name} · {voice.gender}</option>
                    ))}
                  </select>
                </label>
              )}

              <Slider label="Tốc độ" value={speed} onChange={setSpeed} min={0.5} max={1.5} step={0.05} suffix="x" />

              {engine === "premium" && (
                <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                  <button
                    onClick={() => setShowAdvanced((value) => !value)}
                    className="flex w-full items-center justify-between text-xs font-semibold text-foreground hover:text-primary"
                  >
                    <span>Tham số VoxStudio</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                  </button>

                  {showAdvanced && (
                    <div className="mt-4 space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <Slider label="Số bước" value={numStep} onChange={(value) => setNumStep(Math.round(value))} min={4} max={64} step={1} suffix="" />
                        <Slider label="Guidance" value={guidanceScale} onChange={setGuidanceScale} min={0} max={4} step={0.1} suffix="" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Slider label="T-shift" value={tShift} onChange={setTShift} min={0} max={1} step={0.01} suffix="" />
                        <Slider label="Layer penalty" value={layerPenaltyFactor} onChange={setLayerPenaltyFactor} min={0} max={20} step={0.5} suffix="" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Slider label="Position temp" value={positionTemperature} onChange={setPositionTemperature} min={0} max={20} step={0.5} suffix="" />
                        <Slider label="Class temp" value={classTemperature} onChange={setClassTemperature} min={0} max={2} step={0.05} suffix="" />
                      </div>
                      <Slider label="Độ dài chunk" value={audioChunkDuration} onChange={setAudioChunkDuration} min={5} max={30} step={0.5} suffix="s" />
                      <div className="space-y-2">
                        <CheckboxRow label="Khử nhiễu" checked={denoise} onChange={setDenoise} />
                        <CheckboxRow label="Tiền xử lý prompt" checked={preprocessPrompt} onChange={setPreprocessPrompt} />
                        <CheckboxRow label="Hậu xử lý audio" checked={postprocessOutput} onChange={setPostprocessOutput} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <button onClick={saveSettings} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border/60 bg-background/60 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground">
                <Save className="h-3.5 w-3.5" />
                Lưu cài đặt
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button onClick={insertPause} className="inline-flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-background/60 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground">
                  <PauseCircle className="h-3.5 w-3.5" />
                  Khoảng dừng
                </button>
                <button onClick={resetSettings} className="inline-flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-background/60 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Đặt lại
                </button>
              </div>

              <button onClick={generate} disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-sm font-bold text-background shadow-lg hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Tạo Giọng Nói
              </button>
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {history.length > 0 && (
                <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    {history.length} mục · {historyNewestFirst ? "Mới nhất trước" : "Cũ nhất trước"}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={reloadHistory}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      aria-label="Làm mới lịch sử"
                      title="Làm mới lịch sử"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryNewestFirst((value) => !value)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      aria-label="Đổi thứ tự lịch sử"
                      title={historyNewestFirst ? "Cũ nhất trước" : "Mới nhất trước"}
                    >
                      <FileText className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={clearHistoryItems}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                      aria-label="Xoá toàn bộ lịch sử"
                      title="Xoá toàn bộ lịch sử"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
              {history.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/60 bg-background/35 p-8 text-center text-sm text-muted-foreground">
                  <Clock className="mx-auto mb-3 h-7 w-7 opacity-60" />
                  <div className="font-semibold text-foreground">Chưa có lịch sử TTS</div>
                  <p className="mt-1 text-xs leading-5">
                    Audio tạo thành công hoặc lỗi xử lý sẽ được lưu trên trình duyệt này.
                  </p>
                </div>
              ) : (
                visibleHistory.map((item) => {
                  const isProcessing = item.status === "processing";
                  const isDone = item.status === "done";
                  const isFailed = item.status === "failed";
                  return (
                  <div
                    key={item.id}
                    className={`rounded-2xl border bg-background/45 p-4 shadow-sm transition-all ${
                      isProcessing
                        ? "border-primary/60 ring-2 ring-primary/30"
                        : "border-border/60"
                    }`}
                  >
                    <div className="flex items-center gap-2 border-b border-border/50 pb-3">
                      <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
                        isDone ? "bg-primary/15 text-primary" :
                        isFailed ? "bg-red-500/10 text-red-500" :
                        "bg-primary/15 text-primary"
                      }`}>
                        {isProcessing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : item.engine === "premium" ? (
                          <Mic2 className="h-4 w-4" />
                        ) : (
                          <Zap className="h-4 w-4" />
                        )}
                      </div>
                      {isDone ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : isFailed ? (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
                      ) : (
                        <RotateCcw className="h-4 w-4 shrink-0 animate-spin text-primary" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                        {formatHistoryTime(item.createdAt)}
                      </span>
                      <span className="rounded-md bg-muted/70 px-2 py-1 text-[11px] font-bold text-foreground">
                        {item.charCount.toLocaleString("vi-VN")}
                      </span>
                      <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-wide ${
                        isDone ? "bg-foreground text-background" :
                        isFailed ? "bg-red-500 text-white" :
                        "bg-primary text-primary-foreground"
                      }`}>
                        {isDone ? "XONG" : isFailed ? "THẤT BẠI" : "ĐANG XỬ LÝ"}
                      </span>
                      {!isProcessing && (
                        <button
                          type="button"
                          onClick={() => deleteHistoryItem(item.id)}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                          aria-label="Xoá mục lịch sử"
                          title="Xoá mục lịch sử"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <p className="mt-3 line-clamp-2 text-sm font-medium leading-6 text-foreground">
                      {item.text}
                    </p>

                    {isProcessing ? (
                      <div className="mt-3">
                        <div className="relative h-1.5 overflow-hidden rounded-full bg-muted/60">
                          <div className="absolute inset-y-0 left-0 w-1/2 animate-[indeterminate_1.5s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-transparent via-primary to-transparent" />
                        </div>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          Đang tạo giọng nói... vui lòng chờ vài giây.
                        </p>
                      </div>
                    ) : isDone && item.audioUrl ? (
                      <div className="mt-3">
                        <CompactAudioPlayer
                          src={mediaUrl(item.audioUrl)}
                          duration={item.duration}
                          onReuse={() => reuseHistoryItem(item)}
                        />
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 p-3">
                        <p className="line-clamp-2 text-xs leading-5 text-red-700 dark:text-red-300">
                          {item.error || "Tác vụ chưa tạo được audio."}
                        </p>
                        <button
                          type="button"
                          onClick={() => reuseHistoryItem(item)}
                          className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-red-500/25 bg-background/60 px-3 text-xs font-semibold text-red-700 hover:bg-red-500/10 dark:text-red-300"
                        >
                          <Repeat className="h-3.5 w-3.5" />
                          Dùng lại nội dung
                        </button>
                      </div>
                    )}
                  </div>
                  );
                })
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ── SUBTITLE TAB ───────────────────────────────────────────────────────
function SubtitleTab() {
  const [tab, setTab] = useState<"video" | "file">("video");
  const [autoTranslate, setAutoTranslate] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SttResult | null>(null);
  const [error, setError] = useState("");

  async function runTranscribe() {
    setError("");
    setResult(null);
    if (!file) {
      setError("Chọn file audio/video trước khi tạo phụ đề.");
      return;
    }
    setBusy(true);
    try {
      setResult(await transcribeAudio({ audio: file, language }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được phụ đề.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-88px)] gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
      <section className="flex flex-col rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-xs font-bold text-muted-foreground">
            <Repeat className="h-4 w-4 text-primary" />
            Giọng nói thành văn bản
          </div>
          <div className="inline-flex rounded-lg border border-border/60 bg-muted/30 p-1">
            <button onClick={() => setTab("video")} className={`rounded-md px-3 py-1.5 text-xs font-bold ${tab === "video" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
              Audio / Video
            </button>
            <button onClick={() => setTab("file")} className={`rounded-md px-3 py-1.5 text-xs font-bold ${tab === "file" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
              File audio
            </button>
          </div>
        </div>

        <label className="flex min-h-[54vh] flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-primary/50 bg-background px-6 py-16 text-center text-sm text-muted-foreground hover:border-primary">
          <div className="grid h-14 w-14 place-items-center rounded-full border border-border/60 bg-card/70">
            <Upload className="h-6 w-6" />
          </div>
          <span className="text-lg font-black text-foreground">
            {file ? file.name : "Nhấp hoặc kéo thả file vào đây"}
          </span>
          <span className="max-w-md text-xs leading-5">
            Hỗ trợ MP3, AAC, WAV, M4A, OGG, MP4, MOV. Kết quả trả về văn bản và segments subtitle.
          </span>
          <input
            type="file"
            accept="audio/*,video/*"
            className="hidden"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/50 p-2">
          <SelectControl label="Ngôn ngữ audio" value={language} onChange={setLanguage} options={[
            ["auto", "Tự động phát hiện"],
            ["vi", "Tiếng Việt"],
            ["en", "English"],
            ["ja", "日本語"],
            ["ko", "한국어"],
            ["zh", "中文"],
          ]} />
          <div className="min-w-52">
            <ToggleRow label="Dịch tự động" value={autoTranslate} onChange={setAutoTranslate} />
          </div>
          <div className="ml-auto text-xs font-semibold text-muted-foreground">
            {file ? "Sẵn sàng chuyển đổi" : "Chưa có file"}
          </div>
          <button onClick={runTranscribe} disabled={busy} className="inline-flex h-11 items-center gap-2 rounded-lg bg-foreground px-5 text-xs font-black text-background hover:scale-[1.01] disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Chuyển đổi
          </button>
        </div>
      </section>

      <aside className="flex min-h-[calc(100vh-88px)] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm">
        <div className="flex items-center justify-between border-b border-border/60 p-4">
          <div className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3 text-xs font-bold text-background">
            <Clock className="h-3.5 w-3.5" />
            Kết quả
          </div>
          <div className="flex gap-2">
            <span className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-xs font-bold text-muted-foreground">SRT</span>
            <span className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-xs font-bold text-muted-foreground">JSON</span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>}
          {result ? (
            <div className="rounded-2xl border border-border/60 bg-background/45 p-4">
              <div className="mb-3 flex items-center justify-between text-xs">
                <span className="font-bold uppercase text-muted-foreground">Văn bản nhận diện</span>
                <span className="rounded-md bg-muted/70 px-2 py-1 font-bold">{result.language || language}</span>
              </div>
              <p className="max-h-[55vh] overflow-auto whitespace-pre-wrap text-sm font-medium leading-6">{result.text || "Không nhận được nội dung."}</p>
            </div>
          ) : (
            <div className="flex min-h-72 items-center justify-center rounded-2xl border border-dashed border-border/60 bg-background/35 p-8 text-center">
              <div>
                <FileText className="mx-auto h-9 w-9 text-muted-foreground/50" />
                <p className="mt-3 text-sm font-bold">Lịch sử trống</p>
                <p className="mt-1 text-xs text-muted-foreground">Kết quả STT sẽ hiện ở đây sau khi chạy.</p>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ── DUBBING TAB ────────────────────────────────────────────────────────
function DubbingTab() {
  const [step] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [targetLanguage, setTargetLanguage] = useState("vietnamese");
  const [enableSubtitle, setEnableSubtitle] = useState(true);
  const [enableDubbing, setEnableDubbing] = useState(true);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [project, setProject] = useState<DubbingProject | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    listVoices()
      .then((res) => setVoices(res.voices || []))
      .catch(() => setVoices([]));
  }, []);

  async function createProject() {
    setError("");
    setProject(null);
    if (!file) {
      setError("Chọn video trước khi tạo dự án lồng tiếng.");
      return;
    }
    setBusy(true);
    try {
      setProject(await createDubbingProject({
        video: file,
        target_language: targetLanguage,
        source_language: sourceLanguage,
        voice_id: voiceId || null,
        enable_dubbing: enableDubbing,
        enable_subtitle: enableSubtitle,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được dự án lồng tiếng.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-88px)] gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
      <section className="flex flex-col rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-xs font-bold text-muted-foreground">
            <Mic2 className="h-4 w-4 text-primary" />
            Lồng tiếng tự động
          </div>
          <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
            {["Tệp", "Cài đặt", "Tạo dự án"].map((label, index) => (
              <span key={label} className={`rounded-full border px-3 py-1 ${index + 1 === step ? "border-primary/50 bg-primary/10 text-primary" : "border-border/60 bg-background/45"}`}>
                {index + 1}. {label}
              </span>
            ))}
          </div>
        </div>

        <label className="flex min-h-[42vh] flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-primary/50 bg-background px-6 py-16 text-center text-sm text-muted-foreground hover:border-primary">
          <div className="grid h-14 w-14 place-items-center rounded-full border border-border/60 bg-card/70">
            <Upload className="h-6 w-6" />
          </div>
          <span className="text-lg font-black text-foreground">{file ? file.name : "Nhấp hoặc kéo thả video vào đây"}</span>
          <span className="max-w-md text-xs leading-5">Hỗ trợ video/audio dùng cho pipeline dubbing. File lớn nên xử lý trong desktop app nếu backend local yếu.</span>
          <input
            type="file"
            accept="video/*,audio/*"
            className="hidden"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
        </label>

        <div className="mt-4 grid gap-3 rounded-2xl border border-border/60 bg-card/50 p-4 md:grid-cols-2">
          <SelectControl label="Ngôn ngữ nguồn" value={sourceLanguage} onChange={setSourceLanguage} options={[
            ["auto", "Tự động phát hiện"],
            ["english", "English"],
            ["vietnamese", "Tiếng Việt"],
            ["japanese", "日本語"],
            ["korean", "한국어"],
            ["chinese", "中文"],
          ]} />
          <SelectControl label="Ngôn ngữ đích" value={targetLanguage} onChange={setTargetLanguage} options={[
            ["vietnamese", "Tiếng Việt"],
            ["english", "English"],
            ["japanese", "日本語"],
            ["korean", "한국어"],
            ["chinese", "中文"],
          ]} />
          <SelectControl
            label="Giọng clone"
            value={voiceId}
            onChange={setVoiceId}
            options={[["", "Dùng giọng mặc định"], ...voices.map((voice) => [voice.id, voice.name] as [string, string])]}
          />
          <SelectField label="Engine" value="VoxStudio pipeline" />
          <ToggleRow label="Tạo audio lồng tiếng" value={enableDubbing} onChange={setEnableDubbing} />
          <ToggleRow label="Tạo phụ đề" value={enableSubtitle} onChange={setEnableSubtitle} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/50 p-2">
          <div className="text-xs font-semibold text-muted-foreground">
            {file ? "Sẵn sàng tạo project" : "Chưa có file đầu vào"}
          </div>
          <button onClick={createProject} disabled={busy} className="ml-auto inline-flex h-11 items-center gap-2 rounded-lg bg-foreground px-5 text-xs font-black text-background hover:scale-[1.01] disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic2 className="h-4 w-4" />}
            Bắt đầu
          </button>
        </div>
      </section>

      <aside className="flex min-h-[calc(100vh-88px)] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm">
        <div className="flex items-center justify-between border-b border-border/60 p-4">
          <div className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3 text-xs font-bold text-background">
            <Clock className="h-3.5 w-3.5" />
            Tác vụ
          </div>
          <button
            type="button"
            onClick={() => {
              setProject(null);
              setError("");
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground hover:text-foreground"
            title="Làm mới trạng thái"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>}
          {project ? (
            <div className="rounded-2xl border border-border/60 bg-background/45 p-4">
              <div className="mb-3 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span className="text-sm font-black">Đã tạo dự án</span>
              </div>
              <p className="break-all text-xs leading-5 text-muted-foreground">{project.id}</p>
              <p className="mt-3 text-xs text-muted-foreground">Mở tab Dự án để theo dõi tiến trình và export.</p>
            </div>
          ) : (
            <div className="flex min-h-72 items-center justify-center rounded-2xl border border-dashed border-border/60 bg-background/35 p-8 text-center">
              <div>
                <Folder className="mx-auto h-9 w-9 text-muted-foreground/50" />
                <p className="mt-3 text-sm font-bold">Chưa có tác vụ nào</p>
                <p className="mt-1 text-xs text-muted-foreground">Project mới sẽ hiện tại đây sau khi bấm Bắt đầu.</p>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ── VOICE MODELS TAB ───────────────────────────────────────────────────
function VoiceModelsTab() {
  const [selected, setSelected] = useState("gpt-sovits");
  const [premiumVoices, setPremiumVoices] = useState<PremiumVoice[]>([]);
  const [edgeVoices, setEdgeVoices] = useState<EdgeVoice[]>([]);

  useEffect(() => {
    void Promise.allSettled([listPremiumVoices(), listEdgeVoices()]).then(([premium, edge]) => {
      setPremiumVoices(premium.status === "fulfilled" ? premium.value.voices || [] : []);
      setEdgeVoices(edge.status === "fulfilled" ? edge.value.voices || [] : []);
    });
  }, []);

  const models = [
    ...premiumVoices.map((voice) => ({
      id: voice.slug,
      name: voice.display_name,
      desc: voice.description || `VoxStudio · ${voice.language || "đa ngôn ngữ"} · ${voice.gender}`,
      badge: "VoxStudio",
    })),
    ...edgeVoices.slice(0, 12).map((voice) => ({
      id: voice.name,
      name: voice.name,
      desc: `Edge TTS · ${voice.locale} · ${voice.gender}`,
      badge: "Edge TTS",
    })),
  ];

  return (
    <div className="max-w-4xl">
      <PageTitle icon={Sparkles} title="Mẫu giọng nói AI" desc="Lựa chọn model AI phù hợp với nhu cầu của bạn" />

      <div className="space-y-3">
        {models.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-card/20 p-12 text-center text-sm text-muted-foreground">
            Chưa tải được danh sách giọng từ server.
          </div>
        ) : models.map((m) => {
          const active = selected === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setSelected(m.id)}
              className={`group w-full text-left rounded-xl border p-4 transition-all hover:border-primary/30 ${
                active
                  ? "border-primary/40 bg-primary/[0.05] ring-1 ring-primary/20"
                  : "border-border/60 bg-card/40"
              }`}
            >
              <div className="flex items-center gap-3">
                <CircleDot
                  className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground/40"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">{m.name}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      active ? "bg-primary/20 text-primary" : "bg-muted/40 text-muted-foreground"
                    }`}>
                      {m.badge}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{m.desc}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── SAVED VOICES TAB ───────────────────────────────────────────────────
function SavedVoicesTab() {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [name, setName] = useState("");
  const [refText, setRefText] = useState("");
  const [tags, setTags] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function reloadVoices() {
    listVoices()
      .then((res) => setVoices(res.voices || []))
      .catch(() => setVoices([]));
  }

  useEffect(() => {
    listVoices()
      .then((res) => setVoices(res.voices || []))
      .catch(() => setVoices([]));
  }, []);

  async function runClone() {
    setError("");
    setMessage("");
    if (!name.trim()) {
      setError("Nhập tên giọng nói trước khi nhân bản.");
      return;
    }
    if (!file) {
      setError("Chọn file audio mẫu trước khi nhân bản.");
      return;
    }
    if (!consent) {
      setError("Bạn cần xác nhận có quyền sử dụng giọng nói này.");
      return;
    }
    setBusy(true);
    try {
      const voice = await cloneVoice({
        audio: file,
        name: name.trim(),
        ref_text: refText.trim(),
        tags: tags.trim(),
        consent,
      });
      setMessage(`Đã tạo giọng "${voice.name}".`);
      setName("");
      setRefText("");
      setTags("");
      setFile(null);
      reloadVoices();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không nhân bản được giọng nói.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-88px)] gap-4 xl:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
      <section className="flex flex-col rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm sm:p-6">
        <div className="mb-4 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground">
          <Wand2 className="h-4 w-4 text-primary" />
          Nhân bản giọng nói
        </div>

        <div className="space-y-4 rounded-2xl border border-primary/50 bg-background p-5">
          <SelectField label="Provider" value="VoxStudio" />
          <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Tên giọng nói *
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="VD: Giọng đọc tin tức"
              className="mt-2 h-11 w-full rounded-lg border border-border/60 bg-card/50 px-3 text-sm font-semibold outline-none focus:border-primary/50"
            />
          </label>

          <label className="flex min-h-52 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 bg-card/35 p-6 text-center text-sm text-muted-foreground hover:border-primary/50">
            <Upload className="h-7 w-7" />
            <span className="font-black text-foreground">{file ? file.name : "Kéo thả hoặc nhấp để chọn audio"}</span>
            <span className="text-xs leading-5">Khuyến nghị 10 giây - 5 phút, WAV/MP3/M4A sạch tiếng nền.</span>
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>

          <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Văn bản nghe trước
            <textarea
              value={refText}
              onChange={(event) => setRefText(event.target.value)}
              maxLength={500}
              placeholder="Nhập câu mẫu trùng với audio nếu có..."
              className="mt-2 min-h-24 w-full resize-none rounded-lg border border-border/60 bg-card/50 px-3 py-3 text-sm outline-none focus:border-primary/50"
            />
            <span className="mt-1 block text-right text-[11px] text-muted-foreground">{refText.length} / 500</span>
          </label>

          <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Tags
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="news, male, vietnamese"
              className="mt-2 h-11 w-full rounded-lg border border-border/60 bg-card/50 px-3 text-sm outline-none focus:border-primary/50"
            />
          </label>

          <CheckboxRow label="Tôi có quyền sử dụng giọng nói này" checked={consent} onChange={setConsent} />
        </div>

        {(error || message) && (
          <div className={`mt-4 rounded-xl border px-3 py-2 text-sm ${error ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>
            {error || message}
          </div>
        )}

        <button onClick={runClone} disabled={busy} className="mt-4 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-foreground text-sm font-black text-background hover:scale-[1.01] disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          Nhân bản
        </button>
      </section>

      <aside className="flex min-h-[calc(100vh-88px)] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm">
        <div className="flex items-center justify-between border-b border-border/60 p-4">
          <div className="inline-flex items-center gap-2 text-sm font-black">
            <Music2 className="h-4 w-4" />
            Thư viện giọng nhân bản
            <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">{voices?.length ?? 0} giọng</span>
          </div>
          <button onClick={reloadVoices} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 text-xs font-bold text-muted-foreground hover:text-foreground">
            <RotateCcw className="h-3.5 w-3.5" />
            Làm mới
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!voices ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-background/35 p-12 text-center text-sm text-muted-foreground">Đang tải danh sách...</div>
          ) : voices.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-background/35 p-12 text-center">
              <Wand2 className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-bold">Chưa có voice clone nào</p>
              <p className="mt-1 text-xs text-muted-foreground">Tạo giọng mới bằng form bên trái.</p>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {voices.map((voice) => (
                <div key={voice.id} className="rounded-2xl border border-border/60 bg-background/45 p-4">
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/15 text-primary">
                      <Mic2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black">{voice.name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{voice.language || "Không rõ ngôn ngữ"} · {voice.created_at ? new Date(voice.created_at).toLocaleDateString("vi-VN") : ""}</div>
                    </div>
                  </div>
                  {voice.ref_text && <p className="mt-3 line-clamp-3 text-xs leading-5 text-muted-foreground">{voice.ref_text}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ── PROJECTS TAB ───────────────────────────────────────────────────────
function ProjectsTab() {
  const [projects, setProjects] = useState<DubbingListProject[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    void Promise.allSettled([listDubbingProjects(30), listJobs(30)]).then(([projectResult, jobResult]) => {
      setProjects(projectResult.status === "fulfilled" ? projectResult.value.projects || [] : []);
      setJobs(jobResult.status === "fulfilled" ? jobResult.value.jobs || [] : []);
    });
  }, []);

  return (
    <div>
      <PageTitle icon={Folder} title="Dự án của tôi" desc="Tất cả các dự án bạn đã tạo" />
      {!projects ? (
        <div className="rounded-2xl border border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">Đang tải dự án...</div>
      ) : projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/20 p-12 text-center text-sm text-muted-foreground">Chưa có dự án nào.</div>
      ) : (
        <div className="space-y-2.5">
          {projects.map((project) => (
            <ProjectRow
              key={project.id}
              title={project.title || project.video_filename || project.id}
              subtitle={`${project.source_language || "auto"} → ${project.target_language || "vietnamese"}`}
              meta={project.created_at ? new Date(project.created_at).toLocaleString("vi-VN") : project.id}
              status={project.status === "done" || project.status === "completed" ? "done" : "processing"}
            />
          ))}
        </div>
      )}

      {jobs.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border/60 bg-card/40 p-5">
          <h3 className="mb-3 text-sm font-semibold">Job gần đây</h3>
          <div className="space-y-2">
            {jobs.slice(0, 5).map((job) => (
              <div key={job.id} className="flex items-center justify-between rounded-lg border border-border/40 bg-background/30 px-3 py-2 text-sm">
                <span>{job.kind}</span>
                <span className="text-xs text-muted-foreground">{job.status}{typeof job.progress === "number" ? ` · ${Math.round(job.progress)}%` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── HISTORY TAB ────────────────────────────────────────────────────────
function HistoryTab({ payments }: { payments: Payment[] | null }) {
  return (
    <div>
      <PageTitle icon={Clock} title="Lịch sử xử lý" desc="Lịch sử thanh toán và các thao tác" />
      {!payments || payments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/20 p-12 text-center">
          <Clock className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">Chưa có giao dịch nào</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
                <th className="p-3 text-left font-medium">Mã</th>
                <th className="p-3 text-left font-medium">Gói</th>
                <th className="p-3 text-right font-medium">Số tiền</th>
                <th className="p-3 text-left font-medium">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.ref_code} className="border-b border-border/30 last:border-0">
                  <td className="p-3 font-mono text-xs">{p.ref_code}</td>
                  <td className="p-3 capitalize">{p.plan_id}</td>
                  <td className="p-3 text-right font-mono">{p.amount_vnd.toLocaleString("vi-VN")}đ</td>
                  <td className="p-3">
                    <StatusPill status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── SETTINGS TAB ───────────────────────────────────────────────────────
function SettingsTab({
  user,
  theme,
  setTheme,
}: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
}) {
  return (
    <div className="max-w-3xl space-y-5">
      <PageTitle icon={SettingsIcon} title="Cài đặt" desc="Tuỳ chỉnh tài khoản và giao diện" />

      <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Hồ sơ</h3>
        <div className="space-y-3">
          <SettingsRow icon={Mail} label="Email" value={user.email} badge={user.email_verified ? "Đã xác thực" : "Chưa xác thực"} badgeOk={user.email_verified} />
          <SettingsRow icon={Crown} label="Gói dịch vụ" value={user.plan.charAt(0).toUpperCase() + user.plan.slice(1)} />
          {user.plan_expires_at && (
            <SettingsRow icon={Clock} label="Hết hạn" value={new Date(user.plan_expires_at).toLocaleDateString("vi-VN")} />
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Giao diện</h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-muted/20">
              {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </div>
            <div>
              <div className="text-sm font-medium">Chế độ hiển thị</div>
              <div className="text-xs text-muted-foreground">{theme === "dark" ? "Tối" : "Sáng"}</div>
            </div>
          </div>
          <div className="inline-flex rounded-full border border-border/60 bg-card/40 p-1">
            <button onClick={() => setTheme("light")} className={`flex h-7 w-7 items-center justify-center rounded-full ${theme === "light" ? "bg-foreground text-background" : "text-muted-foreground"}`}>
              <Sun className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setTheme("dark")} className={`flex h-7 w-7 items-center justify-center rounded-full ${theme === "dark" ? "bg-foreground text-background" : "text-muted-foreground"}`}>
              <Moon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── TOPUP TAB ──────────────────────────────────────────────────────────
function TopupTab() {
  const [packs, setPacks] = useState<CreditPack[] | null>(null);

  useEffect(() => {
    fetchCreditPacks()
      .then((res) => setPacks((res.packs || []).filter((pack) => pack.is_active)))
      .catch(() => setPacks([]));
  }, []);

  return (
    <div className="max-w-4xl">
      <PageTitle icon={Wallet} title="Nạp credits" desc="Mua thêm credits — credits không hết hạn" />
      {!packs ? (
        <div className="rounded-2xl border border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">Đang tải gói credits...</div>
      ) : packs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/20 p-12 text-center text-sm text-muted-foreground">Chưa cấu hình gói credits.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          {packs.map((pack) => (
            <div
              key={pack.id}
              className={`relative rounded-2xl border p-5 transition-all hover:-translate-y-0.5 ${
                pack.is_popular ? "border-primary/40 bg-primary/[0.05] ring-1 ring-primary/20" : "border-border/60 bg-card/40"
              }`}
            >
              {pack.is_popular && (
                <div className="absolute -top-2.5 left-4 rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold uppercase text-primary-foreground">
                  Phổ biến
                </div>
              )}
              <Zap className="h-6 w-6 text-primary mb-3" />
              <div className="text-2xl font-bold">{pack.total_credits.toLocaleString("vi-VN")} credits</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {pack.base_credits.toLocaleString("vi-VN")} gốc
                {pack.bonus_credits > 0 ? ` + ${pack.bonus_credits.toLocaleString("vi-VN")} thưởng` : ""}
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-xl font-bold">{pack.price_vnd.toLocaleString("vi-VN")}đ</span>
              </div>
              <Link href={`/checkout/credits/${pack.id}`} className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/30 transition-transform hover:scale-[1.02]">
                Mua ngay
              </Link>
            </div>
          ))}
        </div>
      )}
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Áp dụng chính sách Fair Use. Credits topup không hết hạn.
      </p>
    </div>
  );
}

// ── SUPPORT TAB ────────────────────────────────────────────────────────
function SupportTab() {
  return (
    <div className="max-w-3xl">
      <PageTitle icon={HelpCircle} title="Trung tâm hỗ trợ" desc="Chúng tôi luôn sẵn sàng giúp bạn — phản hồi trong 24h" />
      <div className="grid gap-3 sm:grid-cols-2">
        <SupportLink icon={Mail} label="voxstudio.vn@gmail.com" desc="Phản hồi email trong 24h" href="mailto:voxstudio.vn@gmail.com" />
        <SupportLink icon={HelpCircle} label="Câu hỏi thường gặp" desc="Xem các câu trả lời nhanh" href="/#faq" />
        <SupportLink icon={ShieldCheck} label="Chính sách quyền riêng tư" desc="Cách bảo vệ dữ liệu của bạn" href="/privacy" />
        <SupportLink icon={FileText} label="Điều khoản dịch vụ" desc="Quy định sử dụng VoxStudio" href="/terms" />
      </div>
    </div>
  );
}

// ── HELPER COMPONENTS ──────────────────────────────────────────────────
function IconButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/50 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function BigToolCard({
  icon: Icon,
  title,
  desc,
  gradient,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  gradient: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card/40 p-5 text-left transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10"
    >
      <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} shadow-md`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{desc}</p>
      <ArrowRight className="absolute right-4 top-4 h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-1" />
    </button>
  );
}

function ProjectRow({
  title,
  subtitle,
  meta,
  status,
}: {
  title: string;
  subtitle: string;
  meta: string;
  status: "done" | "processing";
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-card/30 p-3 transition-colors hover:bg-card/60">
      <div className="flex h-10 w-14 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/30 to-fuchsia-500/20 shrink-0">
        <Play className="h-3.5 w-3.5 text-white fill-current" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs text-muted-foreground">{meta}</div>
        <div className="mt-1">
          {status === "done" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-500">
              <CheckCircle2 className="h-2.5 w-2.5" />
              Hoàn thành
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-500">
              <Loader className="h-2.5 w-2.5 animate-spin" />
              Đang xử lý
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  unit,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
      <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-background/60 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-black tracking-tight">{value}</span>
        <span className="text-xs font-semibold text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { class: string; label: string }> = {
    pending: { class: "border-yellow-500/30 bg-yellow-500/10 text-yellow-500", label: "Chờ xác nhận" },
    paid: { class: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500", label: "Đã thanh toán" },
    cancelled: { class: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400 line-through", label: "Đã huỷ" },
  };
  const cfg = map[status] || map.cancelled;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cfg.class}`}>
      {cfg.label}
    </span>
  );
}

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  suffix: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-primary"
      />
    </label>
  );
}

function SelectField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="mt-1.5 flex w-full items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm">
        <span>{value}</span>
        <span className="text-[10px] font-bold uppercase text-muted-foreground">Cố định</span>
      </div>
    </div>
  );
}

function SelectControl({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 h-10 w-full rounded-lg border border-border/60 bg-background/40 px-3 text-sm outline-none focus:border-primary/40"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border/40 bg-background/30 px-4 py-3">
      <span className="text-sm">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={`relative h-5 w-9 rounded-full transition-colors ${value ? "bg-primary" : "bg-muted/60"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform ${
            value ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function SettingsRow({
  icon: Icon,
  label,
  value,
  badge,
  badgeOk,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  badge?: string;
  badgeOk?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-sm font-medium truncate">{value}</div>
      </div>
      {badge && (
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
            badgeOk
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
              : "border-yellow-500/30 bg-yellow-500/10 text-yellow-500"
          }`}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

function SupportLink({
  icon: Icon,
  label,
  desc,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  desc: string;
  href: string;
}) {
  return (
    <Link href={href} className="group flex items-start gap-3 rounded-xl border border-border/60 bg-card/40 p-4 transition-colors hover:border-primary/30">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/5">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

// ── ENGINE LOGO ────────────────────────────────────────────────────────
function EngineLogo({
  engine,
  size = "md",
}: {
  engine: "premium" | "cloud";
  size?: "sm" | "md";
}) {
  const px = size === "sm" ? 20 : 36;
  const className = size === "sm" ? "h-5 w-5" : "h-9 w-9";
  const src = engine === "premium" ? "/logo.png" : "/edge-logo.svg";
  const alt = engine === "premium" ? "VoxStudio" : "Microsoft Edge";
  return (
    <Image
      src={src}
      alt={alt}
      width={px}
      height={px}
      className={`${className} shrink-0 rounded-md object-contain`}
    />
  );
}

// ── MODEL OPTION (dropdown row) ────────────────────────────────────────
function ModelOption({
  engineId,
  name,
  desc,
  active,
  onClick,
}: {
  engineId: "premium" | "cloud";
  name: string;
  desc: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition-colors ${
        active ? "bg-foreground/10" : "hover:bg-muted/50"
      }`}
    >
      <EngineLogo engine={engineId} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold">{name}</span>
          {active && (
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{desc}</div>
      </div>
    </button>
  );
}

// ── COMPACT AUDIO PLAYER ───────────────────────────────────────────────
function CompactAudioPlayer({
  src,
  duration: durationProp,
  onReuse,
}: {
  src: string;
  duration?: number;
  onReuse?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(durationProp ?? 0);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrent(el.currentTime || 0);
    const onMeta = () => setTotal(el.duration || durationProp || 0);
    const onEnd = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnd);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [src, durationProp]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) el.pause();
    else el.play();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !total) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    el.currentTime = pct * total;
    setCurrent(el.currentTime);
  };

  const fmt = (s: number) => {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${m}:${ss.toString().padStart(2, "0")}`;
  };

  const pct = total > 0 ? (current / total) * 100 : 0;

  return (
    <div className="flex items-center gap-3 rounded-full border border-border/60 bg-background/40 p-1.5 pr-3">
      <button
        type="button"
        onClick={toggle}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background hover:scale-105 transition-transform"
        aria-label={playing ? "Tạm dừng" : "Phát"}
      >
        {playing ? <PauseCircle className="h-5 w-5" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
      </button>

      <div
        onClick={seek}
        className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-muted/60"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-foreground transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
        {fmt(current)} / {fmt(total)}
      </span>

      {onReuse && (
        <button
          type="button"
          onClick={onReuse}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          aria-label="Dùng lại"
          title="Dùng lại"
        >
          <Repeat className="h-3.5 w-3.5" />
        </button>
      )}
      <a
        href={src}
        download
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
        aria-label="Tải audio"
        title="Tải audio"
      >
        <Download className="h-3.5 w-3.5" />
      </a>

      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
    </div>
  );
}
