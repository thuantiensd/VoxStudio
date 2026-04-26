import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Check, ArrowRight } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useT } from "../i18n/I18nContext";
import { userStorage } from "../services/userScope";

const SEEN_KEY = "voxstudio:welcome:seen";

/**
 * Welcome modal — hiện 1 lần lúc user đăng nhập lần đầu (per device,
 * scope per-user qua userStorage). Highlight free tier value + soft CTA
 * tới trang Plans, không chặn user.
 */
export default function WelcomeModal() {
  const t = useT();
  const nav = useNavigate();
  const { user } = useAuth() || {};
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    // Admin auto-verified → có thể là dev/owner, không cần welcome
    if (user.role === "admin") return;
    try {
      if (userStorage.getItem(SEEN_KEY)) return;
    } catch {}
    setOpen(true);
  }, [user]);

  const dismiss = () => {
    try { userStorage.setItem(SEEN_KEY, "1"); } catch {}
    setOpen(false);
  };

  const goPlans = () => {
    dismiss();
    nav("/settings", { state: { tab: "plans" } });
  };

  if (!open) return null;

  const perks = [
    t("welcome.perk1"),
    t("welcome.perk2"),
    t("welcome.perk3"),
    t("welcome.perk4"),
  ];

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
        animation: "vsFadeIn 0.18s ease-out",
      }}
    >
      <style>{`
        @keyframes vsFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes vsSheetIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 480,
          background: "var(--n-1)",
          border: "1px solid var(--n-3)",
          borderRadius: 16,
          padding: "32px 28px",
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
          animation: "vsSheetIn 0.24s cubic-bezier(0.22, 1, 0.36, 1)",
          textAlign: "center",
        }}
      >
        {/* Hero icon + emoji */}
        <div style={{
          width: 72, height: 72, borderRadius: "50%",
          background: "linear-gradient(135deg, var(--accent-soft), rgba(236,72,153,0.18))",
          border: "1px solid var(--accent-ring)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 18px",
          fontSize: 36,
        }}>
          🎉
        </div>

        <h1 style={{
          margin: "0 0 8px", fontSize: 22, fontWeight: 700,
          color: "var(--n-10)", letterSpacing: "-0.01em",
        }}>
          {(() => {
            const firstName = (user?.name || "").trim().split(/\s+/).pop() || "";
            return firstName
              ? t("welcome.title", { name: firstName })
              : t("welcome.titleNoName");
          })()}
        </h1>

        <p style={{
          margin: "0 0 22px", fontSize: 13.5, lineHeight: 1.55,
          color: "var(--n-8)",
        }}>
          {t("welcome.subtitle")}
        </p>

        {/* Free tier perks */}
        <div style={{
          textAlign: "left",
          padding: "14px 16px",
          background: "var(--n-2)",
          border: "1px solid var(--n-3)",
          borderRadius: 10,
          marginBottom: 18,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
            textTransform: "uppercase", color: "var(--n-7)",
            marginBottom: 10,
          }}>
            {t("welcome.freeIncludes")}
          </div>
          {perks.map((perk, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              fontSize: 13, lineHeight: 1.55, color: "var(--n-9)",
              marginBottom: i < perks.length - 1 ? 6 : 0,
            }}>
              <Check size={14} style={{ color: "#22c55e", flexShrink: 0, marginTop: 2 }} />
              <span>{perk}</span>
            </div>
          ))}
        </div>

        {/* Upgrade hint */}
        <p style={{
          margin: "0 0 20px", fontSize: 12.5, lineHeight: 1.55,
          color: "var(--n-7)",
        }}>
          {t("welcome.upgradeHint")}
        </p>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={goPlans}
            style={{
              flex: "0 0 auto", padding: "11px 18px", borderRadius: 8,
              background: "transparent", color: "var(--n-9)",
              border: "1px solid var(--n-3)",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
              fontFamily: "inherit",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            <Sparkles size={13} /> {t("welcome.viewPlans")}
          </button>
          <button
            onClick={dismiss}
            style={{
              flex: 1, padding: "11px 18px", borderRadius: 8,
              background: "linear-gradient(135deg, var(--accent), #ec4899)",
              color: "#fff", border: "none",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit",
              boxShadow: "0 4px 14px rgba(124,92,255,0.35)",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            {t("welcome.startNow")} <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
