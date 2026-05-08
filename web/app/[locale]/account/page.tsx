"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
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
  ChevronRight,
  PanelLeft,
  Bell,
  Sun,
  Moon,
  Plus,
  ShoppingCart,
  Activity,
  CheckCircle2,
  TrendingUp,
  Clock,
  Mail,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth-context";
import { listMyPayments, type Payment } from "@/lib/api";

type Tab = "overview" | "profile" | "wallet";

export default function AccountPage() {
  const t = useTranslations("account");
  const tAuth = useTranslations("auth");
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [voiceOpen, setVoiceOpen] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem("voxstudio:theme") as "dark" | "light" | null) || "dark";
  });

  // Theme: toggle `dark` class on <html>
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

  // Stats from payments
  const paidPayments = payments?.filter((p) => p.status === "paid") || [];
  const pendingPayments = payments?.filter((p) => p.status === "pending") || [];
  const totalSpentVnd = paidPayments.reduce((s, p) => s + p.amount_vnd, 0);

  return (
    <div className="flex min-h-screen bg-background">
      {/* SIDEBAR */}
      {sidebarOpen && (
        <aside className="hidden w-64 shrink-0 border-r border-border/40 bg-card/30 lg:flex lg:flex-col">
          {/* Logo */}
          <div className="flex h-14 items-center gap-2 border-b border-border/40 px-4">
            <Link href="/" className="inline-flex items-center gap-2">
              <Image
                src="/logo.png"
                alt="VoxStudio"
                width={24}
                height={24}
                className="h-6 w-6 rounded"
              />
              <span className="text-sm font-bold">VoxStudio</span>
            </Link>
          </div>

          {/* User card */}
          <button className="mx-3 mt-3 flex items-center gap-2.5 rounded-lg border border-border/60 bg-card/40 px-3 py-2.5 text-left transition-colors hover:bg-muted/40">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-foreground text-xs font-bold text-background">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {displayName}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {isPaid ? planName : t("memberLabel")}
              </div>
            </div>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>

          {/* Sections */}
          <div className="mt-4 flex-1 space-y-5 overflow-y-auto px-3 pb-6">
            <NavSection title={t("nav.overviewSection")}>
              <NavItem
                icon={LayoutDashboard}
                label={t("nav.dashboard")}
                active={activeTab === "overview"}
                onClick={() => setActiveTab("overview")}
              />
              <NavItem
                icon={Wallet}
                label={t("nav.topup")}
                onClick={() => setActiveTab("wallet")}
              />
              <NavItem icon={Zap} label={t("nav.credits")} />
              <NavItem icon={Users} label={t("nav.affiliate")} />
              <NavItem icon={BookOpen} label={t("nav.guide")} />
            </NavSection>

            <NavSection title={t("nav.studioSection")}>
              <button
                onClick={() => setVoiceOpen(!voiceOpen)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-foreground/90 transition-colors hover:bg-muted/40"
              >
                <span className="inline-flex items-center gap-2.5">
                  <Mic2 className="h-4 w-4" />
                  {t("nav.voiceProcessing")}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${voiceOpen ? "" : "-rotate-90"}`}
                />
              </button>
              {voiceOpen && (
                <div className="ml-4 flex flex-col gap-0.5 border-l border-border/40 pl-3">
                  <SubNavItem icon={FileText} label={t("nav.tts")} />
                  <SubNavItem icon={Wand2} label={t("nav.cloning")} />
                  <SubNavItem icon={Film} label={t("nav.dubbing")} />
                  <SubNavItem icon={Mic2} label={t("nav.stt")} />
                  <SubNavItem icon={Repeat} label={t("nav.voiceChange")} />
                  <SubNavItem icon={Music2} label={t("nav.voiceSplit")} />
                </div>
              )}

              <NavItem icon={Music2} label={t("nav.audioMusic")} disabled />
              <NavItem icon={ImageIcon} label={t("nav.imageGen")} disabled />
            </NavSection>
          </div>

          {/* Logout */}
          <div className="border-t border-border/40 p-3">
            <button
              onClick={() => {
                logout();
                router.replace("/");
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              {tAuth("logoutCta")}
            </button>
          </div>
        </aside>
      )}

      {/* MAIN */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* TOP BAR */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/40 bg-background/85 px-4 backdrop-blur-sm sm:px-6">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/40 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground lg:flex"
              aria-label="Toggle sidebar"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
            <button
              className="hidden h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/40 text-base sm:flex"
              aria-label="Vietnamese"
            >
              🇻🇳
            </button>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/40 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <Moon className="h-4 w-4" />
              ) : (
                <Sun className="h-4 w-4" />
              )}
            </button>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/40 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card/40 px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-muted/40"
              title={t("topupCta")}
            >
              <Zap className="h-3.5 w-3.5" />
              {(user.credit_balance || 0).toLocaleString("vi-VN")}
            </Link>
          </div>
        </header>

        {/* Verify banner */}
        {!user.email_verified && (
          <div className="flex items-start gap-3 border-b border-border/60 bg-muted/30 px-4 py-3 sm:px-6">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-foreground" />
            <div className="flex-1 text-sm">
              {t("verifyBanner")}{" "}
              <Link
                href="/verify"
                className="font-semibold text-foreground underline underline-offset-2"
              >
                {t("verifyAction")}
              </Link>
            </div>
          </div>
        )}

        {/* TAB STRIP */}
        <div className="border-b border-border/40 px-4 sm:px-6">
          <div className="flex gap-1 sm:gap-2">
            <TabButton
              active={activeTab === "overview"}
              onClick={() => setActiveTab("overview")}
              icon={LayoutDashboard}
              label={t("tab.overview")}
            />
            <TabButton
              active={activeTab === "profile"}
              onClick={() => setActiveTab("profile")}
              icon={Mic2}
              label={t("tab.profile")}
            />
            <TabButton
              active={activeTab === "wallet"}
              onClick={() => setActiveTab("wallet")}
              icon={Wallet}
              label={t("tab.wallet")}
            />
          </div>
        </div>

        {/* CONTENT */}
        <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <div className="mx-auto max-w-6xl space-y-5">
            {activeTab === "overview" && (
              <OverviewTab
                user={user}
                planName={planName}
                isPaid={isPaid}
                payments={payments}
                paidCount={paidPayments.length}
                pendingCount={pendingPayments.length}
                totalSpent={totalSpentVnd}
                t={t}
              />
            )}
            {activeTab === "profile" && (
              <ProfileTab
                user={user}
                planName={planName}
                isPaid={isPaid}
                t={t}
              />
            )}
            {activeTab === "wallet" && (
              <WalletTab
                user={user}
                payments={payments}
                loading={loading}
                t={t}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// ── Sidebar helpers ─────────────────────────────────────────────────────
function NavSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active = false,
  onClick,
  disabled = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-foreground/10 text-foreground"
          : disabled
            ? "text-muted-foreground/40 cursor-not-allowed"
            : "text-foreground/80 hover:bg-muted/40 hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

function SubNavItem({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">
      <Icon className="h-3.5 w-3.5" />
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
      {active && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-foreground" />
      )}
    </button>
  );
}

// ── OVERVIEW TAB — premium dashboard layout ───────────────────────────
function OverviewTab({
  user,
  planName,
  isPaid,
  paidCount,
  pendingCount,
  totalSpent,
  t,
}: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  planName: string;
  isPaid: boolean;
  payments: Payment[] | null;
  paidCount: number;
  pendingCount: number;
  totalSpent: number;
  t: ReturnType<typeof useTranslations>;
}) {
  const displayName = user.name || user.email.split("@")[0];
  const credits = user.credit_balance || 0;
  // Mock usage state — sẽ wire vào API sau
  const ttsUsed = 0;
  const ttsTotal = 1_000_000;
  const dubUsed = 0;
  const dubTotal = 30;
  const ttsPct = Math.min(100, (ttsUsed / Math.max(1, ttsTotal)) * 100);
  const dubPct = Math.min(100, (dubUsed / Math.max(1, dubTotal)) * 100);

  return (
    <div className="space-y-8">
      {/* HERO — greeting với subtle gradient */}
      <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-card/60 via-card/40 to-card/20 p-6 sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/[0.08] blur-3xl"
        />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">
              {t("overview.welcomeBack")}
            </p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {displayName}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-2.5 py-1 text-xs">
                {isPaid && <Crown className="h-3 w-3 text-primary" />}
                <span className="font-semibold">{planName}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-2.5 py-1 text-xs">
                <Mail className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">{user.email}</span>
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border/60 bg-background/40 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-muted/40"
            >
              <Zap className="h-3.5 w-3.5 text-primary" />
              {credits.toLocaleString("vi-VN")} credits
            </Link>
            {!isPaid && (
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t("upgrade")}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* QUICK TOOLS — 4 cards với gradient icon */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            {t("overview.quickActions")}
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ToolCard
            icon={FileText}
            label={t("nav.tts")}
            desc={t("descTts")}
            href="/#features"
            gradient="from-violet-500/20 to-fuchsia-500/10"
            iconClass="text-violet-400"
          />
          <ToolCard
            icon={Film}
            label={t("nav.dubbing")}
            desc={t("descDubbing")}
            href="/#features"
            gradient="from-fuchsia-500/20 to-pink-500/10"
            iconClass="text-fuchsia-400"
          />
          <ToolCard
            icon={Wand2}
            label={t("nav.cloning")}
            desc={t("descCloning")}
            href="/#features"
            gradient="from-pink-500/20 to-orange-500/10"
            iconClass="text-pink-400"
          />
          <ToolCard
            icon={Activity}
            label={t("ctaNewOrder")}
            desc={t("overview.startNewProject")}
            href="/#features"
            gradient="from-emerald-500/20 to-teal-500/10"
            iconClass="text-emerald-400"
          />
        </div>
      </section>

      {/* TWO-COL: Usage (left 2/3) + Plan/Activity (right 1/3) */}
      <section className="grid gap-5 lg:grid-cols-3">
        {/* USAGE — 2 cols */}
        <div className="lg:col-span-2 rounded-2xl border border-border/60 bg-card/40 p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold">{t("overview.usageTitle")}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("overview.usageSubtitle")}
              </p>
            </div>
            <Link
              href="/pricing"
              className="text-xs font-semibold text-primary hover:underline underline-offset-2"
            >
              {t("overview.upgradeForMore")} →
            </Link>
          </div>

          <div className="space-y-5">
            <UsageMeter
              icon={FileText}
              label={t("usage.tts")}
              used={ttsUsed}
              total={ttsTotal}
              unit={t("usage.unitChars")}
              pct={ttsPct}
            />
            <UsageMeter
              icon={Film}
              label={t("usage.dubbing")}
              used={dubUsed}
              total={dubTotal}
              unit={t("usage.unitMinutes")}
              pct={dubPct}
            />
          </div>

          {/* Stats inline */}
          <div className="mt-6 grid grid-cols-3 gap-3 border-t border-border/30 pt-5">
            <MiniStat label={t("statCompleted")} value={paidCount} icon={CheckCircle2} />
            <MiniStat label={t("statPending")} value={pendingCount} icon={Clock} />
            <MiniStat
              label={t("statSpent")}
              value={totalSpent === 0 ? "—" : `${(totalSpent / 1_000).toFixed(0)}k`}
              icon={TrendingUp}
            />
          </div>
        </div>

        {/* RIGHT: Plan card + recent activity */}
        <div className="space-y-5">
          {/* Plan card với glow */}
          <div
            className={`relative overflow-hidden rounded-2xl border p-5 ${
              isPaid
                ? "border-primary/30 bg-gradient-to-br from-primary/[0.08] via-card/40 to-card/20"
                : "border-border/60 bg-card/40"
            }`}
          >
            {isPaid && (
              <div
                aria-hidden
                className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/20 blur-3xl"
              />
            )}
            <div className="relative">
              <div className="mb-3 flex items-center gap-1.5">
                {isPaid && <Crown className="h-3.5 w-3.5 text-primary" />}
                <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  {t("planTitle")}
                </span>
              </div>
              <div className="text-2xl font-bold tracking-tight">{planName}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {!isPaid ? t("planFree") : t("planLifetime")}
              </p>
              <Link
                href="/pricing"
                className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs font-semibold transition-colors hover:bg-muted/40"
              >
                {isPaid ? t("changePlan") : t("upgrade")}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>

          {/* Recent activity */}
          <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              {t("recentActivity")}
            </h3>
            <div className="rounded-lg border border-dashed border-border/40 p-5 text-center">
              <Activity className="mx-auto h-6 w-6 text-muted-foreground/30" />
              <p className="mt-2 text-xs text-muted-foreground">
                {t("recentEmpty")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST FOOTER — inline stats */}
      <section className="rounded-2xl border border-border/40 bg-card/20 p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <TrustStat icon={Sparkles} label="10K+" sub={t("overview.trustUsers")} />
          <TrustStat icon={Film} label="1M+" sub={t("overview.trustVideos")} />
          <TrustStat icon={Activity} label="99.9%" sub={t("overview.trustUptime")} />
          <TrustStat icon={ShieldCheck} label="24/7" sub={t("overview.trustSupport")} />
        </div>
      </section>
    </div>
  );
}

// Tool card — premium gradient hover
function ToolCard({
  icon: Icon,
  label,
  desc,
  href,
  gradient,
  iconClass,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  desc: string;
  href: string;
  gradient: string;
  iconClass: string;
}) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card/40 p-5 transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10"
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 transition-opacity group-hover:opacity-100`}
      />
      <div className="relative">
        <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} ${iconClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="text-sm font-semibold tracking-tight">{label}</h3>
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{desc}</p>
        <ArrowRight className="absolute right-0 top-0 h-3.5 w-3.5 text-muted-foreground transition-all group-hover:translate-x-1 group-hover:text-foreground" />
      </div>
    </Link>
  );
}

// Usage meter — gradient progress bar
function UsageMeter({
  icon: Icon,
  label,
  used,
  total,
  unit,
  pct,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  used: number;
  total: number;
  unit: string;
  pct: number;
}) {
  const isUnlimited = total === -1;
  const barColor = pct > 90
    ? "from-red-500 to-orange-500"
    : pct > 70
      ? "from-yellow-500 to-orange-500"
      : "from-primary to-fuchsia-500";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">
            {used.toLocaleString("vi-VN")}
          </span>
          {" / "}
          {isUnlimited ? "∞" : total.toLocaleString("vi-VN")} {unit}
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted/40">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// Mini stat — for inline rows
function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/40 bg-background/40">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold tracking-tight truncate">{value}</div>
      </div>
    </div>
  );
}

