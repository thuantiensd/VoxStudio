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
  ArrowUpRight,
  LayoutDashboard,
  CreditCard,
  Activity,
  Settings as SettingsIcon,
  Sun,
  Moon,
  Sparkles,
  Mail,
  Calendar,
  CheckCircle2,
  Clock,
  Film,
  Mic2,
  Wand2,
  ShieldCheck,
  ExternalLink,
  TrendingUp,
  Zap,
  Languages,
  HelpCircle,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listMyPayments, type Payment } from "@/lib/api";
import { PLAN_CATALOG, type PlanId } from "@/lib/plans";

type Tab = "overview" | "subscription" | "usage" | "billing" | "settings";

const STATUS_CLASS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-500 border-yellow-500/30",
  paid: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  cancelled: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30 line-through",
};

export default function AccountPage() {
  const t = useTranslations("account");
  const tAuth = useTranslations("auth");
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  // Theme persistence
  useEffect(() => {
    const saved = localStorage.getItem("voxstudio:theme") as "dark" | "light" | null;
    if (saved) setTheme(saved);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("voxstudio:theme", theme);
  }, [theme]);

  // Auth + load payments
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

  const planId = user.plan as PlanId;
  const plan = PLAN_CATALOG[planId] ?? PLAN_CATALOG.free;
  const isPaid = planId !== "free";
  const initial = (user.name || user.email)[0].toUpperCase();
  const displayName = user.name || user.email.split("@")[0];

  const paidPayments = payments?.filter((p) => p.status === "paid") || [];
  const pendingPayments = payments?.filter((p) => p.status === "pending") || [];

  const navItems: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
    { id: "overview", label: t("nav.overview"), icon: LayoutDashboard },
    { id: "subscription", label: t("nav.subscription"), icon: Crown },
    { id: "usage", label: t("nav.usage"), icon: Activity },
    { id: "billing", label: t("nav.billing"), icon: CreditCard },
    { id: "settings", label: t("nav.settings"), icon: SettingsIcon },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* TOP BAR — minimal premium */}
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="inline-flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="VoxStudio"
              width={28}
              height={28}
              className="h-7 w-7 rounded-md"
            />
            <span className="text-sm font-bold tracking-tight">VoxStudio</span>
          </Link>

          <div className="flex items-center gap-2">
            {/* Credits chip */}
            <Link
              href="/pricing"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card/40 px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-muted/40"
              title={t("topupCta")}
            >
              <Film className="h-3.5 w-3.5 text-primary" />
              {t("dubMinutesShort", { mins: 0 })}
            </Link>
            {/* Theme toggle */}
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card/40 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
            <Link
              href="/pricing"
              className="hidden sm:inline-flex h-8 items-center gap-1 rounded-md border border-border/60 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              {t("nav.pricing")}
            </Link>
            {/* User menu */}
            <button
              onClick={() => {
                logout();
                router.replace("/");
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-card/40 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{tAuth("logoutCta")}</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-8 px-4 py-8 sm:px-6">
        {/* SIDEBAR — desktop only */}
        <aside className="sticky top-20 hidden h-fit w-60 shrink-0 lg:block">
          <UserCard
            initial={initial}
            name={displayName}
            email={user.email}
            planName={plan.name}
            isPaid={isPaid}
          />

          <nav className="mt-5 flex flex-col gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                    isActive
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "border border-transparent text-foreground/70 hover:bg-muted/40 hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* MAIN */}
        <main className="flex-1 min-w-0">
          {/* Mobile tabs */}
          <div className="lg:hidden mb-5 -mx-4 overflow-x-auto px-4">
            <div className="inline-flex gap-1 rounded-lg border border-border/60 bg-card/40 p-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      isActive ? "bg-primary/15 text-primary" : "text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Verify banner */}
          {!user.email_verified && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/[0.05] p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-500" />
              <div className="flex-1 text-sm">
                {t("verifyBanner")}{" "}
                <Link
                  href="/verify"
                  className="font-semibold text-primary hover:underline underline-offset-2"
                >
                  {t("verifyAction")}
                </Link>
              </div>
            </div>
          )}

          {activeTab === "overview" && (
            <OverviewTab
              user={user}
              plan={plan}
              isPaid={isPaid}
              displayName={displayName}
              paidCount={paidPayments.length}
              pendingCount={pendingPayments.length}
              t={t}
            />
          )}
          {activeTab === "subscription" && (
            <SubscriptionTab user={user} plan={plan} isPaid={isPaid} t={t} />
          )}
          {activeTab === "usage" && <UsageTab user={user} plan={plan} t={t} />}
          {activeTab === "billing" && (
            <BillingTab payments={payments} loading={loading} t={t} />
          )}
          {activeTab === "settings" && (
            <SettingsTab
              user={user}
              theme={theme}
              setTheme={setTheme}
              t={t}
            />
          )}
        </main>
      </div>
    </div>
  );
}

