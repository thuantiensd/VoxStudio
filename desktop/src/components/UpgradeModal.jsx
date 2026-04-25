import { useNavigate } from "react-router-dom";
import { Sparkles, Zap, Crown, Check } from "lucide-react";
import Modal from "./ui/Modal";
import { useT } from "../i18n/I18nContext";

/**
 * UpgradeModal — paywall dialog hiện khi user chạm hạn mức (quota / 402 /
 * 429). Có CTA chuyển sang tab Plans để nâng cấp. Không tự ý nav — đợi
 * user bấm.
 *
 * Props:
 *   open: bool
 *   onClose(): đóng (user chọn "Để sau")
 *   reason?: string — message cụ thể từ server (nếu có), thay cho body mặc định
 */
export default function UpgradeModal({ open, onClose, reason }) {
  const t = useT();
  const nav = useNavigate();

  const goUpgrade = () => {
    onClose?.();
    nav("/settings", { state: { tab: "plans" } });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={460}
      title={null}
    >
      <div style={{ padding: "8px 4px 4px" }}>
        {/* Hero icon */}
        <div style={{
          width: 56, height: 56, borderRadius: "50%",
          background: "linear-gradient(135deg, var(--accent-soft), rgba(236,72,153,0.18))",
          border: "1px solid var(--accent-ring)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 16px",
        }}>
          <Crown size={26} style={{ color: "var(--accent)" }} />
        </div>

        <h2 style={{
          margin: 0, textAlign: "center",
          fontSize: 18, fontWeight: 700,
          color: "var(--n-10)", letterSpacing: "-0.01em",
        }}>
          {t("upgradeModal.title")}
        </h2>

        <p style={{
          margin: "10px 0 18px", textAlign: "center",
          fontSize: 13, lineHeight: 1.55, color: "var(--n-8)",
        }}>
          {reason || t("upgradeModal.body")}
        </p>

        {/* Perks list */}
        <div style={{
          background: "var(--n-1)",
          border: "1px solid var(--n-3)",
          borderRadius: 8,
          padding: "12px 14px",
          marginBottom: 16,
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          {[
            { icon: Sparkles, label: t("upgradeModal.perks1") },
            { icon: Zap,      label: t("upgradeModal.perks2") },
            { icon: Check,    label: t("upgradeModal.perks3") },
          ].map((p, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 10,
              fontSize: 12.5, color: "var(--n-9)",
            }}>
              <p.icon size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
              <span>{p.label}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              flex: "0 0 auto", padding: "10px 16px", borderRadius: 8,
              background: "transparent", color: "var(--n-8)",
              border: "1px solid var(--n-3)",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {t("upgradeModal.later")}
          </button>
          <button
            onClick={goUpgrade}
            style={{
              flex: 1, padding: "10px 16px", borderRadius: 8,
              background: "linear-gradient(135deg, var(--accent), #ec4899)",
              color: "#fff", border: "none",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit",
              boxShadow: "0 4px 14px rgba(124,92,255,0.35)",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            <Sparkles size={14} /> {t("upgradeModal.upgrade")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
