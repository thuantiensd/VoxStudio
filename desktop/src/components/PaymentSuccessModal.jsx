import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Sparkles, X } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useT, useI18n } from "../i18n/I18nContext";
import { userStorage } from "../services/userScope";
import { listMyPayments } from "../services/api";

const SEEN_KEY = "voxstudio:payment:lastSeenPaidRef";
const POLL_MS = 60_000;

/**
 * PaymentSuccessModal — poll list payments → khi phát hiện payment mới
 * status=paid mà user chưa thấy → hiện modal chúc mừng, refresh user
 * (để plan mới có hiệu lực ngay), lưu ref_code đã seen để không hiện lại.
 *
 * Mount global ở AppShell, chỉ chạy khi user đã đăng nhập + verified.
 */
export default function PaymentSuccessModal() {
  const t = useT();
  const { locale } = useI18n();
  const { user, refreshUser } = useAuth() || {};
  const [paid, setPaid] = useState(null);
  const inflight = useRef(false);

  useEffect(() => {
    if (!user || !user.email_verified) return;

    let cancelled = false;
    const tick = async () => {
      if (inflight.current || cancelled) return;
      inflight.current = true;
      try {
        const list = await listMyPayments();
        const paidItems = (list?.payments || list || []).filter(
          (p) => p.status === "paid",
        );
        if (paidItems.length === 0) return;
        // Sắp theo paid_at desc (fallback id)
        paidItems.sort((a, b) => {
          const ta = a.paid_at ? new Date(a.paid_at).getTime() : 0;
          const tb = b.paid_at ? new Date(b.paid_at).getTime() : 0;
          return tb - ta;
        });
        const newest = paidItems[0];
        const seen = userStorage.getItem(SEEN_KEY);
        if (seen === newest.ref_code) return;

        // First run cho user mới — đánh dấu hết các paid hiện có làm seen,
        // không quấy modal (chỉ trigger cho payment mới được confirm sau khi
        // user đăng nhập).
        if (!seen) {
          userStorage.setItem(SEEN_KEY, newest.ref_code);
          return;
        }

        // Payment mới được confirm → hiện modal + refresh user
        setPaid(newest);
        refreshUser?.().catch(() => {});
      } catch {
        /* network error — bỏ qua, lần sau retry */
      } finally {
        inflight.current = false;
      }
    };

    tick();
    const iv = setInterval(tick, POLL_MS);
    // Refresh khi tab focus lại (user vừa banking xong quay về)
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(iv);
      window.removeEventListener("focus", onFocus);
    };
  }, [user?.id, user?.email_verified, refreshUser]);

  const close = () => {
    if (paid?.ref_code) {
      try { userStorage.setItem(SEEN_KEY, paid.ref_code); } catch {}
    }
    setPaid(null);
  };

  if (!paid) return null;

  const planName = paid.plan_id
    ? paid.plan_id.charAt(0).toUpperCase() + paid.plan_id.slice(1)
    : "—";
  const amount = locale === "en" && paid.amount_usd > 0
    ? `$${(paid.amount_usd / 100).toFixed(2)}`
    : `${(paid.amount_vnd || 0).toLocaleString("vi-VN")}đ`;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 230,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div style={{
        width: "100%", maxWidth: 460,
        background: "var(--n-1)", border: "1px solid var(--n-3)",
        borderRadius: 16, padding: "28px 24px 22px",
        boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
        position: "relative",
      }}>
        <button
          onClick={close}
          style={{
            position: "absolute", top: 14, right: 14,
            background: "transparent", border: "none", cursor: "pointer",
            color: "var(--n-7)", padding: 4,
          }}
        >
          <X size={16} />
        </button>

        {/* Hero */}
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{
            display: "inline-flex", width: 64, height: 64, borderRadius: "50%",
            alignItems: "center", justifyContent: "center",
            background: "linear-gradient(135deg, #10b981, #059669)",
            color: "#fff", marginBottom: 12,
            boxShadow: "0 6px 20px rgba(16,185,129,0.45)",
          }}>
            <CheckCircle2 size={34} strokeWidth={2.5} />
          </div>
          <h2 style={{
            margin: "0 0 6px", fontSize: 20, fontWeight: 700,
            color: "var(--n-10)",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            {t("paymentSuccess.title")}
            <Sparkles size={18} style={{ color: "#f59e0b" }} />
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--n-8)", lineHeight: 1.5 }}>
            {t("paymentSuccess.subtitle", {
              plan: `${planName}${paid.is_ltd ? " — LTD" : ""}`,
            })}
          </p>
        </div>

        {/* Details */}
        <div style={{
          background: "var(--n-2)", border: "1px solid var(--n-3)",
          borderRadius: 10, padding: "12px 14px",
          display: "flex", flexDirection: "column", gap: 7,
          fontSize: 12.5, marginBottom: 16,
        }}>
          <Row label={t("paymentSuccess.refCode")} value={paid.ref_code} mono />
          <Row
            label={t("paymentSuccess.plan")}
            value={
              <>
                <span style={{ textTransform: "capitalize" }}>{planName}</span>
                {paid.is_ltd && (
                  <span style={{
                    marginLeft: 6, padding: "1px 6px", borderRadius: 4,
                    background: "rgba(168,85,247,0.15)",
                    color: "#a855f7", fontSize: 10, fontWeight: 600,
                  }}>LTD</span>
                )}
              </>
            }
          />
          <Row
            label={t("paymentSuccess.amount")}
            value={<span style={{ color: "#10b981", fontWeight: 700 }}>{amount}</span>}
          />
        </div>

        <p style={{
          margin: "0 0 16px", textAlign: "center",
          fontSize: 11.5, color: "var(--n-7)", lineHeight: 1.55,
        }}>
          {t("paymentSuccess.emailNote")}
        </p>

        <button
          onClick={close}
          style={{
            width: "100%", padding: "11px", borderRadius: 8,
            background: "linear-gradient(135deg, #10b981, #059669)",
            color: "#fff", border: "none",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
            boxShadow: "0 4px 14px rgba(16,185,129,0.35)",
          }}
        >
          {t("paymentSuccess.startUsing")}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, mono }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ flex: "0 0 110px", color: "var(--n-7)" }}>{label}</span>
      <span style={{
        flex: 1,
        fontFamily: mono ? "var(--font-mono, monospace)" : "inherit",
        fontWeight: 500, color: "var(--n-10)",
        wordBreak: "break-all",
      }}>
        {value || "—"}
      </span>
    </div>
  );
}
