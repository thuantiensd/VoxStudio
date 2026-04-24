import { useState, useEffect, createContext, useContext } from "react";
import { useLocation } from "react-router-dom";
import {
  User, CreditCard, BarChart3, Bell, Lock, Server, Info, Loader2,
  Palette, Sun, Moon, Monitor, KeyRound, Package,
} from "lucide-react";
import IntegrationsTab from "./settings/IntegrationsTab";
import { useToast } from "../components/ui/Toast";
import { useT, useI18n } from "../i18n/I18nContext";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../theme/ThemeContext";
import { checkHealth, listPlans, fetchMe } from "../services/api";

/**
 * Settings — Claude-style layout:
 *   [left nav: tabs]  [right content panel]
 *
 * Tabs cover everything users expect in account settings; billing, usage,
 * notifications etc. live INSIDE here rather than as separate sidebar routes.
 */

const TABS = [
  { id: "account", icon: User, tKey: "settings.tabs.account" },
  { id: "appearance", icon: Palette, tKey: "settings.tabs.appearance" },
  { id: "plans", icon: Package, tKey: "settings.tabs.plans" },
  { id: "billing", icon: CreditCard, tKey: "settings.tabs.billing" },
  { id: "usage", icon: BarChart3, tKey: "settings.tabs.usage" },
  { id: "notifications", icon: Bell, tKey: "settings.tabs.notifications" },
  { id: "privacy", icon: Lock, tKey: "settings.tabs.privacy" },
  { id: "server", icon: Server, tKey: "settings.tabs.server" },
  { id: "integrations", icon: KeyRound, tKey: "settings.tabs.integrations" },
  { id: "about", icon: Info, tKey: "settings.tabs.about" },
];

// Cross-tab navigation helper (dùng trong SettingsPage; tránh xài
// window.location.hash vì conflict với HashRouter)
const SettingsNavCtx = createContext(() => {});

export default function SettingsPage() {
  const t = useT();
  const loc = useLocation();
  // Deep link qua state: navigate("/settings", { state: { tab: "integrations" } })
  const initialTab = loc.state?.tab && TABS.find((tb) => tb.id === loc.state.tab)
    ? loc.state.tab : "account";
  const [active, setActive] = useState(initialTab);
  // Nếu state.tab đổi sau mount (nav lần nữa tới settings với tab khác)
  useEffect(() => {
    if (loc.state?.tab && TABS.find((tb) => tb.id === loc.state.tab)) {
      setActive(loc.state.tab);
    }
  }, [loc.state]);
  const activeTab = TABS.find((tb) => tb.id === active) || TABS[0];

  return (
    <SettingsNavCtx.Provider value={setActive}>
    <div className="flex h-full overflow-hidden"
         style={{ background: "var(--n-0)" }}>
      {/* Left: tab list */}
      <aside
        className="flex-shrink-0 py-3 px-2"
        style={{
          width: 200,
          borderRight: "1px solid var(--n-3)",
          background: "var(--n-1)",
        }}
      >
        <div
          className="px-3 py-2 mb-2 text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--n-6)" }}
        >
          {t("settings.title")}
        </div>
        <nav className="space-y-0.5">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = active === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                className="w-full flex items-center gap-2 rounded-md px-2.5 transition-colors"
                style={{
                  height: 30,
                  background: isActive ? "var(--accent-soft)" : "transparent",
                  color: isActive ? "var(--n-10)" : "var(--n-8)",
                  fontWeight: isActive ? 500 : 400,
                  fontSize: 13,
                  borderLeft: `2px solid ${isActive ? "var(--accent)" : "transparent"}`,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = "var(--n-2)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <Icon size={13} />
                <span className="flex-1 text-left">{t(tab.tKey)}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Right: panel */}
      <main className="flex-1 flex flex-col overflow-hidden"
            style={{ background: "var(--n-0)" }}>
        <div style={{
          padding: "20px 32px 14px",
          borderBottom: "1px solid var(--n-2)",
          flexShrink: 0,
        }}>
          <h1 style={{
            fontSize: 20, fontWeight: 600, margin: 0,
            color: "var(--n-10)", letterSpacing: "var(--tr-tight)",
          }}>
            {t(activeTab.tKey)}
          </h1>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Billing + Usage cần rộng hơn để 3 card không bị bóp */}
          <div
            className="mx-auto p-8"
            style={{
              maxWidth: (active === "plans" || active === "usage") ? 1100 : 672,
            }}
          >
            {active === "account" && <AccountTab />}
            {active === "appearance" && <AppearanceTab />}
            {active === "plans" && <PlansTab />}
            {active === "billing" && <BillingTab />}
            {active === "usage" && <UsageTab />}
            {active === "notifications" && <NotificationsTab />}
            {active === "privacy" && <PrivacyTab />}
            {active === "server" && <ServerTab />}
            {active === "integrations" && <IntegrationsTab />}
            {active === "about" && <AboutTab />}
          </div>
        </div>
      </main>
    </div>
    </SettingsNavCtx.Provider>
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

