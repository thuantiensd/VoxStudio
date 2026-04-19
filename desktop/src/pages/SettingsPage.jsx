import { useState, useEffect } from "react";
import {
  User, CreditCard, BarChart3, Bell, Lock, Server, Info, Loader2,
} from "lucide-react";
import { useT } from "../i18n/I18nContext";
import { useAuth } from "../auth/AuthContext";
import { checkHealth } from "../services/api";

/**
 * Settings — Claude-style layout:
 *   [left nav: tabs]  [right content panel]
 *
 * Tabs cover everything users expect in account settings; billing, usage,
 * notifications etc. live INSIDE here rather than as separate sidebar routes.
 */

const TABS = [
  { id: "account", icon: User, tKey: "settings.tabs.account" },
  { id: "billing", icon: CreditCard, tKey: "settings.tabs.billing" },
  { id: "usage", icon: BarChart3, tKey: "settings.tabs.usage" },
  { id: "notifications", icon: Bell, tKey: "settings.tabs.notifications" },
  { id: "privacy", icon: Lock, tKey: "settings.tabs.privacy" },
  { id: "server", icon: Server, tKey: "settings.tabs.server" },
  { id: "about", icon: Info, tKey: "settings.tabs.about" },
];

export default function SettingsPage() {
  const t = useT();
  const [active, setActive] = useState("account");

  return (
    <div className="flex h-full">
      {/* Left: tab list */}
      <aside
        className="flex-shrink-0 border-r py-6 px-3"
        style={{
          width: 220,
          borderColor: "rgba(255,255,255,0.06)",
          background: "var(--bg-surface)",
        }}
      >
        <h1
          className="px-3 mb-4 text-lg font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {t("settings.title")}
        </h1>
        <nav className="space-y-0.5">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = active === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                className="w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors"
                style={{
                  background: isActive ? "var(--bg-card)" : "transparent",
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                  fontWeight: isActive ? 500 : 400,
                }}
              >
                <Icon size={15} />
                <span className="flex-1 text-left">{t(tab.tKey)}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Right: panel */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-8">
          {active === "account" && <AccountTab />}
          {active === "billing" && <BillingTab />}
          {active === "usage" && <UsageTab />}
          {active === "notifications" && <NotificationsTab />}
          {active === "privacy" && <PrivacyTab />}
          {active === "server" && <ServerTab />}
          {active === "about" && <AboutTab />}
        </div>
      </main>
    </div>
  );
}

// ───────────────────────── Tabs ─────────────────────────

function Section({ title, description, children }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-1"
          style={{ color: "var(--text-primary)" }}>{title}</h2>
      {description && (
        <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
          {description}
        </p>
      )}
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Card({ children, className = "" }) {
  return (
    <div
      className={`rounded-lg border p-4 ${className}`}
      style={{ background: "var(--bg-card)", borderColor: "rgba(255,255,255,0.08)" }}
    >
      {children}
    </div>
  );
}

function Field({ label, children, helper }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5"
             style={{ color: "var(--text-primary)" }}>{label}</label>
      {children}
      {helper && (
        <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
          {helper}
        </p>
      )}
    </div>
  );
}

function TextInput(props) {
  return (
    <input
      {...props}
      className="w-full rounded-md px-3 py-2 text-sm outline-none"
      style={{
        background: "var(--bg-base)",
        color: "var(--text-primary)",
        border: "1px solid rgba(255,255,255,0.1)",
      }}
    />
  );
}

function PrimaryButton({ children, ...rest }) {
  return (
    <button
      {...rest}
      className="rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
      style={{ background: "var(--accent)", color: "#fff" }}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, danger, ...rest }) {
  return (
    <button
      {...rest}
      className="rounded-md px-3 py-2 text-sm font-medium transition-colors"
      style={{
        background: "transparent",
        color: danger ? "#f87171" : "var(--text-primary)",
        border: "1px solid rgba(255,255,255,0.12)",
      }}
    >
      {children}
    </button>
  );
}

