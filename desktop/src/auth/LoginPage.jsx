import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mic, Loader2 } from "lucide-react";
import { useAuth } from "./AuthContext";
import { useT } from "../i18n/I18nContext";

export default function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const { login, loading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

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
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl mb-3"
               style={{ background: "var(--accent)" }}>
            <Mic size={24} color="#fff" />
          </div>
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
                        style={{ color: "var(--accent)" }}>
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
    </div>
  );
}