// ── Appearance ────────────────────────────
function AppearanceTab() {
  const t = useT();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useI18n();

  const themeOptions = [
    { id: "light",  icon: Sun,     label: t("settings.appearance.light") },
    { id: "dark",   icon: Moon,    label: t("settings.appearance.dark") },
    { id: "system", icon: Monitor, label: t("settings.appearance.system") },
  ];
  const langOptions = [
    { id: "vi", label: "Tiếng Việt", hint: "Vietnamese" },
    { id: "en", label: "English",    hint: "Tiếng Anh" },
  ];

  return (
    <>
      <Section title={t("settings.appearance.theme")}
               description={t("settings.appearance.themeDesc")}>
        <div className="grid grid-cols-3 gap-2">
          {themeOptions.map(({ id, icon: Icon, label }) => {
            const active = theme === id;
            return (
              <button
                key={id}
                onClick={() => setTheme(id)}
                className="flex flex-col items-center gap-2 py-4 transition-colors"
                style={{
                  background: active ? "var(--accent-soft)" : "var(--n-1)",
                  border: `1px solid ${active ? "var(--accent)" : "var(--n-3)"}`,
                  borderRadius: 8,
                  color: "var(--n-10)",
                  cursor: "pointer",
                }}
              >
                <Icon size={20} style={{ color: active ? "var(--accent)" : "var(--n-8)" }} />
                <span className="text-sm">{label}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title={t("user.language") || "Ngôn ngữ"}
               description="Chọn ngôn ngữ giao diện · Choose interface language">
        <div className="grid grid-cols-2 gap-2">
          {langOptions.map(({ id, label, hint }) => {
            const active = locale === id;
            return (
              <button
                key={id}
                onClick={() => setLocale(id)}
                className="flex items-center justify-between px-4 py-3 transition-colors"
                style={{
                  background: active ? "var(--accent-soft)" : "var(--n-1)",
                  border: `1px solid ${active ? "var(--accent)" : "var(--n-3)"}`,
                  borderRadius: 8,
                  color: "var(--n-10)",
                  cursor: "pointer",
                }}
              >
                <div className="flex flex-col items-start">
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{label}</span>
                  <span style={{ fontSize: 11, color: "var(--n-8)" }}>{hint}</span>
                </div>
                {active && (
                  <span
                    style={{
                      width: 18, height: 18, borderRadius: "50%",
                      background: "var(--accent)", color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700,
                    }}
                  >
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </Section>
    </>
  );
}

// ── Billing ───────────────────────────────
function formatVND(n) {
  return (n || 0).toLocaleString("vi-VN") + "đ";
}

function FeatureItem({ ok, label }) {
  return (
    <div className="flex items-start gap-1.5 text-[12.5px] mb-1"
         style={{ color: ok ? "var(--text-primary)" : "var(--text-secondary)",
                   opacity: ok ? 1 : 0.5 }}>
      <span style={{ color: ok ? "#22c55e" : "var(--n-6)",
                      fontWeight: 700, marginTop: 1 }}>
        {ok ? "✓" : "✗"}
      </span>
      <span>{label}</span>
    </div>
  );
}

function PlanCard({ plan, isCurrent, highlighted, onUpgrade }) {
  const { features = {}, limits = {} } = plan;
  const unlimited = (v) => v === -1 ? "∞" : v;
  const fmtMin = (v) => v === -1 ? "∞" : `${v} phút`;
  const fmtChars = (v) => v === -1 ? "∞" : `${(v / 1000).toLocaleString()}k`;

  const quickStats = [
    { label: "Lồng tiếng",   val: fmtMin(limits.dubbing_min_month),  suffix: "/tháng" },
    { label: "Phụ đề STT",   val: fmtMin(limits.stt_min_month),      suffix: "/tháng" },
    { label: "TTS",          val: fmtChars(limits.tts_chars_month),  suffix: " ký tự/tháng" },
    { label: "Clone giọng",  val: unlimited(limits.voice_clone_max), suffix: " giọng" },
  ];

  const perks = [
    { k: "concurrent", always: true,
      l: `${unlimited(limits.concurrent_jobs)} tác vụ song song` },
    { k: "batch",          l: "Xử lý nhiều file cùng lúc" },
    { k: "priority_queue", l: "Ưu tiên hàng đợi GPU" },
    { k: "export_4k",      l: "Xuất chất lượng 4K" },
    { k: "watermark_free", l: "Không watermark" },
    { k: "api",            l: "API cho developer" },
  ];

  const priceDisplay = plan.price_vnd === 0
    ? { big: "0đ", small: "miễn phí" }
    : { big: `${(plan.price_vnd / 1000).toFixed(0)}k`, small: "/tháng" };

  return (
    <div
      style={{
        position: "relative",
        padding: 18,
        borderRadius: 12,
        background: highlighted
          ? "linear-gradient(160deg, var(--accent-soft), rgba(139,92,246,0.05))"
          : "var(--n-1)",
        border: `1px solid ${highlighted ? "var(--accent)" : "var(--n-3)"}`,
        display: "flex", flexDirection: "column",
        minHeight: 460,
      }}
    >
      {highlighted && (
        <div style={{
          position: "absolute", top: -9, left: 16,
          background: "var(--accent)", color: "#fff",
          padding: "2px 10px", borderRadius: 6,
          fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
        }}>
          PHỔ BIẾN
        </div>
      )}

      {/* Header */}
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--n-9)",
                     textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {plan.name}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4,
                     marginTop: 6 }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: "var(--n-10)",
                        letterSpacing: "-0.02em", lineHeight: 1 }}>
          {priceDisplay.big}
        </span>
        <span style={{ fontSize: 12, color: "var(--n-7)" }}>
          {priceDisplay.small}
        </span>
      </div>

      {/* LTD banner */}
      {plan.ltd && plan.ltd.price_vnd > 0 && plan.ltd.slots_available > 0 && (
        <div style={{
          marginTop: 10,
          padding: "6px 8px", borderRadius: 6,
          background: "rgba(251,191,36,0.10)",
          border: "1px solid rgba(251,191,36,0.25)",
          fontSize: 10.5, lineHeight: 1.4,
        }}>
          <div style={{ color: "#f59e0b", fontWeight: 700 }}>🎁 Trọn đời</div>
          <div style={{ color: "var(--n-9)", marginTop: 1 }}>
            <b>{formatVND(plan.ltd.price_vnd)}</b> · còn {plan.ltd.slots_available} suất
          </div>
        </div>
      )}

      {/* Quick stats grid */}
      <div style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: "1px solid var(--n-3)",
      }}>
        {quickStats.map((s) => (
          <div key={s.label}
               style={{ display: "flex", justifyContent: "space-between",
                         alignItems: "baseline",
                         fontSize: 12, marginBottom: 5 }}>
            <span style={{ color: "var(--n-7)" }}>{s.label}</span>
            <span style={{ color: "var(--n-10)", fontWeight: 600,
                            textAlign: "right" }}>
              {s.val}<span style={{ color: "var(--n-7)", fontWeight: 400 }}>{s.suffix}</span>
            </span>
          </div>
        ))}
      </div>

      {/* Feature list */}
      <div style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: "1px solid var(--n-3)",
        flex: 1,
      }}>
        {perks.map((p) => {
          const on = p.always || !!features[p.k];
          return <FeatureItem key={p.k || p.l} ok={on} label={p.l} />;
        })}
      </div>

      {/* Action button */}
      <div style={{ marginTop: 12 }}>
        {isCurrent ? (
          <button disabled style={{
            width: "100%", padding: "9px", borderRadius: 8,
            background: "var(--n-2)", color: "var(--n-8)",
            border: "1px solid var(--n-3)", fontSize: 12.5, fontWeight: 600,
            cursor: "default",
          }}>
            ✓ Đang dùng
          </button>
        ) : plan.id === "free" ? (
          <button disabled style={{
            width: "100%", padding: "9px", borderRadius: 8,
            background: "transparent", color: "var(--n-7)",
            border: "1px solid var(--n-3)", fontSize: 12.5,
            cursor: "default",
          }}>
            Gói cơ bản
          </button>
        ) : (
          <button
            onClick={() => onUpgrade(plan)}
            style={{
              width: "100%", padding: "9px", borderRadius: 8,
              background: highlighted
                ? "linear-gradient(135deg, var(--accent), #8b5cf6)"
                : "var(--n-1)",
              color: highlighted ? "#fff" : "var(--accent)",
              border: highlighted ? "none" : "1px solid var(--accent)",
              fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              boxShadow: highlighted
                ? "0 4px 14px rgba(108,92,231,0.3)" : "none",
            }}
          >
            Chọn {plan.name}
          </button>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   PlansTab — trang so sánh các gói dịch vụ, chọn nâng cấp.
   Thuần marketing: 3 card + LTD banner + CTA "Chọn".
   Click CTA → chuyển sang tab Thanh toán để checkout thật.
   ───────────────────────────────────────────────────────── */
function PlansTab() {
  const { user } = useAuth();
  const toast = useToast();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listPlans().then((res) => {
      setPlans(res?.plans || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const onUpgrade = (plan) => {
    // Chưa tích hợp payment gateway → toast thông báo
    toast?.info?.(
      `Thanh toán gói ${plan.name} sẽ ra mắt sớm. Theo dõi email để nhận ưu đãi sớm.`,
      { title: "Sắp mở thanh toán" }
    );
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm"
           style={{ color: "var(--n-8)" }}>
        <Loader2 size={14} className="animate-spin" /> Đang tải bảng giá…
      </div>
    );
  }
  if (!plans.length) {
    return (
      <div className="text-sm" style={{ color: "var(--n-7)" }}>
        Chưa lấy được bảng giá. Vui lòng thử lại sau.
      </div>
    );
  }

  const highlightedId = "pro";
  const currentPlanId = user?.plan || "free";

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--n-10)",
                      marginBottom: 4 }}>
          Chọn gói phù hợp
        </h2>
        <p style={{ fontSize: 12.5, color: "var(--n-8)" }}>
          Mọi gói đều cho phép dùng <b>API key cá nhân</b> (OpenAI, Gemini,
          Claude…) — không bị markup, bạn trả trực tiếp cho nhà cung cấp.
        </p>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 12,
        marginBottom: 20,
      }}>
        {plans.map((p) => (
          <PlanCard
            key={p.id}
            plan={p}
            isCurrent={p.id === currentPlanId}
            highlighted={p.id === highlightedId}
            onUpgrade={onUpgrade}
          />
        ))}
      </div>

      <div style={{
        padding: 12, borderRadius: 8,
        background: "var(--n-1)",
        border: "1px solid var(--n-3)",
        fontSize: 12, color: "var(--n-8)",
        lineHeight: 1.55,
      }}>
        <b style={{ color: "var(--n-10)" }}>💡 Ưu đãi trọn đời (Early Believer)</b>{" "}
        Chỉ 100 suất đầu cho mỗi gói — thanh toán 1 lần, dùng mãi mãi.
        Khi hết suất, chỉ còn gói hàng tháng bình thường.
      </div>
    </>
  );
}


/* ─────────────────────────────────────────────────────────
   BillingTab — quản lý thanh toán:
     • Gói hiện tại + ngày hết hạn
     • Phương thức thanh toán
     • Hoá đơn / lịch sử giao dịch
     • Huỷ / đổi gói
   ───────────────────────────────────────────────────────── */
function BillingTab() {
  const { user } = useAuth();
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMe().then(setMe).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm"
           style={{ color: "var(--n-8)" }}>
        <Loader2 size={14} className="animate-spin" /> Đang tải…
      </div>
    );
  }

  const plan = me?.plan;
  const planName = plan?.name || "Miễn phí";
  const isFree = (user?.plan || "free") === "free";
  const navTab = useContext(SettingsNavCtx);
  const goPlans = () => navTab("plans");

  return (
    <>
      {/* Current plan card */}
      <div style={{
        padding: 20, borderRadius: 12,
        background: isFree
          ? "var(--n-1)"
          : "linear-gradient(135deg, var(--accent-soft), rgba(139,92,246,0.05))",
        border: `1px solid ${isFree ? "var(--n-3)" : "var(--accent)"}`,
        marginBottom: 20,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between",
                       alignItems: "flex-start", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600,
                           color: "var(--n-7)",
                           textTransform: "uppercase",
                           letterSpacing: "0.08em",
                           marginBottom: 4 }}>
              Gói hiện tại
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--n-10)",
                           letterSpacing: "-0.02em" }}>
              {planName}
            </div>
            {!isFree && plan?.price_vnd > 0 && (
              <div style={{ fontSize: 13, color: "var(--n-8)", marginTop: 4 }}>
                {formatVND(plan.price_vnd)}/tháng
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--n-7)", marginTop: 8 }}>
              {isFree
                ? "Bạn đang dùng gói miễn phí. Nâng cấp để mở khoá toàn bộ tính năng."
                : "Gói đang hoạt động. Xem chi tiết sử dụng ở tab Sử dụng."}
            </div>
          </div>
          <button
            onClick={goPlans}
            style={{
              padding: "9px 16px", borderRadius: 8,
              background: isFree
                ? "linear-gradient(135deg, var(--accent), #8b5cf6)"
                : "var(--n-1)",
              color: isFree ? "#fff" : "var(--accent)",
              border: isFree ? "none" : "1px solid var(--accent)",
              fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              whiteSpace: "nowrap",
              boxShadow: isFree ? "0 4px 14px rgba(108,92,231,0.3)" : "none",
            }}
          >
            {isFree ? "Nâng cấp ngay →" : "Đổi gói"}
          </button>
        </div>
      </div>

      {/* Payment method */}
      <Section title="Phương thức thanh toán">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                Chưa có phương thức thanh toán
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
                Sẽ tự động yêu cầu khi bạn nâng cấp gói.
              </p>
            </div>
            <GhostButton disabled style={{ opacity: 0.5, cursor: "not-allowed" }}>
              Sắp ra mắt
            </GhostButton>
          </div>
        </Card>
      </Section>

      {/* Invoices */}
      <Section title="Lịch sử giao dịch">
        <Card>
          <div style={{ padding: "20px 0", textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "var(--n-7)" }}>
              Chưa có giao dịch nào
            </div>
            <div style={{ fontSize: 11, color: "var(--n-7)", marginTop: 4 }}>
              Hoá đơn sẽ hiện ở đây sau khi bạn thanh toán.
            </div>
          </div>
        </Card>
      </Section>

      {/* Cancel subscription — chỉ hiện nếu đang có gói trả phí */}
      {!isFree && (
        <Section title="Quản lý gói">
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                  Huỷ gói {planName}
                </p>
                <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
                  Bạn sẽ chuyển về gói Miễn phí khi hết chu kỳ hiện tại.
                </p>
              </div>
              <GhostButton danger>Huỷ gói</GhostButton>
            </div>
          </Card>
        </Section>
      )}
    </>
  );
}