// ── Account ───────────────────────────────
function AccountTab() {
  const t = useT();
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");

  return (
    <>
      <Section title={t("settings.account.profile")}>
        <Card>
          <div className="space-y-4">
            <Field label={t("auth.signup.nameLabel")}>
              <TextInput value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("auth.signup.emailLabel")}>
              <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <div className="flex justify-end pt-2">
              <PrimaryButton
                onClick={() => updateUser({ name, email })}
                disabled={name === user?.name && email === user?.email}
              >
                {t("common.save")}
              </PrimaryButton>
            </div>
          </div>
        </Card>
      </Section>

      <Section title={t("settings.account.password")}
               description={t("settings.account.passwordDesc")}>
        <Card>
          <div className="space-y-4">
            <Field label={t("settings.account.currentPassword")}>
              <TextInput type="password" placeholder="••••••••" />
            </Field>
            <Field label={t("settings.account.newPassword")}>
              <TextInput type="password" placeholder="••••••••" />
            </Field>
            <div className="flex justify-end pt-2">
              <PrimaryButton>{t("settings.account.changePassword")}</PrimaryButton>
            </div>
          </div>
        </Card>
      </Section>

      <Section title={t("settings.account.deleteAccount")}
               description={t("settings.account.deleteDesc")}>
        <Card>
          <GhostButton danger>{t("settings.account.deleteAccount")}</GhostButton>
        </Card>
      </Section>
    </>
  );
}

