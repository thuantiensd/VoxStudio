"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
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
  ChevronRight,
  ChevronDown,
  CircleDot,
  ShieldCheck,
  Mail,
  Crown,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listMyPayments, type Payment } from "@/lib/api";

type Tab =
  | "home"
  | "video-download"
  | "tts"
  | "subtitle"
  | "dubbing"
  | "video-ai"
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
      { id: "video-ai", label: "Tạo video AI", icon: Sparkles, badge: "Mới" },
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

export default function AccountPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("voxstudio:theme") as "dark" | "light" | null;
    if (saved) setTheme(saved);
  }, []);
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
    <div className="flex min-h-screen bg-background">
      {/* SIDEBAR */}
      {sidebarOpen && (
        <aside className="hidden w-60 shrink-0 border-r border-border/40 bg-card/30 lg:flex lg:flex-col">
          <div className="flex h-14 items-center gap-2 border-b border-border/40 px-4">
            <Link href="/" className="inline-flex items-center gap-2">
              <Image src="/logo.png" alt="VoxStudio" width={24} height={24} className="h-6 w-6 rounded" />
              <span className="text-sm font-bold tracking-tight">VoxStudio</span>
            </Link>
          </div>

          {/* User card */}
          <div className="m-3 flex items-center gap-2.5 rounded-xl border border-border/60 bg-card/40 px-3 py-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-fuchsia-500 text-xs font-bold text-primary-foreground shadow-lg shadow-primary/30">
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
                        onClick={() => setActiveTab(item.id)}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                          isActive
                            ? "bg-primary/10 text-primary border border-primary/20"
                            : "border border-transparent text-foreground/80 hover:bg-muted/40 hover:text-foreground"
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
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/40 bg-background/85 px-4 backdrop-blur-sm sm:px-6">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="hidden lg:flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/40 text-muted-foreground hover:bg-muted/40"
          >
            <PanelLeft className="h-4 w-4" />
          </button>

          <div className="relative hidden flex-1 max-w-md sm:block">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Tìm công cụ, dự án..."
              className="w-full rounded-lg border border-border/60 bg-card/40 py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground/60 focus:border-primary/40 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <IconButton icon={Gift} />
            <IconButton icon={Bell} />
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/40 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
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
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/40 text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

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
            <HomeTab user={user} payments={payments} setActiveTab={setActiveTab} />
          )}
          {activeTab === "video-download" && <VideoDownloadTab />}
          {activeTab === "tts" && <TtsTab />}
          {activeTab === "subtitle" && <SubtitleTab />}
          {activeTab === "dubbing" && <DubbingTab />}
          {activeTab === "video-ai" && <ComingSoonTab title="Tạo video AI" />}
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
  payments,
  setActiveTab,
}: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  payments: Payment[] | null;
  setActiveTab: (t: Tab) => void;
}) {
  const displayName = user.name || user.email.split("@")[0];
  const usageMonthly = {
    used: 365,
    total: 1000,
    breakdown: [
      { label: "Tải video", value: 200, color: "bg-violet-500" },
      { label: "TTS", value: 150, color: "bg-fuchsia-500" },
      { label: "Phụ đề", value: 185, color: "bg-pink-500" },
      { label: "Lồng tiếng", value: 100, color: "bg-emerald-500" },
    ],
  };

  return (
    <div className="space-y-6">
      {/* Welcome hero */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/[0.15] via-fuchsia-500/[0.08] to-card/40 p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/30 blur-3xl" />
        <div className="relative max-w-md">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">
            Chào mừng trở lại,
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{displayName}!</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            VoxStudio — Bộ công cụ AI toàn diện hỗ trợ bạn tạo nội dung chuyên nghiệp.
          </p>
        </div>
      </div>

      {/* 4 quick tools */}
      <div>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Công cụ phổ biến
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <BigToolCard icon={Film} title="Tải video" desc="Tải video từ YouTube, TikTok, Facebook..." gradient="from-violet-500 to-fuchsia-500" onClick={() => setActiveTab("video-download")} />
          <BigToolCard icon={FileText} title="Chuyển văn bản" desc="Chuyển văn bản thành giọng nói tự nhiên" gradient="from-fuchsia-500 to-pink-500" onClick={() => setActiveTab("tts")} />
          <BigToolCard icon={Repeat} title="Chuyển đổi phụ đề" desc="Chuyển đổi và dịch tuỳ chỉnh phụ đề" gradient="from-pink-500 to-orange-500" onClick={() => setActiveTab("subtitle")} />
          <BigToolCard icon={Mic2} title="Lồng tiếng video" desc="Lồng tiếng chuyên nghiệp cho video" gradient="from-emerald-500 to-teal-500" onClick={() => setActiveTab("dubbing")} />
        </div>
      </div>

      {/* 2-col: recent projects + usage */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Recent projects */}
        <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Dự án gần đây</h3>
            <button
              onClick={() => setActiveTab("projects")}
              className="text-xs text-primary hover:underline"
            >
              Xem tất cả →
            </button>
          </div>
          <div className="space-y-2.5">
            <ProjectRow title="Video giới thiệu sản phẩm" subtitle="Lồng tiếng video" meta="2 giờ trước" status="done" />
            <ProjectRow title="Bài thuyết trình công ty" subtitle="Chuyển đổi phụ đề" meta="1 ngày trước" status="processing" />
            <ProjectRow title="Podcast tập 15" subtitle="Văn bản thành giọng nói" meta="2 ngày trước" status="done" />
          </div>
        </div>

        {/* Usage */}
        <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
          <h3 className="mb-4 text-sm font-semibold">Sử dụng tháng này</h3>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight">{usageMonthly.used}</span>
            <span className="text-sm text-muted-foreground">/ {usageMonthly.total} credits</span>
            <span className="ml-auto text-xs font-semibold text-primary">
              {Math.round((usageMonthly.used / usageMonthly.total) * 100)}%
            </span>
          </div>
          <div className="mb-4 h-2 overflow-hidden rounded-full bg-muted/40 flex">
            {usageMonthly.breakdown.map((item, i) => (
              <div
                key={i}
                className={`h-full ${item.color} transition-all`}
                style={{ width: `${(item.value / usageMonthly.total) * 100}%` }}
              />
            ))}
          </div>
          <div className="space-y-2">
            {usageMonthly.breakdown.map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={`h-2 w-2 rounded-full ${item.color}`} />
                <span className="flex-1">{item.label}</span>
                <span className="font-mono text-muted-foreground">{item.value} credits</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-border/30 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Còn lại{" "}
              <span className="font-bold text-foreground">
                {usageMonthly.total - usageMonthly.used}
              </span>{" "}
              credits
            </span>
            <button
              onClick={() => setActiveTab("topup")}
              className="font-semibold text-primary hover:underline"
            >
              Nạp thêm →
            </button>
          </div>
        </div>
      </div>

      {/* Info strip */}
      <div className="grid gap-3 sm:grid-cols-3">
        <InfoCard icon={Zap} title="Tốc độ cao" desc="Render trên GPU mạnh, kết quả chỉ vài giây" />
        <InfoCard icon={CheckCircle2} title="Chất lượng cao" desc="Studio-grade audio, hỗ trợ xuất 4K" />
        <InfoCard icon={ShieldCheck} title="Bảo mật" desc="An toàn tuyệt đối, không chia sẻ dữ liệu" />
      </div>
    </div>
  );
}

// ── VIDEO DOWNLOAD TAB ─────────────────────────────────────────────────
function VideoDownloadTab() {
  const [url, setUrl] = useState("");
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
  const history = [
    { title: "Video giới thiệu sản phẩm", platform: "YouTube · 1080p", meta: "2 giờ trước", size: "45.2 MB" },
    { title: "Hướng dẫn sử dụng AI", platform: "Facebook · 720p", meta: "1 ngày trước", size: "32.1 MB" },
    { title: "Review công nghệ mới", platform: "TikTok · 1080p", meta: "2 ngày trước", size: "28.7 MB" },
  ];
  return (
    <div className="max-w-4xl">
      <PageTitle icon={Film} title="Tải video" desc="Tải video từ hơn 1000+ nền tảng phổ biến" />

      {/* URL input */}
      <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Dán link video
        </label>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=..."
            className="flex-1 rounded-lg border border-border/60 bg-background/40 px-4 py-2.5 text-sm placeholder:text-muted-foreground/60 focus:border-primary/40 focus:outline-none"
          />
          <button className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 hover:scale-105 transition-transform">
            <Download className="h-4 w-4" />
            Tải video
          </button>
        </div>

        <div className="mt-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Hoặc chọn nền tảng phổ biến
          </div>
          <div className="grid gap-2 grid-cols-4 sm:grid-cols-8">
            {platforms.map((p) => (
              <button
                key={p.name}
                className="flex flex-col items-center gap-1 rounded-lg border border-border/60 bg-background/40 p-3 hover:border-primary/30 transition-colors"
              >
                <div className={`h-6 w-6 rounded ${p.color}`} />
                <span className="text-[10px]">{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* History */}
      <div className="mt-6 rounded-2xl border border-border/60 bg-card/40 p-6">
        <h3 className="mb-4 text-sm font-semibold">Lịch sử tải video</h3>
        <div className="space-y-2">
          {history.map((h, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-border/40 bg-background/30 p-3 hover:bg-background/50 transition-colors">
              <div className="flex h-10 w-14 items-center justify-center rounded-lg bg-violet-500/20">
                <Film className="h-4 w-4 text-violet-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{h.title}</div>
                <div className="text-xs text-muted-foreground">{h.platform}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">{h.meta}</div>
                <div className="text-xs font-mono text-muted-foreground">{h.size}</div>
              </div>
              <button className="rounded-md border border-border/60 p-1.5 hover:bg-muted/40">
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── TTS TAB ────────────────────────────────────────────────────────────
function TtsTab() {
  const [tab, setTab] = useState<"text" | "file">("text");
  const [text, setText] = useState("");
  const [speed, setSpeed] = useState(1.0);
  const [pitch, setPitch] = useState(0);
  const [volume, setVolume] = useState(0);

  return (
    <div>
      <PageTitle icon={FileText} title="Văn bản thành giọng nói" desc="Chuyển đổi văn bản thành giọng nói tự nhiên với AI" />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Input column 2/3 */}
        <div className="lg:col-span-2 rounded-2xl border border-border/60 bg-card/40 p-6">
          <div className="mb-4 inline-flex rounded-lg border border-border/60 bg-background/40 p-0.5">
            <button
              onClick={() => setTab("text")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === "text" ? "bg-primary/15 text-primary" : "text-muted-foreground"
              }`}
            >
              Chuyển văn bản
            </button>
            <button
              onClick={() => setTab("file")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === "file" ? "bg-primary/15 text-primary" : "text-muted-foreground"
              }`}
            >
              Từ file văn bản
            </button>
          </div>

          {tab === "text" ? (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Nhập hoặc dán văn bản của bạn vào đây..."
                rows={12}
                className="w-full rounded-lg border border-border/60 bg-background/40 px-4 py-3 text-sm placeholder:text-muted-foreground/60 focus:border-primary/40 focus:outline-none resize-none"
              />
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>{text.length.toLocaleString()} / 5,000 ký tự</span>
                <span>~{Math.ceil(text.length / 800)} phút audio</span>
              </div>
            </>
          ) : (
            <button className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 bg-background/30 py-16 text-sm text-muted-foreground hover:border-primary/40">
              <FileUp className="h-8 w-8" />
              <span>Tải file .txt / .docx / .pdf</span>
              <span className="text-xs">Tối đa 10MB</span>
            </button>
          )}

          <button className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 hover:scale-[1.01] transition-transform">
            <Sparkles className="h-4 w-4" />
            Tạo giọng nói
          </button>
        </div>

        {/* Settings column 1/3 */}
        <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
          <h3 className="mb-4 text-sm font-semibold">Cài đặt giọng nói</h3>

          <div className="space-y-4">
            <SelectField label="Chọn giọng nói" value="Vy (Nữ) · Tự nhiên" />
            <SelectField label="Ngôn ngữ" value="Tiếng Việt" />
            <SelectField label="Model AI" value="GPT-SoVITS v2" />

            <Slider label="Tốc độ" value={speed} onChange={setSpeed} min={0.5} max={2} step={0.1} suffix="x" />
            <Slider label="Cao độ" value={pitch} onChange={setPitch} min={-12} max={12} step={1} suffix="" />
            <Slider label="Cường độ" value={volume} onChange={setVolume} min={-10} max={10} step={1} suffix="dB" />

            <div className="pt-3 border-t border-border/30">
              <SelectField label="Định dạng xuất" value="MP3" />
            </div>
          </div>

          <button className="mt-5 w-full rounded-lg border border-border/60 bg-background/40 py-2 text-xs font-semibold hover:bg-muted/40">
            Nghe thử
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SUBTITLE TAB ───────────────────────────────────────────────────────
function SubtitleTab() {
  const [tab, setTab] = useState<"video" | "file">("video");
  const [autoTranslate, setAutoTranslate] = useState(true);

  return (
    <div className="max-w-4xl">
      <PageTitle icon={Repeat} title="Chuyển đổi phụ đề" desc="Tự động tạo, dịch và chỉnh sửa phụ đề từ video" />

      <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
        <div className="mb-4 inline-flex rounded-lg border border-border/60 bg-background/40 p-0.5">
          <button
            onClick={() => setTab("video")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              tab === "video" ? "bg-primary/15 text-primary" : "text-muted-foreground"
            }`}
          >
            Từ video
          </button>
          <button
            onClick={() => setTab("file")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              tab === "file" ? "bg-primary/15 text-primary" : "text-muted-foreground"
            }`}
          >
            Từ file phụ đề
          </button>
        </div>

        <button className="mb-5 flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 bg-background/30 py-12 text-sm text-muted-foreground hover:border-primary/40">
          <Upload className="h-7 w-7" />
          <span className="font-semibold">
            Tải {tab === "video" ? "video lên để tự động tạo phụ đề" : "file phụ đề (SRT, VTT, ASS)"}
          </span>
          <span className="text-xs">Hỗ trợ MP4, MOV, AVI, MKV... (Tối đa 2GB)</span>
        </button>

        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Cài đặt phụ đề
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Ngôn ngữ gốc" value="Tự động phát hiện" />
            <SelectField label="Ngôn ngữ dịch" value="Tiếng Anh" />
            <SelectField label="Kiểu phụ đề" value="SRT" />
            <SelectField label="Kích thước chữ" value="Vừa" />
            <SelectField label="Vị trí" value="Dưới (Bottom)" />
          </div>

          <div className="mt-4">
            <ToggleRow label="Dịch tự động" value={autoTranslate} onChange={setAutoTranslate} />
          </div>
        </div>

        <button className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30">
          <Sparkles className="h-4 w-4" />
          Bắt đầu tạo phụ đề
        </button>
      </div>
    </div>
  );
}

// ── DUBBING TAB ────────────────────────────────────────────────────────
function DubbingTab() {
  const [step] = useState(1);
  const [similarity, setSimilarity] = useState(80);
  const [keepBackground, setKeepBackground] = useState(true);

  return (
    <div className="max-w-4xl">
      <PageTitle icon={Mic2} title="Lồng tiếng video" desc="Lồng tiếng chuyên nghiệp cho video bằng AI" />

      <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
        {/* 3-step indicator */}
        <div className="mb-6 flex items-center gap-2">
          {["Tải video", "Chọn giọng nói", "Xử lý"].map((label, i) => {
            const idx = i + 1;
            const active = idx === step;
            const done = idx < step;
            return (
              <div key={i} className="flex items-center gap-2 flex-1">
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    active
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30"
                      : done
                        ? "bg-emerald-500/20 text-emerald-500 border border-emerald-500/40"
                        : "bg-muted/40 text-muted-foreground"
                  }`}
                >
                  {done ? <CheckCircle2 className="h-4 w-4" /> : idx}
                </div>
                <span className={`text-xs ${active ? "font-semibold" : "text-muted-foreground"}`}>
                  {label}
                </span>
                {i < 2 && <div className="h-px flex-1 bg-border/40" />}
              </div>
            );
          })}
        </div>

        <button className="mb-5 flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 bg-background/30 py-12 text-sm text-muted-foreground hover:border-primary/40">
          <Upload className="h-7 w-7" />
          <span className="font-semibold">Tải video lên để bắt đầu lồng tiếng</span>
          <span className="text-xs">Hỗ trợ MP4, MOV, AVI, MKV... (Tối đa 2GB)</span>
        </button>

        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Cài đặt lồng tiếng
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Ngôn ngữ gốc" value="Tiếng Anh" />
            <SelectField label="Ngôn ngữ lồng tiếng" value="Tiếng Việt" />
            <SelectField label="Chọn giọng nói" value="Nam (Trầm ấm)" />
            <SelectField label="Model AI" value="ElevenLabs Multilingual v2" />
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">Độ tương đồng giọng nói</span>
                <span className="font-mono font-semibold">{similarity}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={similarity}
                onChange={(e) => setSimilarity(parseInt(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
            <ToggleRow label="Giữ nguyên nhạc nền" value={keepBackground} onChange={setKeepBackground} />
          </div>
        </div>

        <button className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30">
          <Mic2 className="h-4 w-4" />
          Bắt đầu lồng tiếng
        </button>
      </div>
    </div>
  );
}

// ── VOICE MODELS TAB ───────────────────────────────────────────────────
function VoiceModelsTab() {
  const [selected, setSelected] = useState("gpt-sovits");
  const models = [
    { id: "gpt-sovits", name: "GPT-SoVITS v2", desc: "Chất lượng cao, giọng nói tự nhiên nhất hiện tại", badge: "Khuyên dùng" },
    { id: "elevenlabs", name: "ElevenLabs Multilingual v2", desc: "Giọng nói tự nhiên, hỗ trợ đa ngôn ngữ tốt nhất", badge: "Đa ngôn ngữ" },
    { id: "google", name: "Google Cloud TTS", desc: "Ổn định, tốc độ nhanh, miễn phí ban đầu", badge: "Ổn định" },
    { id: "azure", name: "Microsoft Azure TTS", desc: "Hỗ trợ SSML đầy đủ, tuỳ chỉnh cao", badge: "SSML" },
    { id: "openai", name: "OpenAI TTS", desc: "Giọng nói tự nhiên, cảm xúc tốt", badge: "Cảm xúc" },
  ];

  return (
    <div className="max-w-4xl">
      <PageTitle icon={Sparkles} title="Mẫu giọng nói AI" desc="Lựa chọn model AI phù hợp với nhu cầu của bạn" />

      <div className="space-y-3">
        {models.map((m) => {
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
  return (
    <div className="max-w-4xl">
      <PageTitle icon={Wand2} title="Giọng đã lưu" desc="Voice clones và preset bạn đã tạo" />
      <div className="rounded-2xl border border-dashed border-border/60 bg-card/20 p-12 text-center">
        <Wand2 className="mx-auto h-10 w-10 text-muted-foreground/40" />
        <p className="mt-3 text-sm text-muted-foreground">Chưa có giọng nào được lưu</p>
        <button className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          Tạo voice clone đầu tiên
        </button>
      </div>
    </div>
  );
}

// ── PROJECTS TAB ───────────────────────────────────────────────────────
function ProjectsTab() {
  const projects = [
    { title: "Video giới thiệu sản phẩm", type: "Lồng tiếng video", date: "2 giờ trước", status: "done" as const },
    { title: "Bài thuyết trình công ty", type: "Chuyển đổi phụ đề", date: "1 ngày trước", status: "processing" as const },
    { title: "Podcast tập 15", type: "Văn bản thành giọng nói", date: "2 ngày trước", status: "done" as const },
    { title: "Quảng cáo Tết 2026", type: "Lồng tiếng video", date: "5 ngày trước", status: "done" as const },
  ];
  return (
    <div>
      <PageTitle icon={Folder} title="Dự án của tôi" desc="Tất cả các dự án bạn đã tạo" />
      <div className="space-y-2.5">
        {projects.map((p, i) => (
          <ProjectRow key={i} title={p.title} subtitle={p.type} meta={p.date} status={p.status} />
        ))}
      </div>
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
  const packs = [
    { mins: 30, price: "225k", popular: false },
    { mins: 100, price: "625k", popular: true },
    { mins: 500, price: "2.225k", popular: false },
  ];
  return (
    <div className="max-w-4xl">
      <PageTitle icon={Wallet} title="Nạp credits" desc="Mua thêm phút lồng tiếng — credits không hết hạn" />
      <div className="grid gap-4 sm:grid-cols-3">
        {packs.map((p) => (
          <div
            key={p.mins}
            className={`relative rounded-2xl border p-5 transition-all hover:-translate-y-0.5 ${
              p.popular ? "border-primary/40 bg-primary/[0.05] ring-1 ring-primary/20" : "border-border/60 bg-card/40"
            }`}
          >
            {p.popular && (
              <div className="absolute -top-2.5 left-4 rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold uppercase text-primary-foreground">
                Phổ biến
              </div>
            )}
            <Film className="h-6 w-6 text-primary mb-3" />
            <div className="text-2xl font-bold">+{p.mins} phút</div>
            <div className="mt-1 text-xs text-muted-foreground">Lồng tiếng video</div>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-xl font-bold">{p.price}</span>
              <span className="text-xs text-muted-foreground">VND</span>
            </div>
            <button className="mt-4 w-full rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/30 hover:scale-[1.02] transition-transform">
              Mua ngay
            </button>
          </div>
        ))}
      </div>
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

// ── COMING SOON ────────────────────────────────────────────────────────
function ComingSoonTab({ title }: { title: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/60 bg-card/20 p-16 text-center">
      <Sparkles className="mx-auto h-12 w-12 text-primary/40" />
      <h2 className="mt-4 text-2xl font-bold tracking-tight">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">Tính năng đang phát triển — sẽ ra mắt sớm!</p>
    </div>
  );
}

// ── HELPER COMPONENTS ──────────────────────────────────────────────────
function IconButton({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return (
    <button className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/40 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">
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

function InfoCard({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/40 bg-card/30 p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/5">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground leading-snug">{desc}</div>
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

function SelectField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <button className="mt-1.5 flex w-full items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm hover:border-primary/30">
        <span>{value}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
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
