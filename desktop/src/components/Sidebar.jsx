import { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Mic, AudioLines, Library, Clock, Settings,
  PanelLeftOpen, PanelLeftClose, Film,
} from "lucide-react";
import UserMenu from "./UserMenu";
import { useT } from "../i18n/I18nContext";
import { useAuth } from "../auth/AuthContext";

const COLLAPSED_W = 56;
const EXPANDED_W = 210;

export default function Sidebar() {
  const t = useT();
  const { isAuthenticated } = useAuth();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);

  const expanded = pinned || hovered;
  const width = expanded ? EXPANDED_W : COLLAPSED_W;

  // Main nav (primary actions at top)
  const nav = [
    { to: "/", icon: AudioLines, label: t("nav.tts") },
    { to: "/dubbing", icon: Film, label: t("nav.dubbing") },
    { to: "/clone", icon: Mic, label: t("nav.clone") },
    { to: "/library", icon: Library, label: t("nav.library") },
    { to: "/history", icon: Clock, label: t("nav.history") },
  ];

  return (
    <>
      {/* Spacer reserves the collapsed width so main content does not shift */}
      <div className="flex-shrink-0" style={{ width: COLLAPSED_W }} />

      <aside
        className="fixed top-0 left-0 h-screen flex flex-col z-20 transition-all duration-200"
        style={{
          width,
          background: "var(--bg-surface)",
          borderRight: "1px solid #2a2a40",
          boxShadow: expanded && !pinned ? "4px 0 24px rgba(0,0,0,.4)" : "none",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Header: brand + pin */}
        <div className="flex items-center px-3 py-4" style={{ minHeight: 56, gap: 8 }}>
          {expanded ? (
            <div className="flex-1 pl-1 overflow-hidden whitespace-nowrap">
              <h1 className="text-lg font-bold leading-tight"
                  style={{ color: "var(--accent)" }}>
                {t("brand.name")}
              </h1>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {t("brand.tagline")}
              </p>
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <button
            onClick={() => setPinned((p) => !p)}
            className="p-1.5 rounded-md flex-shrink-0 transition-colors hover:bg-white/5"
            style={{ color: "var(--text-secondary)" }}
            title={pinned ? t("sidebar.collapse") : t("sidebar.expand")}
          >
            {pinned ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
        </div>

        {/* Main nav — grows to fill */}
        <nav className="flex-1 px-2 mt-1 overflow-y-auto">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavItem key={to} to={to} Icon={Icon} label={label} expanded={expanded} />
          ))}
        </nav>

        {/* Bottom section — settings + user, pinned to bottom (Claude-style) */}
        <div className="mt-auto border-t px-2 pt-2 pb-3 space-y-1"
             style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <NavItem
            to="/settings"
            Icon={Settings}
            label={t("nav.settings")}
            expanded={expanded}
          />
          {isAuthenticated && <UserMenu expanded={expanded} />}
        </div>
      </aside>
    </>
  );
}

function NavItem({ to, Icon, label, expanded }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `flex items-center rounded-lg mb-1 text-sm transition-all duration-150 ${isActive ? "font-medium" : "hover:opacity-80"}`
      }
      style={({ isActive }) => ({
        background: isActive ? "var(--accent)" : "transparent",
        color: isActive ? "#fff" : "var(--text-secondary)",
        padding: expanded ? "10px 12px" : "10px 0",
        justifyContent: expanded ? "flex-start" : "center",
        gap: expanded ? 10 : 0,
      })}
      title={label}
    >
      <Icon size={18} className="flex-shrink-0" />
      {expanded && <span className="whitespace-nowrap overflow-hidden">{label}</span>}
    </NavLink>
  );
}
