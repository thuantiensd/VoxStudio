import { useEffect, useState } from "react";
import { X, Copy, Check, Loader2, Building2, AlertTriangle } from "lucide-react";
import { useT, useI18n } from "../i18n/I18nContext";
import { useToast } from "./ui/Toast";
import { checkoutPlan } from "../services/api";

/**
 * PaymentModal — hiện sau khi user click "Chọn {plan}" ở PlansTab.
 *
 * Flow:
 *   1. Mount → POST /billing/checkout → nhận ref_code + bank info + QR URL
 *   2. Hiển thị: VietQR + bank info + amount + ref_code (memo) + nút copy
 *   3. User chuyển khoản qua app banking → chờ admin xác nhận
 *   4. User bấm "Tôi đã chuyển khoản" → đóng modal, lịch sử payment ở Billing
 *
 * Props:
 *   open: bool
 *   onClose()
 *   plan: { id, name, price_vnd, price_usd, ltd?: {...} }
 *   isLtd: bool — checkout LTD price thay vì monthly
 */
export default function PaymentModal({ open, onClose, plan, isLtd = false }) {
  const t = useT();
  const { locale } = useI18n();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null); // { payment, bank, qr_url }
  const [copied, setCopied] = useState({ ref: false, account: false, amount: false });

  useEffect(() => {
    if (!open || !plan) return;
    setLoading(true); setError(""); setData(null);
    checkoutPlan({ planId: plan.id, isLtd })
      .then(setData)
      .catch((e) => setError(e?.message || t("payment.errCheckout")))
      .finally(() => setLoading(false));
  }, [open, plan, isLtd]); // eslint-disable-line

  const copy = (text, kind) => {
    try {
      navigator.clipboard?.writeText(text);
      setCopied((c) => ({ ...c, [kind]: true }));
      setTimeout(() => setCopied((c) => ({ ...c, [kind]: false })), 1500);
      toast.success(t("payment.copied"));
    } catch { /* ignore */ }
  };

  const close = () => {
    setData(null); setError(""); setCopied({});
    onClose?.();
  };

  if (!open) return null;

  const amountVnd = data?.payment?.amount_vnd || 0;
  const amountUsd = data?.payment?.amount_usd || 0;
  const refCode = data?.payment?.ref_code || "";
  const bank = data?.bank || {};
  const qrUrl = data?.qr_url;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 220,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 500,
          maxHeight: "calc(100vh - 40px)",
          overflowY: "auto",
          background: "var(--n-1)",
          border: "1px solid var(--n-3)",
          borderRadius: 14,
          padding: "24px 24px 20px",
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <Building2 size={18} style={{ color: "var(--accent)" }} />
          <h2 style={{ margin: 0, flex: 1, fontSize: 17, fontWeight: 700, color: "var(--n-10)" }}>
            {t("payment.title")}
          </h2>
          <button onClick={close}
            style={{ background: "transparent", border: "none", cursor: "pointer",
                     color: "var(--n-7)", padding: 4 }}>
            <X size={16} />
          </button>
        </div>
        <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "var(--n-8)" }}>
          {isLtd
            ? t("payment.subtitleLtd", { plan: plan?.name })
            : t("payment.subtitle", { plan: plan?.name })}
        </p>

        {loading && (
          <div style={{ padding: "32px 0", textAlign: "center" }}>
            <Loader2 size={24} className="animate-spin" style={{ color: "var(--accent)" }} />
            <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--n-8)" }}>
              {t("payment.creating")}
            </p>
          </div>
        )}

        {error && !loading && (
          <div style={{
            padding: 12, borderRadius: 8,
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            color: "var(--err)", fontSize: 12.5, lineHeight: 1.55,
            display: "flex", alignItems: "flex-start", gap: 8,
          }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </div>
        )}

        {data && !loading && !error && (
          <>
            {/* QR */}
            {qrUrl && (
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
                <div style={{
                  padding: 8, borderRadius: 12,
                  background: "#fff",
                  boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
                }}>
                  <img src={qrUrl} alt="VietQR"
                       style={{ display: "block", width: 220, height: "auto", borderRadius: 6 }} />
                </div>
              </div>
            )}
            <p style={{
              textAlign: "center", margin: "0 0 16px",
              fontSize: 11.5, color: "var(--n-7)",
            }}>
              {t("payment.scanHint")}
            </p>

            {/* Bank info */}
            <div style={{
              padding: "12px 14px", borderRadius: 10,
              background: "var(--n-2)",
              border: "1px solid var(--n-3)",
              marginBottom: 12,
              display: "flex", flexDirection: "column", gap: 8,
            }}>
              <Row label={t("payment.bankName")} value={bank.name} />
              <Row label={t("payment.accountName")} value={bank.account_name} />
              <Row
                label={t("payment.accountNo")}
                value={bank.account_no}
                copyable
                copied={copied.account}
                onCopy={() => copy(bank.account_no, "account")}
              />
              <Row
                label={t("payment.amount")}
                value={
                  locale === "en" && amountUsd > 0
                    ? `$${(amountUsd / 100).toFixed(2)} (≈ ${amountVnd.toLocaleString("vi-VN")}đ)`
                    : `${amountVnd.toLocaleString("vi-VN")}đ`
                }
                copyable
                copied={copied.amount}
                onCopy={() => copy(String(amountVnd), "amount")}
                strong
              />
              <Row
                label={t("payment.refCode")}
                value={refCode}
                copyable
                copied={copied.ref}
                onCopy={() => copy(refCode, "ref")}
                strong
                accent
              />
            </div>

            {/* Important note */}
            <div style={{
              padding: 12, borderRadius: 8,
              background: "rgba(251,191,36,0.10)",
              border: "1px solid rgba(251,191,36,0.30)",
              fontSize: 11.5, lineHeight: 1.55, color: "var(--n-9)",
              marginBottom: 14,
            }}>
              <b style={{ color: "#f59e0b" }}>⚠ {t("payment.importantTitle")}</b>{" "}
              {t("payment.importantBody", { ref: refCode })}
            </div>

            <button
              onClick={close}
              style={{
                width: "100%", padding: "11px", borderRadius: 8,
                background: "linear-gradient(135deg, var(--accent), #ec4899)",
                color: "#fff", border: "none",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                boxShadow: "0 4px 14px rgba(124,92,255,0.35)",
              }}
            >
              {t("payment.didTransfer")}
            </button>
            <p style={{
              margin: "10px 0 0", textAlign: "center",
              fontSize: 11, color: "var(--n-7)", lineHeight: 1.5,
            }}>
              {t("payment.afterTransferHint")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, copyable, copied, onCopy, strong, accent }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
      <span style={{ flex: "0 0 100px", color: "var(--n-7)" }}>{label}</span>
      <span style={{
        flex: 1, fontFamily: copyable ? "var(--font-mono, monospace)" : "inherit",
        fontWeight: strong ? 700 : 500,
        fontSize: strong ? 14 : 12.5,
        color: accent ? "var(--accent)" : "var(--n-10)",
        wordBreak: "break-all",
      }}>
        {value || "—"}
      </span>
      {copyable && value && (
        <button
          onClick={onCopy}
          style={{
            padding: 6, borderRadius: 5,
            background: "transparent", border: "1px solid var(--n-3)",
            color: copied ? "#22c55e" : "var(--n-7)",
            cursor: "pointer", display: "inline-flex", alignItems: "center",
            transition: "all 0.12s",
          }}
          title="Copy"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      )}
    </div>
  );
}
