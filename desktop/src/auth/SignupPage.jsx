import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "./AuthContext";
import { useT } from "../i18n/I18nContext";

export default function SignupPage() {
  const t = useT();
  const navigate = useNavigate();
  const { signup, loading } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      await signup({ name, email, password });
      navigate("/");
    } catch (e) {
      setError(e?.message || t("auth.login.errors.invalid"));
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4 py-12"
         style={{ background: "var(--bg-base)" }}>
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <img
            src="/favicon.svg"
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
              {t("auth.signup.title")}
            </h2>
            <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
              {t("auth.signup.subtitle")}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5"
                     style={{ color: "var(--text-primary)" }}>
                {t("auth.signup.nameLabel")}
              </label>
              <input
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("auth.signup.namePlaceholder")}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{
                  background: "var(--bg-base)",
                  color: "var(--text-primary)",
                  border: "1px solid #2a2a40",
                }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5"
                     style={{ color: "var(--text-primary)" }}>
                {t("auth.signup.emailLabel")}
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("auth.signup.emailPlaceholder")}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{
                  background: "var(--bg-base)",
                  color: "var(--text-primary)",
                  border: "1px solid #2a2a40",
                }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5"
                     style={{ color: "var(--text-primary)" }}>
                {t("auth.signup.passwordLabel")}
              </label>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.signup.passwordPlaceholder")}
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
              className="w-full rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {t("auth.signup.submit")}
            </button>

            <p className="text-xs text-center"
               style={{ color: "var(--text-secondary)" }}>
              {t("auth.signup.termsNotice")}{" "}
              <a href="#" className="hover:underline" style={{ color: "var(--accent)" }}>
                {t("auth.signup.terms")}
              </a>{" "}
              {t("auth.signup.and")}{" "}
              <a href="#" className="hover:underline" style={{ color: "var(--accent)" }}>
                {t("auth.signup.privacy")}
              </a>
              .
            </p>
          </form>

          <div className="mt-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
            {t("auth.signup.haveAccount")}{" "}
            <Link to="/login" className="font-medium hover:underline"
                  style={{ color: "var(--accent)" }}>
              {t("auth.signup.loginLink")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