// ── Usage ───────────────────────────────
function UsageTab() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMe().then(setMe).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm"
           style={{ color: "var(--n-8)" }}>
        <Loader2 size={14} className="animate-spin" /> Đang tải dữ liệu sử dụng…
      </div>
    );
  }

  const usage = me?.usage_month || {};
  const limits = me?.plan?.limits || {};
  const planName = me?.plan?.name || "Miễn phí";

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--n-10)" }}>
          Tháng {new Date().getMonth() + 1}/{new Date().getFullYear()} · Gói {planName}
        </h2>
        <p style={{ fontSize: 12, color: "var(--n-8)", marginTop: 2 }}>
          Hạn mức reset vào ngày 1 mỗi tháng.
        </p>
      </div>
      <Card>
        <UsageRow label="Phút lồng tiếng"
                   used={Math.round(usage.dubbing_min || 0)}
                   limit={limits.dubbing_min_month} />
        <div className="h-3" />
        <UsageRow label="Phút phụ đề (STT)"
                   used={Math.round(usage.stt_min || 0)}
                   limit={limits.stt_min_month} />
        <div className="h-3" />
        <UsageRow label="Ký tự TTS"
                   used={usage.tts_chars || 0}
                   limit={limits.tts_chars_month} />
        <div className="h-3" />
        <UsageRow label="Token dịch (dùng key của bạn)"
                   used={usage.translate_tokens || 0}
                   limit={-1} />
      </Card>
    </>
  );
}

