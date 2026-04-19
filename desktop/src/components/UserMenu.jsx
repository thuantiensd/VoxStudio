import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  User, Settings, CreditCard, Globe, LogOut, ChevronRight,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useI18n, useT } from "../i18n/I18nContext";

/**
 * UserMenu — button at the bottom of the sidebar.
 * Expanded sidebar: shows avatar + name + plan, clicking opens a popover.
 * Collapsed sidebar: shows just avatar, click opens popover to the right.
 */
export default function UserMenu({ expanded }) {
  const t = useT();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { locale, setLocale, locales } = useI18n();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const btnRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (
        menuRef.current && !menuRef.current.contains(e.target) &&
        btnRef.current && !btnRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!user) return null;

  const initials = (user.name || user.email || "?")
    .split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();

  const planLabel =
    user.plan === "pro" ? t("auth.plan.pro") :
    user.plan === "business" ? t("auth.plan.business") :
    t("auth.plan.free");

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center rounded-lg transition-colors"
        style={{
          padding: expanded ? "8px 10px" : "8px 0",
          justifyContent: expanded ? "flex-start" : "center",
          gap: expanded ? 10 : 0,
          background: open ? "rgba(255,255,255,0.05)" : "transparent",
        }}
        title={user.name || user.email}
      >
        <div
          className="flex-shrink-0 rounded-full flex items-center justify-center text-xs font-semibold"
          style={{
            width: 28, height: 28,
            background: "linear-gradient(135deg, var(--accent), #5b6cff)",
            color: "#fff",
          }}
        >
          {initials}
        </div>
        {expanded && (
          <div className="flex-1 min-w-0 text-left">
            <div className="text-sm font-medium truncate"
                 style={{ color: "var(--text-primary)" }}>
              {user.name || user.email}
            </div>
            <div className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
              {planLabel}
            </div>
          </div>
        )}
        {expanded && <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />}
      </button>

      {open && (
        <div
          ref={menuRef}
          className="absolute z-40 rounded-lg shadow-xl border overflow-hidden"
          style={{
            bottom: expanded ? "calc(100% + 4px)" : "0",
            left: expanded ? 0 : "calc(100% + 8px)",
            minWidth: 240,
            background: "var(--bg-surface)",
            borderColor: "#2a2a40",
          }}
        >
          {/* Header: email */}
          <div className="px-3 py-2.5 border-b" style={{ borderColor: "#2a2a40" }}>
            <div className="text-sm font-medium truncate"
                 style={{ color: "var(--text-primary)" }}>
              {user.name || user.email}
            </div>
            {user.email && user.name && (
              <div className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                {user.email}
              </div>
            )}
            <span className="inline-block mt-1.5 text-xs px-2 py-0.5 rounded"
                  style={{ background: "rgba(91,108,255,0.15)", color: "var(--accent)" }}>
              {planLabel}
            </span>
          </div>

          {/* Items */}
          <MenuItem
            icon={User}
            label={t("user.accountSettings")}
            onClick={() => { setOpen(false); navigate("/settings"); }}
          />
          <MenuItem
            icon={CreditCard}
            label={t("user.billing")}
            onClick={() => { setOpen(false); navigate("/billing"); }}
          />

          <div className="border-t" style={{ borderColor: "#2a2a40" }} />

          {/* Language submenu — inline radio list */}
          <div className="px-3 py-2">
            <div className="flex items-center gap-2 text-xs mb-1.5"
                 style={{ color: "var(--text-secondary)" }}>
              <Globe size={12} />
              <span>{t("user.language")}</span>
            </div>
            <div className="flex gap-1">
              {locales.map((loc) => (
                <button
                  key={loc}
                  onClick={() => setLocale(loc)}
                  className="flex-1 text-xs rounded px-2 py-1 transition-colors"
                  style={{
                    background: locale === loc ? "var(--accent)" : "transparent",
                    color: locale === loc ? "#fff" : "var(--text-secondary)",
                    border: "1px solid " + (locale === loc ? "var(--accent)" : "#2a2a40"),
                  }}
                >
                  {loc === "vi" ? "Tiếng Việt" : "English"}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t" style={{ borderColor: "#2a2a40" }} />

          <MenuItem
            icon={LogOut}
            label={t("user.signOut")}
            onClick={() => { setOpen(false); logout(); navigate("/login"); }}
            danger
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className="w-full px-3 py-2 flex items-center gap-2.5 text-sm text-left hover:bg-white/5 transition-colors"
      style={{ color: danger ? "#f87171" : "var(--text-primary)" }}
    >
      <Icon size={15} style={{ color: danger ? "#f87171" : "var(--text-secondary)" }} />
      <span>{label}</span>
    </button>
  );
}
