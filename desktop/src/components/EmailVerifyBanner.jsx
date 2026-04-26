import { useState } from "react";
import { Mail, X, Loader2 } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "./ui/Toast";
import { useT } from "../i18n/I18nContext";
import { resendVerificationEmail } from "../services/api";

/**
 * Banner top-of-page nhắc user verify email. Dismissible (chỉ ẩn trong
 * session hiện tại — refresh hiện lại). Admin được auto-verified nên
 * không thấy banner.
 */
export default function EmailVerifyBanner() {
  const t = useT();
  const toast = useToast();
  const { user } = useAuth() || {};
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);

  if (!user) return null;
  if (user.email_verified) return null;
  if (dismissed) return null;

  const onResend = async () => {
    setSending(true);
    try {
      await resendVerificationEmail();
      toast.success(t("verifyBanner.sent", { email: user.email }));
    } catch (e) {
      toast.error(e?.message || "Error", { title: t("verifyBanner.sendFailed") });
    }
    setSending(false);
  };

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 16px",
        background: "linear-gradient(90deg, rgba(251,191,36,0.14), rgba(251,191,36,0.06))",
        borderBottom: "1px solid rgba(251,191,36,0.25)",
        fontSize: 12.5, color: "var(--n-10)",
        flexShrink: 0,
      }}
    >
      <Mail size={14} style={{ color: "#f59e0b", flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <b>{t("verifyBanner.title")}</b>
        <span style={{ color: "var(--n-8)", marginLeft: 6 }}>
          {t("verifyBanner.body", { email: user.email })}
        </span>
      </span>
      <button
        onClick={onResend}
        disabled={sending}
        style={{
          padding: "4px 10px", borderRadius: 6,
          background: "var(--accent)", color: "#fff", border: "none",
          fontSize: 11.5, fontWeight: 600, cursor: sending ? "wait" : "pointer",
          fontFamily: "inherit",
          display: "inline-flex", alignItems: "center", gap: 4,
        }}
      >
        {sending && <Loader2 size={11} className="animate-spin" />}
        {t("verifyBanner.resend")}
      </button>
      <button
        onClick={() => setDismissed(true)}
        title={t("aria.close")}
        style={{
          background: "transparent", border: "none", cursor: "pointer",
          color: "var(--n-7)", padding: 2,
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}
