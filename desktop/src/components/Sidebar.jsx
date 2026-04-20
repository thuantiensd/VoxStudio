import { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Mic, AudioLines, Library, Clock,
  PanelLeftOpen, PanelLeftClose, Film,
} from "lucide-react";
import UserMenu from "./UserMenu";
import { useT } from "../i18n/I18nContext";
import { useAuth } from "../auth/AuthContext";

const COLLAPSED_W = 64;
const EXPANDED_W = 240;

const IS_MAC =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
const HEADER_TOP = IS_MAC ? 40 : 14;

// Brand mark — matches the landing-page header: compact rounded-md square
// with a mic icon in primary color. Keeps the app visually consistent with
// the public VoxStudio mark.
function BrandMark({ size = 32 }) {
  return (
    <div
      className="flex-shrink-0 rounded-md flex items-center justify-center"
      style={{
        width: size,
        height: size,
        background: "var(--accent)",
      }}
    >
      <Mic size={size * 0.55} color="#fff" strokeWidth={2.2} />
    </div>
  );
}

export default function Sidebar() {
  const t = useT();
  const { isAuthenticated } = useAuth();
  // Expand is ONLY controlled by the pin button click — no hover-expand.
  // This matches Claude Code behavior and eliminates all jitter on Electron.
  const [pinned, setPinned] = useState(false);

  const expanded = pinned;
  const width = expanded ? EXPANDED_W : COLLAPSED_W;

  const nav = [
    { to: "/", icon: AudioLines, label: t("nav.tts") },
    { to: "/studio", icon: Film, label: t("nav.dubbing") },
    { to: "/clone", icon: Mic, label: t("nav.clone") },
    { to: "/library", icon: Library, label: t("nav.library") },
    { to: "/history", icon: Clock, label: t("nav.history") },
  ];

  return (
    <>
      {/* Spacer reserves the full width so the main content never overlaps */}
      <div
        className="flex-shrink-0 transition-[width] duration-200"
        style={{ width }}
      />

      <aside
        className="fixed top-0 left-0 h-screen flex flex-col z-20 transition-[width] duration-200"
        style={{
          width,
          background: "var(--bg-surface)",
          borderRight: "1px solid rgba(255,255,255,0.06)",
          // Make empty sidebar area draggable (window drag on macOS).
          WebkitAppRegion: "drag",
        }}
      >
        {/* Header — khi expanded: brand + tên + pin ngang hàng.
            Khi collapsed (64px): BrandMark căn giữa, pin nằm dưới căn giữa
            để không tràn ngoài rail 64px. */}
        <div
          className="flex px-3"
          style={{
            minHeight: 68,
            paddingTop: HEADER_TOP,
            paddingBottom: 14,
            gap: 10,
            alignItems: expanded ? "center" : "stretch",
            flexDirection: expanded ? "row" : "column",
            WebkitAppRegion: "drag",
          }}
        >
          {expanded ? (
            <>
              <BrandMark size={32} />
              <div className="flex-1 overflow-hidden whitespace-nowrap">
                <h1
                  className="text-[15px] font-semibold leading-none tracking-tight"
                  style={{ color: "var(--text-primary)" }}
                >
                  {t("brand.name")}
                </h1>
                <p
                  className="text-[11px] leading-tight mt-1"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {t("brand.tagline")}
                </p>
              </div>
              <button
                onClick={() => setPinned(false)}
                className="p-1.5 rounded-md flex-shrink-0 transition-colors hover:bg-white/10"
                style={{ color: "var(--text-secondary)", WebkitAppRegion: "no-drag" }}
                title={t("sidebar.collapse")}
              >
                <PanelLeftClose size={18} />
              </button>
            </>
          ) : (
            <div
              className="flex flex-col items-center w-full"
              style={{ gap: 8, WebkitAppRegion: "no-drag" }}
            >
              <BrandMark size={32} />
              <button
                onClick={() => setPinned(true)}
                className="p-1 rounded-md transition-colors hover:bg-white/10"
                style={{ color: "var(--text-secondary)" }}
                title={t("sidebar.expand")}
              >
                <PanelLeftOpen size={16} />
              </button>
            </div>
          )}
        </div>

        {/* Main nav */}
        <nav
          className="flex-1 px-2 mt-1 overflow-y-auto"
          style={{ WebkitAppRegion: "no-drag" }}
        >
          {nav.map(({ to, icon: Icon, label }) => (
            <NavItem key={to} to={to} Icon={Icon} label={label} expanded={expanded} />
          ))}
        </nav>

        {/* Bottom — user menu (Settings + Billing + Language + Sign out live inside) */}
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
        `flex items-center rounded-lg mb-1 text-sm transition-colors ${isActive ? "font-medium" : "hover:opacity-80"}`
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
