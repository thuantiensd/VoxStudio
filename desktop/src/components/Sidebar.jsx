import { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Mic, AudioLines, Library, Clock,
  PanelLeftOpen, PanelLeftClose, Film,
} from "lucide-react";
import UserMenu from "./UserMenu";
import { useT } from "../i18n/I18nContext";
import { useAuth } from "../auth/AuthContext";

const COLLAPSED_W = 56;
const EXPANDED_W = 220;

// Extra top spacing so macOS traffic lights don't overlap the brand area.
// The Electron window uses `trafficLightPosition: { x: 16, y: 16 }`, so we
// push the sidebar content down when running on macOS.
const IS_MAC =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
const HEADER_TOP = IS_MAC ? 38 : 12;

export default function Sidebar() {
  const t = useT();
  const { isAuthenticated } = useAuth();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);

  const expanded = pinned || hovered;
  const width = expanded ? EXPANDED_W : COLLAPSED_W;

  // Main nav (primary actions at top). Settings lives in the UserMenu popover
  // at the bottom (Claude-style), not as a separate sidebar entry.
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
          // Make the entire sidebar draggable on macOS so user can drag the
          // window by the empty sidebar area (like Claude). Buttons below
          // override this back to non-draggable.
          WebkitAppRegion: "drag",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Header: brand + pin — extra top padding on Mac to clear traffic lights */}
        <div
          className="flex items-center px-3"
          style={{
            minHeight: 56,
            paddingTop: HEADER_TOP,
            paddingBottom: 12,
            gap: 8,
          }}
        >
          {expanded ? (
            <div className="flex-1 pl-1 overflow-hidden whitespace-nowrap">
              <h1
                className="text-base font-bold leading-tight tracking-tight"
                style={{ color: "var(--accent)" }}
              >
                {t("brand.name")}
              </h1>
              <p
                className="text-[11px] leading-tight mt-0.5"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("brand.tagline")}
              </p>
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <button
            onClick={() => setPinned((p) => !p)}
            className="p-1.5 rounded-md flex-shrink-0 transition-colors hover:bg-white/5"
            style={{ color: "var(--text-secondary)", WebkitAppRegion: "no-drag" }}
            title={pinned ? t("sidebar.collapse") : t("sidebar.expand")}
          >
            {pinned ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
        </div>

        {/* Main nav — grows to fill */}
        <nav
          className="flex-1 px-2 mt-1 overflow-y-auto"
          style={{ WebkitAppRegion: "no-drag" }}
        >
          {nav.map(({ to, icon: Icon, label }) => (
            <NavItem key={to} to={to} Icon={Icon} label={label} expanded={expanded} />
          ))}
        </nav>

        {/* Bottom — user menu ONLY (Claude-style: Settings lives inside the popover) */}
        <div
          className="mt-auto border-t px-2 pt-2 pb-3"
          style={{
            borderColor: "rgba(255,255,255,0.06)",
            WebkitAppRegion: "no-drag",
          }}
        >
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