// ── USER CARD (sidebar) ─────────────────────────────────────────────────
function UserCard({
  initial,
  name,
  email,
  planName,
  isPaid,
}: {
  initial: string;
  name: string;
  email: string;
  planName: string;
  isPaid: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-fuchsia-500 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/30">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-tight">{name}</div>
          <div className="truncate text-[11px] text-muted-foreground">{email}</div>
        </div>
      </div>
      <div
        className={`mt-3 flex items-center justify-between gap-2 rounded-lg px-3 py-2 ${
          isPaid
            ? "border border-primary/30 bg-gradient-to-br from-primary/10 to-fuchsia-500/[0.05]"
            : "border border-border/60 bg-muted/20"
        }`}
      >
        <div className="flex items-center gap-1.5 text-xs">
          {isPaid && <Crown className="h-3.5 w-3.5 text-primary" />}
          <span className="font-bold">{planName}</span>
        </div>
        {!isPaid && (
          <Link
            href="/pricing"
            className="text-[10px] font-bold uppercase tracking-wider text-primary hover:underline"
          >
            UPGRADE
          </Link>
        )}
      </div>
    </div>
  );
}

// ── OVERVIEW TAB ───────────────────────────────────────────────────────
function OverviewTab({
  user,
  plan,
  isPaid,
  displayName,
  paidCount,
  pendingCount,
  t,
}: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  plan: typeof PLAN_CATALOG[PlanId];
  isPaid: boolean;
  displayName: string;
  paidCount: number;
  pendingCount: number;
  t: ReturnType<typeof useTranslations>;
}) {
  const expiresLabel = !isPaid
    ? t("overview.noExpiry")
    : user.plan_expires_at
      ? new Date(user.plan_expires_at).toLocaleDateString("vi-VN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : t("planLifetime");

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {t("overview.title", { name: displayName })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("overview.subtitle")}</p>
      </div>

      {/* 3 stat cards — premium feel */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={Crown}
          accent={isPaid ? "primary" : undefined}
          label={t("planTitle")}
          value={plan.name}
          sub={isPaid ? expiresLabel : t("planFree")}
        />
        <StatCard
          icon={Film}
          label={t("overview.dubBalance")}
          value={t("overview.dubMinutes", { mins: 0 })}
          sub={t("overview.topupHint")}
        />
        <StatCard
          icon={CheckCircle2}
          label={t("overview.completedJobs")}
          value={paidCount.toString()}
          sub={pendingCount > 0 ? t("overview.pendingJobs", { count: pendingCount }) : undefined}
        />
      </div>

      {/* CTA — only for free users */}
      {!isPaid && (
        <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.12] via-card/40 to-card/20 p-6 sm:p-7">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-primary/30 blur-3xl"
          />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Sparkles className="h-6 w-6 text-primary mb-3" />
              <h2 className="text-xl font-semibold sm:text-2xl">{t("overview.ctaTitle")}</h2>
              <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
                {t("overview.ctaDesc")}
              </p>
            </div>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105"
            >
              {t("upgrade")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          {t("overview.quickActions")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionTile icon={Mic2} label={t("overview.actionTts")} href="/#features" />
          <ActionTile icon={Film} label={t("overview.actionDub")} href="/#features" />
          <ActionTile icon={Wand2} label={t("overview.actionClone")} href="/#features" />
          <ActionTile icon={Languages} label={t("overview.actionLanguages")} href="/#features" />
        </div>
      </div>
    </div>
  );
}

// ── SUBSCRIPTION TAB ───────────────────────────────────────────────────
function SubscriptionTab({
  user,
  plan,
  isPaid,
  t,
}: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  plan: typeof PLAN_CATALOG[PlanId];
  isPaid: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const expiresAt = user.plan_expires_at ? new Date(user.plan_expires_at) : null;
  const daysLeft = expiresAt
    ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000))
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("subscription.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subscription.subtitle")}</p>
      </div>

      {/* Current plan card */}
      <div
        className={`relative overflow-hidden rounded-2xl border p-6 sm:p-8 ${
          isPaid
            ? "border-primary/40 bg-gradient-to-br from-primary/[0.08] via-card/40 to-card/20 ring-1 ring-primary/10"
            : "border-border/60 bg-card/40"
        }`}
      >
        {isPaid && (
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/20 blur-3xl"
          />
        )}
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-primary">
              {isPaid && <Crown className="h-3.5 w-3.5" />}
              {t("subscription.currentPlan")}
            </div>
            <div className="text-3xl font-bold tracking-tight sm:text-4xl">{plan.name}</div>
            <div className="mt-2 text-sm text-muted-foreground">
              {!isPaid
                ? t("planFree")
                : !expiresAt
                  ? t("planLifetime")
                  : t("subscription.renews", {
                      date: expiresAt.toLocaleDateString("vi-VN"),
                      days: daysLeft || 0,
                    })}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
            >
              {isPaid ? t("subscription.changePlan") : t("upgrade")}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
            {isPaid && (
              <Link
                href="/contact"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("subscription.contactSales")}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Feature highlights */}
      <div>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          {t("subscription.includedFeatures")}
        </h2>
        <div className="rounded-2xl border border-border/60 bg-card/40 p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <FeatureLine
              icon={Mic2}
              label={t("subscription.featTts", {
                amount: plan.limits.ttsCharsMonth.toLocaleString("vi-VN"),
              })}
            />
            <FeatureLine
              icon={Film}
              label={t("subscription.featDub", {
                mins: plan.limits.dubbingMinMonth,
              })}
            />
            <FeatureLine
              icon={Wand2}
              label={t("subscription.featClones", {
                count:
                  plan.limits.voiceCloneMax === -1
                    ? t("unlimited")
                    : plan.limits.voiceCloneMax.toString(),
              })}
            />
            <FeatureLine
              icon={ShieldCheck}
              label={
                plan.features.watermarkFree ? t("subscription.featNoWatermark") : t("subscription.featWatermark")
              }
              dim={!plan.features.watermarkFree}
            />
            <FeatureLine
              icon={TrendingUp}
              label={
                plan.features.export4k
                  ? t("subscription.feat4k")
                  : plan.features.export1080p
                    ? t("subscription.feat1080p")
                    : t("subscription.feat720p")
              }
            />
            <FeatureLine
              icon={Zap}
              label={
                plan.features.priorityQueue
                  ? t("subscription.featPriorityGpu")
                  : t("subscription.featSlowQueue")
              }
              dim={!plan.features.priorityQueue}
            />
            {plan.features.api && (
              <FeatureLine icon={ExternalLink} label={t("subscription.featApi")} />
            )}
            {plan.features.commercialUse && (
              <FeatureLine icon={CheckCircle2} label={t("subscription.featCommercial")} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── USAGE TAB ──────────────────────────────────────────────────────────
function UsageTab({
  user,
  plan,
  t,
}: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  plan: typeof PLAN_CATALOG[PlanId];
  t: ReturnType<typeof useTranslations>;
}) {
  // Placeholder usage data — real data sẽ fetch từ API trong tương lai
  const ttsUsed = 0;
  const dubUsed = 0;
  const clonesUsed = 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("usage.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("usage.subtitle")}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <UsageBar
          icon={Mic2}
          label={t("usage.tts")}
          used={ttsUsed}
          total={plan.limits.ttsCharsMonth}
          unit={t("usage.unitChars")}
        />
        <UsageBar
          icon={Film}
          label={t("usage.dubbing")}
          used={dubUsed}
          total={plan.limits.dubbingMinMonth}
          unit={t("usage.unitMinutes")}
        />
        <UsageBar
          icon={Wand2}
          label={t("usage.cloning")}
          used={clonesUsed}
          total={plan.limits.voiceCloneMax}
          unit={t("usage.unitClones")}
        />
      </div>

      {/* Tip */}
      <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4 flex items-start gap-3">
        <HelpCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
        <div className="flex-1 text-sm text-muted-foreground">
          {t("usage.resetHint")}{" "}
          <Link
            href="/pricing"
            className="font-semibold text-primary hover:underline underline-offset-2"
          >
            {t("usage.topupLink")}
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── BILLING TAB ────────────────────────────────────────────────────────
function BillingTab({
  payments,
  loading,
  t,
}: {
  payments: Payment[] | null;
  loading: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("billing.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("billing.subtitle")}</p>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border/60 bg-card/40 p-12 text-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline-block h-4 w-4 animate-spin" />
          {t("billing.loading")}
        </div>
      ) : !payments || payments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/20 p-12 text-center">
          <CreditCard className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">{t("noPayments")}</p>
          <Link
            href="/pricing"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline underline-offset-2"
          >
            {t("upgrade")}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
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
                  className="border-b border-border/30 last:border-0 transition-colors hover:bg-muted/10"
                >
                  <td className="p-3 font-mono text-xs">{p.ref_code}</td>
                  <td className="p-3 capitalize">
                    {p.plan_id}
                    {p.is_ltd && (
                      <span className="ml-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                        LTD
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right font-mono">
                    {p.amount_vnd.toLocaleString("vi-VN")}đ
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[p.status] || ""}`}
                    >
                      {t(
                        p.status === "paid"
                          ? "statusPaid"
                          : p.status === "pending"
                            ? "statusPending"
                            : "statusCancelled"
                      )}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    {p.status === "pending" && (
                      <Link
                        href={`/checkout/${p.plan_id}?ref=${p.ref_code}`}
                        className="text-xs font-semibold text-primary hover:underline underline-offset-2"
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
  );
}

// ── SETTINGS TAB ───────────────────────────────────────────────────────
function SettingsTab({
  user,
  theme,
  setTheme,
  t,
}: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      {/* Profile info */}
      <Section title={t("settings.profile")}>
        <SettingsRow
          icon={Mail}
          label={t("settings.fieldEmail")}
          value={user.email}
          badge={user.email_verified ? t("verified") : t("notVerified")}
          badgeOk={user.email_verified}
        />
        <SettingsRow
          icon={Crown}
          label={t("settings.fieldPlan")}
          value={user.plan.charAt(0).toUpperCase() + user.plan.slice(1)}
        />
        {user.plan_expires_at && (
          <SettingsRow
            icon={Calendar}
            label={t("settings.fieldExpires")}
            value={new Date(user.plan_expires_at).toLocaleDateString("vi-VN")}
          />
        )}
        <div className="mt-4 pt-4 border-t border-border/30 text-xs text-muted-foreground">
          {t("settings.editHint")}{" "}
          <Link
            href="/contact"
            className="font-semibold text-primary hover:underline underline-offset-2"
          >
            {t("settings.editCta")}
          </Link>
        </div>
      </Section>

      {/* Appearance */}
      <Section title={t("settings.appearance")}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-muted/20">
              {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </div>
            <div>
              <div className="text-sm font-medium">{t("settings.theme")}</div>
              <div className="text-xs text-muted-foreground">
                {theme === "dark" ? t("settings.themeDark") : t("settings.themeLight")}
              </div>
            </div>
          </div>
          <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/40 p-1">
            <button
              onClick={() => setTheme("light")}
              className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                theme === "light" ? "bg-foreground text-background" : "text-muted-foreground"
              }`}
              aria-label="Light"
            >
              <Sun className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setTheme("dark")}
              className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                theme === "dark" ? "bg-foreground text-background" : "text-muted-foreground"
              }`}
              aria-label="Dark"
            >
              <Moon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </Section>

      {/* Support */}
      <Section title={t("settings.support")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <SupportLink icon={Mail} label="voxstudio.vn@gmail.com" href="mailto:voxstudio.vn@gmail.com" />
          <SupportLink icon={HelpCircle} label={t("settings.faqLink")} href="/#faq" />
          <SupportLink icon={ShieldCheck} label={t("settings.privacyLink")} href="/privacy" />
          <SupportLink icon={ExternalLink} label={t("settings.termsLink")} href="/terms" />
        </div>
      </Section>
    </div>
  );
}

// ── SHARED COMPONENTS ──────────────────────────────────────────────────
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  accent?: "primary";
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-5 transition-all hover:-translate-y-0.5 ${
        accent === "primary"
          ? "border-primary/30 bg-gradient-to-br from-primary/[0.08] to-card/40 ring-1 ring-primary/10"
          : "border-border/60 bg-card/40 hover:border-border"
      }`}
    >
      {accent === "primary" && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/20 blur-2xl"
        />
      )}
      <div className="relative">
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-muted/20">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

function ActionTile({
  icon: Icon,
  label,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md hover:shadow-primary/10"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/5">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1 text-sm font-medium">{label}</div>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function FeatureLine({
  icon: Icon,
  label,
  dim,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  dim?: boolean;
}) {
  return (
    <div className={`flex items-start gap-2.5 ${dim ? "opacity-60" : ""}`}>
      <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${dim ? "text-muted-foreground" : "text-primary"}`} />
      <span className="text-sm">{label}</span>
    </div>
  );
}

function UsageBar({
  icon: Icon,
  label,
  used,
  total,
  unit,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  used: number;
  total: number;
  unit: string;
}) {
  const isUnlimited = total === -1;
  const pct = isUnlimited ? 0 : Math.min(100, (used / Math.max(1, total)) * 100);
  const barColor = pct > 80 ? "from-yellow-500 to-orange-500" : "from-primary to-fuchsia-500";

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-muted/20">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold">{used.toLocaleString("vi-VN")}</span>
        <span className="text-sm text-muted-foreground">
          / {isUnlimited ? "∞" : total.toLocaleString("vi-VN")} {unit}
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted/40">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-5 sm:p-6">
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
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
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-2.5 rounded-lg border border-border/60 bg-background/40 p-3 transition-colors hover:bg-muted/40"
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm flex-1 truncate">{label}</span>
      <ArrowUpRight className="h-3 w-3 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </Link>
  );
}