// Trust stat — bottom footer
function TrustStat({
  icon: Icon,
  label,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-primary" />
      <div>
        <div className="text-base font-bold tracking-tight">{label}</div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </div>
    </div>
  );
}

// ── PROFILE TAB ────────────────────────────────────────────────────────
function ProfileTab({
  user,
  planName,
  isPaid,
  t,
}: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  planName: string;
  isPaid: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("profile.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("profile.subtitle")}
        </p>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
        <div className="space-y-4">
          <ProfileField label={t("profile.fieldName")} value={user.name || t("profile.noName")} />
          <ProfileField
            label={t("profile.fieldEmail")}
            value={user.email}
            badge={user.email_verified ? t("verified") : t("notVerified")}
            badgeOk={user.email_verified}
          />
          <ProfileField label={t("profile.fieldPlan")} value={isPaid ? planName : t("memberLabel")} />
          <ProfileField
            label={t("profile.fieldExpires")}
            value={
              !isPaid
                ? "—"
                : user.plan_expires_at
                  ? new Date(user.plan_expires_at).toLocaleDateString("vi-VN")
                  : t("planLifetime")
            }
          />
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
        <h3 className="text-sm font-semibold mb-1">{t("profile.editTitle")}</h3>
        <p className="text-sm text-muted-foreground mb-3">{t("profile.editDesc")}</p>
        <Link
          href="/contact"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground underline underline-offset-2 hover:opacity-70"
        >
          {t("profile.editCta")}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

// ── WALLET TAB ────────────────────────────────────────────────────────
function WalletTab({
  user,
  payments,
  loading,
  t,
}: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  payments: Payment[] | null;
  loading: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const credits = user.credit_balance || 0;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("billing.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("billing.subtitle")}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <BalanceCard
          label={t("creditsLabel")}
          value={credits.toLocaleString("vi-VN")}
          big
          icon={Zap}
        />
        <BalanceCard
          label="Phút TTS tương đương"
          value={`~${Math.floor(credits / 800).toLocaleString("vi-VN")} phút`}
          big
        />
        <Link
          href="/pricing"
          className="group flex items-center justify-between rounded-2xl border border-foreground/40 bg-foreground p-5 text-background transition-all hover:opacity-90"
        >
          <div>
            <div className="text-xs uppercase tracking-wider opacity-60 mb-1">
              {t("topupShort")}
            </div>
            <div className="text-base font-semibold">{t("topupCta")}</div>
          </div>
          <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      {/* Payment table */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t("paymentsTitle")}
        </h3>
        {loading ? (
          <div className="rounded-2xl border border-border/60 bg-card/40 p-10 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline-block h-4 w-4 animate-spin" />
            {t("billing.loading")}
          </div>
        ) : !payments || payments.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card/40 p-10 text-center">
            <Wallet className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">{t("noPayments")}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/40">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20 text-xs uppercase text-muted-foreground">
                  <th className="p-3 text-left font-medium">{t("billing.refCode")}</th>
                  <th className="p-3 text-left font-medium">{t("billing.plan")}</th>
                  <th className="p-3 text-right font-medium">{t("billing.amount")}</th>
                  <th className="p-3 text-left font-medium">{t("billing.status")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr
                    key={p.ref_code}
                    className="border-b border-border/30 last:border-0 hover:bg-muted/10"
                  >
                    <td className="p-3 font-mono text-xs">{p.ref_code}</td>
                    <td className="p-3 capitalize">
                      {p.plan_id}
                      {p.is_ltd && (
                        <span className="ml-1 rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-bold text-purple-400">
                          LTD
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right font-mono">
                      {p.amount_vnd.toLocaleString("vi-VN")}đ
                    </td>
                    <td className="p-3">
                      <StatusPill status={p.status} t={t} />
                    </td>
                    <td className="p-3 text-right">
                      {p.status === "pending" && (
                        <Link
                          href={`/checkout/${p.plan_id}?ref=${p.ref_code}`}
                          className="text-xs font-semibold text-foreground underline underline-offset-2 hover:opacity-70"
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
        )}
      </div>
    </div>
  );
}

// ── Small components ───────────────────────────────────────────────────
function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-2.5 py-1 text-xs">
      {children}
    </span>
  );
}

function BalanceCard({
  label,
  value,
  big = false,
  icon: Icon,
}: {
  label: string;
  value: string;
  big?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div
      className={`rounded-xl border border-border/60 bg-card/60 ${big ? "p-5" : "px-5 py-3"}`}
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <div className={`mt-1 font-bold ${big ? "text-2xl" : "text-lg"}`}>
        {value}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-border/60 bg-muted/30">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  href,
  primary = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-center gap-2 rounded-xl border px-5 py-4 text-sm font-semibold transition-all ${
        primary
          ? "border-foreground bg-foreground text-background hover:opacity-90"
          : "border-border/60 bg-card/40 hover:bg-muted/40"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function ServiceRow({
  icon: Icon,
  label,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  desc: string;
}) {
  return (
    <button className="group flex w-full items-center gap-3 rounded-lg border border-border/40 bg-card/30 p-3 text-left transition-all hover:border-foreground/40 hover:bg-muted/40">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/20">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{label}</div>
        <div className="truncate text-xs text-muted-foreground">{desc}</div>
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

function ProfileField({
  label,
  value,
  badge,
  badgeOk,
}: {
  label: string;
  value: string;
  badge?: string;
  badgeOk?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/30 pb-3 last:border-b-0 last:pb-0">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="mt-0.5 text-sm font-medium">{value}</div>
      </div>
      {badge && (
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
            badgeOk
              ? "border-foreground/30 bg-foreground/10 text-foreground"
              : "border-foreground/30 bg-foreground/5 text-muted-foreground"
          }`}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

function StatusPill({
  status,
  t,
}: {
  status: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const map: Record<string, string> = {
    pending: "border-foreground/30 bg-foreground/5 text-muted-foreground",
    paid: "border-foreground/40 bg-foreground/15 text-foreground",
    cancelled: "border-border/40 bg-card/40 text-muted-foreground line-through",
  };
  const label =
    status === "paid"
      ? t("statusPaid")
      : status === "pending"
        ? t("statusPending")
        : t("statusCancelled");
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${map[status] || ""}`}
    >
      {label}
    </span>
  );
}