// ── Billing ───────────────────────────────
function BillingTab() {
  const t = useT();
  const { user } = useAuth();

  const plans = [
    { key: "free", name: t("auth.plan.free"), price: "0₫", period: "/tháng",
      features: ["10 phút/tháng", "1 voice clone", "Chất lượng cơ bản"] },
    { key: "pro", name: t("auth.plan.pro"), price: "199.000₫", period: "/tháng",
      features: ["120 phút/tháng", "5 voice clones", "Chất lượng cao nhất", "Emotion preservation"] },
    { key: "business", name: t("auth.plan.business"), price: "499.000₫", period: "/tháng",
      features: ["600 phút/tháng", "Unlimited clones", "API access", "Dedicated support"] },
  ];

  return (
    <>
      <Section title={t("settings.billing.currentPlan")}>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold"
                   style={{ color: "var(--text-primary)" }}>
                {t(`auth.plan.${user?.plan || "free"}`)}
              </div>
              <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {t("settings.billing.renewInfo")}
              </p>
            </div>
            {user?.plan === "free" ? (
              <PrimaryButton>{t("settings.billing.upgrade")}</PrimaryButton>
            ) : (
              <GhostButton>{t("settings.billing.managePlan")}</GhostButton>
            )}
          </div>
        </Card>
      </Section>

      <Section title={t("settings.billing.plans")}>
        <div className="grid gap-3">
          {plans.map((p) => (
            <Card key={p.key}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold" style={{ color: "var(--text-primary)" }}>
                    {p.name}
                  </div>
                  <div className="text-sm mt-0.5"
                       style={{ color: "var(--text-secondary)" }}>
                    <span className="font-medium"
                          style={{ color: "var(--text-primary)" }}>{p.price}</span>
                    {p.period}
                    {" · "}{p.features.join(", ")}
                  </div>
                </div>
                {user?.plan === p.key ? (
                  <span className="text-xs px-2 py-1 rounded"
                        style={{ background: "rgba(91,108,255,0.15)", color: "var(--accent)" }}>
                    {t("settings.billing.current")}
                  </span>
                ) : (
                  <PrimaryButton>{t("settings.billing.choose")}</PrimaryButton>
                )}
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section title={t("settings.billing.paymentMethod")}>
        <Card>
          <div className="flex items-center justify-between">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {t("settings.billing.noMethod")}
            </p>
            <GhostButton>{t("settings.billing.addMethod")}</GhostButton>
          </div>
        </Card>
      </Section>

      <Section title={t("settings.billing.invoices")}>
        <Card>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {t("settings.billing.noInvoices")}
          </p>
        </Card>
      </Section>
    </>
  );
}

// ── Usage ───────────────────────────────
function UsageTab() {
  const t = useT();
  return (
    <>
      <Section title={t("settings.usage.thisMonth")}>
        <Card>
          <UsageRow label={t("settings.usage.dubbingMinutes")} used={0} limit={10} />
          <div className="h-3" />
          <UsageRow label={t("settings.usage.voiceClones")} used={0} limit={1} />
          <div className="h-3" />
          <UsageRow label={t("settings.usage.apiCalls")} used={0} limit={1000} />
        </Card>
      </Section>
    </>
  );
}

function UsageRow({ label, used, limit }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 text-sm">
        <span style={{ color: "var(--text-primary)" }}>{label}</span>
        <span style={{ color: "var(--text-secondary)" }}>
          {used} / {limit}
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden"
           style={{ background: "rgba(255,255,255,0.06)" }}>
        <div className="h-full rounded-full transition-all"
             style={{ width: `${pct}%`, background: "var(--accent)" }} />
      </div>
    </div>
  );
}

// ── Notifications ───────────────────────────────
function NotificationsTab() {
  const t = useT();
  const items = [
    { key: "jobDone", label: t("settings.notifications.jobDone") },
    { key: "quota", label: t("settings.notifications.quota") },
    { key: "marketing", label: t("settings.notifications.marketing") },
    { key: "productUpdates", label: t("settings.notifications.productUpdates") },
  ];
  return (
    <Section title={t("settings.notifications.email")}>
      <Card>
        <div className="space-y-3">
          {items.map((it) => (
            <label key={it.key}
                   className="flex items-center justify-between cursor-pointer">
              <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                {it.label}
              </span>
              <input type="checkbox" defaultChecked className="accent-current" />
            </label>
          ))}
        </div>
      </Card>
    </Section>
  );
}

// ── Privacy ───────────────────────────────
function PrivacyTab() {
  const t = useT();
  return (
    <>
      <Section title={t("settings.privacy.dataExport")}
               description={t("settings.privacy.dataExportDesc")}>
        <Card>
          <GhostButton>{t("settings.privacy.requestExport")}</GhostButton>
        </Card>
      </Section>
      <Section title={t("settings.privacy.dataRetention")}
               description={t("settings.privacy.dataRetentionDesc")}>
        <Card>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {t("settings.privacy.retentionInfo")}
          </p>
        </Card>
      </Section>
    </>
  );
}

// ── Server ───────────────────────────────
function ServerTab() {
  const t = useT();
  const [health, setHealth] = useState(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      const r = await checkHealth();
      setHealth(r);
    } catch {
      setHealth({ status: "error" });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => { check(); }, []);

  return (
    <Section title={t("settings.server.status")}
             description={t("settings.server.desc")}>
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full"
                 style={{
                   background: health?.status === "ok" ? "#22c55e"
                             : health?.status === "error" ? "#ef4444"
                             : "#9ca3af",
                 }} />
            <span className="text-sm" style={{ color: "var(--text-primary)" }}>
              {health?.status === "ok" ? t("settings.server.connected")
               : health?.status === "error" ? t("settings.server.offline")
               : t("common.loading")}
            </span>
          </div>
          <GhostButton onClick={check} disabled={checking}>
            {checking ? <Loader2 size={14} className="animate-spin" /> : t("settings.server.refresh")}
          </GhostButton>
        </div>
        <div className="text-xs space-y-1" style={{ color: "var(--text-secondary)" }}>
          <div>URL: {import.meta.env.VITE_API_URL || "http://localhost:8000"}</div>
          {health?.device && <div>Device: {health.device}</div>}
        </div>
      </Card>
    </Section>
  );
}

// ── About ───────────────────────────────
function AboutTab() {
  const t = useT();
  const [version, setVersion] = useState("");
  const [platform, setPlatform] = useState("");
  useEffect(() => {
    if (window.voxstudio) {
      window.voxstudio.getVersion?.().then(setVersion).catch(() => {});
      window.voxstudio.getPlatform?.().then(setPlatform).catch(() => {});
    }
  }, []);
  return (
    <Section title={t("settings.about.title")}>
      <Card>
        <div className="space-y-2 text-sm">
          <Row label={t("settings.about.version")} value={version || "0.1.0"} />
          <Row label={t("settings.about.platform")} value={platform || "web"} />
          <Row label={t("settings.about.runtime")}
               value={window.voxstudio?.isElectron ? "Electron" : "Browser"} />
        </div>
      </Card>
    </Section>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}
