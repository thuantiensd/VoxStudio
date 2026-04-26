import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Mail, X, Check } from "lucide-react";
import logoUrl from "../assets/logo.svg";
import { useAuth } from "./AuthContext";
import { useT } from "../i18n/I18nContext";
import { forgotPassword, resetPasswordWithOtp } from "../services/api";
import OtpInput from "../components/ui/OtpInput";

export default function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const { login, loading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      await login({ email, password });
      navigate("/");
    } catch (e) {
      // Backend returns Vietnamese detail — use it directly
      setError(e?.message || t("auth.login.errors.invalid"));
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4 py-12"
         style={{ background: "var(--bg-base)" }}>
      <div className="w-full max-w-md">
        {/* Brand header */}
        <div className="mb-8 text-center">
          <img
            src={logoUrl}
            alt="VoxStudio"
            width={56}
            height={56}
            className="mb-3 mx-auto block"
            style={{ filter: "drop-shadow(0 8px 20px rgba(108, 92, 231, 0.35))" }}
          />
          <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("brand.name")}
          </h1>
        </div>

        <div className="rounded-xl p-6 border"
             style={{ background: "var(--bg-surface)", borderColor: "#2a2a40" }}>
          <div className="mb-5">
            <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
              {t("auth.login.title")}
            </h2>
            <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
              {t("auth.login.subtitle")}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5"
                     style={{ color: "var(--text-primary)" }}>
                {t("auth.login.emailLabel")}
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("auth.login.emailPlaceholder")}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors"
                style={{
                  background: "var(--bg-base)",
                  color: "var(--text-primary)",
                  border: "1px solid #2a2a40",
                }}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium"
                       style={{ color: "var(--text-primary)" }}>
                  {t("auth.login.passwordLabel")}
                </label>
                <button type="button" className="text-xs hover:underline"
                        style={{ color: "var(--accent)" }}
                        onClick={() => setForgotOpen(true)}>
                  {t("auth.login.forgotPassword")}
                </button>
              </div>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.login.passwordPlaceholder")}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{
                  background: "var(--bg-base)",
                  color: "var(--text-primary)",
                  border: "1px solid #2a2a40",
                }}
              />
            </div>

            {error && (
              <div className="text-sm rounded-md px-3 py-2"
                   style={{ background: "rgba(239,68,68,0.1)", color: "#f87171" }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {t("auth.login.submit")}
            </button>
          </form>

          <div className="mt-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
            {t("auth.login.noAccount")}{" "}
            <Link to="/signup" className="font-medium hover:underline"
                  style={{ color: "var(--accent)" }}>
              {t("auth.login.signupLink")}
            </Link>
          </div>
        </div>
      </div>

      <ForgotPasswordModal
        open={forgotOpen}
        onClose={() => setForgotOpen(false)}
        defaultEmail={email}
      />
    </div>
  );
}

/* ─── Forgot password — 3 step modal: email → OTP+newPw → done ─── */
function ForgotPasswordModal({ open, onClose, defaultEmail }) {
  const t = useT();
  const [step, setStep] = useState("email");  // 'email' | 'reset' | 'done'
  const [email, setEmail] = useState(defaultEmail || "");
  const [code, setCode] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const close = () => {
    if (busy) return;
    setStep("email"); setEmail(defaultEmail || ""); setCode("");
    setNewPw(""); setNewPw2(""); setError("");
    onClose();
  };

  const submitEmail = async (e) => {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await forgotPassword(email.trim());
      setStep("reset");
    } catch (err) {
      setError(err?.message || "Error");
    }
    setBusy(false);
  };

  const submitReset = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    if (code.length !== 6) { setError(t("forgotPw.errCodeLen")); return; }
    if (newPw.length < 8) { setError(t("forgotPw.errPwShort")); return; }
    if (newPw !== newPw2) { setError(t("forgotPw.errPwMismatch")); return; }
    setBusy(true); setError("");
    try {
      await resetPasswordWithOtp({ email: email.trim(), code, newPassword: newPw });
      setStep("done");
    } catch (err) {
      setError(err?.message || "Error");
    }
    setBusy(false);
  };

  const inputStyle = {
    width: "100%", boxSizing: "border-box",
    padding: "10px 12px", borderRadius: 7,
    background: "var(--bg-surface, #0f0f1e)",
    border: "1px solid #2a2a40",
    color: "var(--text-primary, #fff)", fontSize: 13,
    marginBottom: 10,
  };
  const primaryBtn = {
    width: "100%", padding: "10px", borderRadius: 8,
    background: "var(--accent)", color: "#fff", border: "none",
    fontSize: 13, fontWeight: 600, cursor: busy ? "wait" : "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    opacity: busy ? 0.6 : 1,
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div style={{
        width: "100%", maxWidth: 460,
        background: "var(--bg-card, #1a1a2e)",
        border: "1px solid #2a2a40",
        borderRadius: 12, padding: 28,
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--text-primary, #fff)" }}>
            {step === "done" ? t("forgotPw.doneTitle") : t("forgotPw.title")}
          </h2>
          <button onClick={close} disabled={busy}
            style={{ background: "transparent", border: "none", cursor: "pointer",
                     color: "var(--text-secondary, #888)", padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {step === "email" && (
          <form onSubmit={submitEmail}>
            <p style={{ fontSize: 13, lineHeight: 1.55,
                        color: "var(--text-secondary, #888)", margin: "0 0 16px" }}>
              {t("forgotPw.body")}
            </p>
            <input
              type="email" required autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.login.emailPlaceholder")}
              style={inputStyle}
            />
            {error && (
              <div style={{ fontSize: 12, color: "var(--danger, #ef4444)", marginBottom: 10 }}>
                {error}
              </div>
            )}
            <button type="submit" disabled={busy || !email.trim()} style={primaryBtn}>
              {busy && <Loader2 size={14} className="animate-spin" />}
              {t("forgotPw.send")}
            </button>
          </form>
        )}

        {step === "reset" && (
          <form onSubmit={submitReset}>
            <p style={{ fontSize: 13, lineHeight: 1.55,
                        color: "var(--text-secondary, #888)", margin: "0 0 6px" }}>
              {t("forgotPw.codeBody", { email })}
            </p>
            <p style={{ fontSize: 11.5, color: "var(--text-secondary, #888)", margin: "0 0 14px" }}>
              {t("forgotPw.spamHint")}
            </p>

            <OtpInput
              value={code}
              onChange={setCode}
              autoFocus
              disabled={busy}
            />

            <div style={{ marginTop: 16 }}>
              <input
                type="password" minLength={8} required
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder={t("forgotPw.newPwPlaceholder")}
                style={inputStyle}
              />
              <input
                type="password" minLength={8} required
                value={newPw2}
                onChange={(e) => setNewPw2(e.target.value)}
                placeholder={t("forgotPw.confirmPwPlaceholder")}
                style={inputStyle}
              />
            </div>

            {error && (
              <div style={{ fontSize: 12, color: "var(--danger, #ef4444)", marginBottom: 10 }}>
                {error}
              </div>
            )}
            <button type="submit"
              disabled={busy || code.length !== 6 || !newPw || !newPw2}
              style={primaryBtn}>
              {busy && <Loader2 size={14} className="animate-spin" />}
              {t("forgotPw.resetBtn")}
            </button>
            <button type="button"
              onClick={() => { setStep("email"); setError(""); }}
              disabled={busy}
              style={{
                width: "100%", padding: "8px", marginTop: 8,
                background: "transparent", color: "var(--text-secondary, #888)",
                border: "none", fontSize: 12, cursor: "pointer",
              }}>
              ← {t("forgotPw.backEmail")}
            </button>
          </form>
        )}

        {step === "done" && (
          <div style={{ textAlign: "center", padding: "8px 4px" }}>
            <div style={{
              width: 56, height: 56, borderRadius: "50%",
              background: "rgba(34,197,94,0.15)", color: "#22c55e",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              marginBottom: 14,
            }}>
              <Check size={24} />
            </div>
            <p style={{ fontSize: 14, fontWeight: 600,
                        color: "var(--text-primary, #fff)", margin: "0 0 6px" }}>
              {t("forgotPw.doneTitle")}
            </p>
            <p style={{ fontSize: 12.5, lineHeight: 1.55,
                        color: "var(--text-secondary, #888)", margin: "0 0 18px" }}>
              {t("forgotPw.doneBody")}
            </p>
            <button onClick={close} style={primaryBtn}>
              {t("forgotPw.backToLogin")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