function UsageRow({ label, used, limit }) {
  // limit = -1 → unlimited
  const unlimited = limit === -1;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const over = !unlimited && used >= limit;
  const warning = !unlimited && pct >= 80;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 text-sm">
        <span style={{ color: "var(--text-primary)" }}>{label}</span>
        <span style={{ color: over ? "var(--err)"
                                    : warning ? "var(--warn)"
                                    : "var(--text-secondary)" }}>
          {unlimited
            ? `${used.toLocaleString()} · Không giới hạn`
            : `${used.toLocaleString()} / ${limit.toLocaleString()}`}
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden"
           style={{ background: "rgba(255,255,255,0.06)" }}>
        <div className="h-full rounded-full transition-all"
             style={{
               width: `${unlimited ? 100 : pct}%`,
               background: unlimited
                 ? "linear-gradient(90deg, var(--accent), #8b5cf6)"
                 : over
                 ? "var(--err)"
                 : warning
                 ? "var(--warn)"
                 : "var(--accent)",
             }} />
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
        <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {health?.status === "ok"
            ? "Dịch vụ đang hoạt động bình thường."
            : health?.status === "error"
            ? "Dịch vụ tạm ngưng. Vui lòng thử lại sau ít phút."
            : "Đang kiểm tra kết nối…"}
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
