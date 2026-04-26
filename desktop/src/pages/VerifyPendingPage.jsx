import { useState } from "react";
import { Mail, Loader2, LogOut } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useT } from "../i18n/I18nContext";
import { useToast } from "../components/ui/Toast";
import { resendVerificationEmail, verifyEmailOtp } from "../services/api";
import OtpInput from "../components/ui/OtpInput";

/**
 * Hard-gate page khi user chưa verify email. Nhập OTP 6 chữ số nhận
 * từ email → submit → server verify → refreshUser → vào Shell.
 */
export default function VerifyPendingPage() {
  const t = useT();
  const toast = useToast();
  const { user, logout, refreshUser } = useAuth() || {};
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");

  // Cooldown đếm ngược
  if (cooldown > 0) {
    setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
  }

  const submit = async (codeToSend) => {
    if (verifying) return;
    setVerifying(true); setError("");
    try {
      await verifyEmailOtp(codeToSend);
      // Server đã mark verified → refresh user state để ProtectedRoute cho qua
      if (refreshUser) await refreshUser();
      else window.location.reload();
    } catch (e) {
      setError(e?.message || t("verifyPending.invalidCode"));
      setCode("");
    }
    setVerifying(false);
  };

  const onResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true); setError("");
    try {
      await resendVerificationEmail();
      toast.success(t("verifyPending.resentSuccess", { email: user?.email || "" }));
      setCooldown(60);
      setCode("");
    } catch (e) {
      const msg = e?.message || "";
      const m = msg.match(/đợi (\d+)s/);
      if (m) setCooldown(parseInt(m[1], 10));
      toast.error(msg, { title: t("verifyBanner.sendFailed") });
    }
    setResending(false);
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "var(--n-0)", padding: 24,
    }}>
      <div style={{
        maxWidth: 460, width: "100%",
        background: "var(--n-1)",
        border: "1px solid var(--n-3)",
        borderRadius: 14,
        padding: "32px 28px",
        textAlign: "center",
        boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: "50%",
          background: "linear-gradient(135deg, var(--accent-soft), rgba(236,72,153,0.18))",
          border: "1px solid var(--accent-ring)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 18px",
        }}>
          <Mail size={28} style={{ color: "var(--accent)" }} />
        </div>

        <h1 style={{
          margin: "0 0 8px", fontSize: 22, fontWeight: 700,
          color: "var(--n-10)", letterSpacing: "-0.01em",
        }}>
          {t("verifyPending.title")}
        </h1>

        <p style={{
          margin: "0 0 6px", fontSize: 13.5, lineHeight: 1.55,
          color: "var(--n-8)",
        }}>
          {t("verifyPending.bodyOtp")}
        </p>

        <div style={{
          margin: "10px 0 22px",
          fontSize: 13, fontWeight: 600, color: "var(--n-10)",
          fontFamily: "var(--font-mono, monospace)",
          wordBreak: "break-all",
        }}>
          {user?.email || ""}
        </div>

        <OtpInput
          value={code}
          onChange={(v) => { setCode(v); setError(""); }}
          onComplete={(c) => submit(c)}
          autoFocus
          disabled={verifying}
        />

        {error && (
          <div style={{
            marginTop: 12, fontSize: 12.5, color: "var(--err)",
          }}>
            {error}
          </div>
        )}

        {verifying && (
          <div style={{
            marginTop: 14, display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 12.5, color: "var(--n-8)",
          }}>
            <Loader2 size={13} className="animate-spin" />
            {t("verifyPending.verifying")}
          </div>
        )}

        <p style={{
          margin: "20px 0 12px", fontSize: 12, lineHeight: 1.55,
          color: "var(--n-7)",
        }}>
          {t("verifyPending.spamHint")}
        </p>

        <button
          onClick={onResend}
          disabled={cooldown > 0 || resending}
          style={{
            padding: "8px 16px", borderRadius: 8,
            background: "transparent",
            color: "var(--accent)",
            border: "none",
            fontSize: 12.5, fontWeight: 600,
            cursor: (cooldown > 0 || resending) ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            opacity: (cooldown > 0 || resending) ? 0.55 : 1,
          }}
        >
          {resending && <Loader2 size={12} className="animate-spin" style={{ display: "inline", marginRight: 6, verticalAlign: "-2px" }} />}
          {cooldown > 0
            ? t("verifyPending.resendCooldown", { s: cooldown })
            : t("verifyPending.resend")}
        </button>

        <div style={{ height: 1, background: "var(--n-3)", margin: "16px 0 12px" }} />

        <button
          onClick={() => logout?.()}
          style={{
            padding: "6px 12px", borderRadius: 8,
            background: "transparent",
            color: "var(--n-7)",
            border: "none",
            fontSize: 12, fontWeight: 500,
            cursor: "pointer", fontFamily: "inherit",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}
        >
          <LogOut size={12} /> {t("verifyPending.signOut")}
        </button>
      </div>
    </div>
  );
}
