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
  Crown,
  ArrowRight,
  LayoutDashboard,
  Wallet,
  Zap,
  Users,
  BookOpen,
  Mic2,
  Wand2,
  Film,
  FileText,
  Repeat,
  Music2,
  Image as ImageIcon,
  ChevronDown,
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
  TrendingUp,
  Folder,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listMyPayments, type Payment } from "@/lib/api";

export default function AccountPage() {
  const t = useTranslations("account");
  const tAuth = useTranslations("auth");
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [voiceOpen, setVoiceOpen] = useState(true);

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
      .catch(() => setPayments([]))
      .finally(() => setLoading(false));
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
  const paidPayments = payments?.filter((p) => p.status === "paid") || [];
  const pendingPayments = payments?.filter((p) => p.status === "pending") || [];

  // Mock usage breakdown
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
    <div className="flex min-h-screen bg-background">
      {/* SIDEBAR */}
      <aside className="hidden w-60 shrink-0 border-r border-border/40 bg-card/30 lg:flex lg:flex-col">
        {/* Logo */}
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
              {isPaid ? `Gói ${planName}` : "Gói Free"}
            </div>
          </div>
        </div>

        {/* Sections — categorized */}
        <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
          <NavSection title="TỔNG QUAN">
            <NavLink icon={LayoutDashboard} label="Trang chủ" active />
          </NavSection>

          <NavSection title="CÔNG CỤ AI">
            <NavLink icon={Film} label="Tải video" />
            <NavLink icon={FileText} label="Văn bản thành giọng nói" />
            <NavLink icon={Repeat} label="Chuyển đổi phụ đề" />
            <NavLink icon={Mic2} label="Lồng tiếng video" />
            <NavLink icon={Sparkles} label="Tạo video AI" badge="Mới" />
          </NavSection>

          <NavSection title="QUẢN LÝ">
            <NavLink icon={Folder} label="Dự án của tôi" />
            <NavLink icon={Clock} label="Lịch sử xử lý" />
            <NavLink icon={Music2} label="Mẫu giọng nói" />
            <NavLink icon={Wand2} label="Giọng đã lưu" />
          </NavSection>

          <NavSection title="TÀI KHOẢN">
            <NavLink icon={SettingsIcon} label="Cài đặt" />
            <NavLink icon={Wallet} label="Nạp credits" />
            <NavLink icon={HelpCircle} label="Hỗ trợ" />
          </NavSection>
        </div>

        {/* Bottom user card with credits */}
        <div className="m-3 rounded-xl border border-border/60 bg-card/40 p-3">
          <div className="flex items-center gap-2 text-xs">
            <Zap className="h-3 w-3 text-emerald-500" />
            <span className="font-bold">Credits</span>
            <span className="ml-auto rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-500 font-mono text-[10px]">
              {credits.toLocaleString("vi-VN")}
            </span>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {isPaid ? `Gói ${planName} đang hoạt động` : "Gói Free"}
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* TOP BAR — search + actions */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/40 bg-background/85 px-4 backdrop-blur-sm sm:px-6">
          <button className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/40 text-muted-foreground hover:bg-muted/40 lg:hidden">
            <PanelLeft className="h-4 w-4" />
          </button>

          {/* Search */}
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

        {/* CONTENT */}
        <main className="flex-1 p-4 sm:p-6">
          {/* Verify banner */}
          {!user.email_verified && (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/[0.05] p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-yellow-500" />
              <div className="flex-1 text-sm">
                {t("verifyBanner")}{" "}
                <Link href="/verify" className="font-semibold text-primary hover:underline">
                  {t("verifyAction")}
                </Link>
              </div>
            </div>
          )}

          {/* GRID — 12 cols */}
          <div className="grid gap-5 lg:grid-cols-12">
            {/* WELCOME HERO — 8 col */}
            <div className="lg:col-span-8 relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/[0.15] via-fuchsia-500/[0.08] to-card/40 p-6 sm:p-8">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-primary/30 blur-3xl"
              />
              <div className="pointer-events-none absolute right-6 top-6 hidden lg:block opacity-80">
                <div className="flex items-center gap-2">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500/40 to-pink-500/30 backdrop-blur">
                    <Film className="h-6 w-6 text-fuchsia-300" />
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/40 to-primary/30 backdrop-blur">
                    <Mic2 className="h-6 w-6 text-violet-300" />
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/40 to-teal-500/30 backdrop-blur">
                    <Sparkles className="h-6 w-6 text-emerald-300" />
                  </div>
                </div>
              </div>
              <div className="relative max-w-md">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">
                  Chào mừng trở lại,
                </p>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{displayName}!</h1>
                <p className="mt-3 text-sm text-muted-foreground">
                  VoxStudio — Bộ công cụ AI toàn diện hỗ trợ bạn tạo nội dung chuyên nghiệp.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Link
                    href="/#features"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 hover:scale-105 transition-transform"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Bắt đầu ngay
                  </Link>
                  <Link
                    href="/#features"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/40 px-4 py-2 text-sm font-semibold backdrop-blur hover:bg-background/60"
                  >
                    Xem tính năng
                  </Link>
                </div>
              </div>
            </div>

            {/* TOOLS QUICK GRID — 4 col */}
            <div className="lg:col-span-4 rounded-2xl border border-border/60 bg-card/40 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Công cụ phổ biến</h3>
                <Link href="/#features" className="text-xs text-primary hover:underline">
                  Xem tất cả →
                </Link>
              </div>
              <div className="grid gap-2.5 grid-cols-2">
                <ToolTile icon={Film} label="Tải video" gradient="from-violet-500 to-fuchsia-500" />
                <ToolTile icon={FileText} label="TTS" gradient="from-fuchsia-500 to-pink-500" />
                <ToolTile icon={Repeat} label="Phụ đề" gradient="from-pink-500 to-orange-500" />
                <ToolTile icon={Mic2} label="Lồng tiếng" gradient="from-emerald-500 to-teal-500" />
              </div>
            </div>

            {/* RECENT PROJECTS — 7 col */}
            <div className="lg:col-span-7 rounded-2xl border border-border/60 bg-card/40 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Dự án gần đây</h3>
                <Link href="#" className="text-xs text-primary hover:underline">
                  Xem tất cả →
                </Link>
              </div>
              <div className="space-y-2.5">
                <ProjectRow
                  icon={Play}
                  iconBg="from-violet-500/30 to-fuchsia-500/20"
                  title="Video giới thiệu sản phẩm"
                  subtitle="Lồng tiếng video"
                  meta="2 giờ trước"
                  status="done"
                />
                <ProjectRow
                  icon={Play}
                  iconBg="from-fuchsia-500/30 to-pink-500/20"
                  title="Bài thuyết trình công ty"
                  subtitle="Chuyển đổi phụ đề"
                  meta="1 ngày trước"
                  status="processing"
                />
                <ProjectRow
                  icon={Play}
                  iconBg="from-emerald-500/30 to-teal-500/20"
                  title="Podcast tập 15"
                  subtitle="Văn bản thành giọng nói"
                  meta="2 ngày trước"
                  status="done"
                />
              </div>
            </div>

            {/* USAGE THIS MONTH — 5 col */}
            <div className="lg:col-span-5 rounded-2xl border border-border/60 bg-card/40 p-5">
              <h3 className="mb-4 text-sm font-semibold">Sử dụng tháng này</h3>
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight">{usageMonthly.used}</span>
                <span className="text-sm text-muted-foreground">/ {usageMonthly.total} credits</span>
                <span className="ml-auto text-xs font-semibold text-primary">
                  {Math.round((usageMonthly.used / usageMonthly.total) * 100)}%
                </span>
              </div>
              {/* Stacked bar */}
              <div className="mb-4 h-2 overflow-hidden rounded-full bg-muted/40 flex">
                {usageMonthly.breakdown.map((item, i) => (
                  <div
                    key={i}
                    className={`h-full ${item.color} transition-all`}
                    style={{ width: `${(item.value / usageMonthly.total) * 100}%` }}
                  />
                ))}
              </div>
              {/* Breakdown legend */}
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
                <Link
                  href="/pricing"
                  className="font-semibold text-primary hover:underline"
                >
                  Nạp thêm →
                </Link>
              </div>
            </div>

            {/* INFO STRIP — 3 cards full width */}
            <div className="lg:col-span-12 grid gap-3 sm:grid-cols-3">
              <InfoCard icon={Zap} title="Tốc độ cao" desc="Render trên GPU mạnh, kết quả chỉ vài giây" />
              <InfoCard icon={CheckCircle2} title="Chất lượng cao" desc="Studio-grade audio, hỗ trợ xuất 4K" />
              <InfoCard icon={Sparkles} title="Bảo mật" desc="An toàn tuyệt đối, không chia sẻ dữ liệu" />
            </div>

            {/* RECENT PAYMENTS — 12 col */}
            {payments && payments.length > 0 && (
              <div className="lg:col-span-12 rounded-2xl border border-border/60 bg-card/40 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{t("paymentsTitle")}</h3>
                  <span className="text-xs text-muted-foreground">
                    {paidPayments.length} đã thanh toán · {pendingPayments.length} đang chờ
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/40 text-xs uppercase tracking-wider text-muted-foreground">
                        <th className="pb-2 text-left font-medium">{t("billing.refCode") || "Mã"}</th>
                        <th className="pb-2 text-left font-medium">{t("billing.plan") || "Gói"}</th>
                        <th className="pb-2 text-right font-medium">{t("billing.amount") || "Số tiền"}</th>
                        <th className="pb-2 text-left font-medium">{t("billing.status") || "Trạng thái"}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {payments.slice(0, 5).map((p) => (
                        <tr key={p.ref_code} className="border-b border-border/20 last:border-0">
                          <td className="py-3 font-mono text-xs">{p.ref_code}</td>
                          <td className="py-3 capitalize text-sm">
                            {p.plan_id}
                            {p.is_ltd && (
                              <span className="ml-1 rounded bg-primary/15 px-1 py-0.5 text-[10px] font-bold text-primary">
                                LTD
                              </span>
                            )}
                          </td>
                          <td className="py-3 text-right font-mono text-sm">
                            {p.amount_vnd.toLocaleString("vi-VN")}đ
                          </td>
                          <td className="py-3">
                            <StatusPill status={p.status} t={t} />
                          </td>
                          <td className="py-3 text-right">
                            {p.status === "pending" && (
                              <Link
                                href={`/checkout/${p.plan_id}?ref=${p.ref_code}`}
                                className="text-xs font-semibold text-primary hover:underline"
                              >
                                {t("viewQr")}
                              </Link>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Stats footer */}
          <div className="mt-8 grid grid-cols-2 gap-4 border-t border-border/30 pt-6 sm:grid-cols-4">
            <FooterStat icon={Users} value="10K+" label="Người dùng tin tưởng" />
            <FooterStat icon={Film} value="1M+" label="Video đã xử lý" />
            <FooterStat icon={CheckCircle2} value="99.9%" label="Thời gian hoạt động" />
            <FooterStat icon={HelpCircle} value="24/7" label="Hỗ trợ khách hàng" />
          </div>
        </main>
      </div>
    </div>
  );
}

// ── HELPERS ────────────────────────────────────────────────────────────
function NavSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70">
        {title}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function NavLink({
  icon: Icon,
  label,
  active = false,
  badge,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  badge?: string;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
        active
          ? "bg-primary/10 text-primary border border-primary/20"
          : "border border-transparent text-foreground/80 hover:bg-muted/40 hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {badge && (
        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary">
          {badge}
        </span>
      )}
    </button>
  );
}

function IconButton({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return (
    <button className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/40 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">
      <Icon className="h-4 w-4" />
    </button>
  );
}

function ToolTile({
  icon: Icon,
  label,
  gradient,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  gradient: string;
}) {
  return (
    <Link
      href="/#features"
      className="group flex flex-col items-center gap-2 rounded-xl border border-border/40 bg-background/40 p-3 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
    >
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} shadow-md`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <span className="text-xs font-medium text-center">{label}</span>
    </Link>
  );
}

function ProjectRow({
  icon: Icon,
  iconBg,
  title,
  subtitle,
  meta,
  status,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  title: string;
  subtitle: string;
  meta: string;
  status: "done" | "processing";
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-background/30 p-3 transition-colors hover:bg-background/60">
      <div className={`flex h-10 w-14 items-center justify-center rounded-lg bg-gradient-to-br ${iconBg} shrink-0`}>
        <Icon className="h-4 w-4 text-white fill-current" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs text-muted-foreground">{meta}</div>
        <div className="mt-1">
          {status === "done" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-500">
              <CheckCircle2 className="h-2.5 w-2.5" />
              Hoàn thành
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 border border-yellow-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-500">
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

function StatusPill({ status, t }: { status: string; t: ReturnType<typeof useTranslations> }) {
  const map: Record<string, { class: string; label: string }> = {
    pending: {
      class: "border-yellow-500/30 bg-yellow-500/10 text-yellow-500",
      label: t("statusPending"),
    },
    paid: {
      class: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
      label: t("statusPaid"),
    },
    cancelled: {
      class: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400 line-through",
      label: t("statusCancelled"),
    },
  };
  const cfg = map[status] || map.cancelled;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cfg.class}`}>
      {cfg.label}
    </span>
  );
}

function FooterStat({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/40 bg-card/30">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <div className="text-base font-bold tracking-tight">{value}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
