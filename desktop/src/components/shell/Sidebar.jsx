import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  Clapperboard, Mic2, AudioWaveform, Library,
  ClockFading, Settings as Cog, CloudDownload,
  FileText,
  Sun, Moon, Monitor, LogOut, User as UserIcon,
} from "lucide-react";
import { useBatch } from "../../batch/BatchContext";
import { useT } from "../../i18n/I18nContext";
import { useTheme } from "../../theme/ThemeContext";
import { useAuth } from "../../auth/AuthContext";

/**
 * Sidebar — 220px fixed. Section headers uppercase nhỏ. Item 32px.
 * Active indicator = left accent bar 2px + bg accent-soft, animate bằng layoutId.
 */
export default function Sidebar() {
  const t = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const { queue = [] } = useBatch() || {};
  const running = queue.filter((q) => q.status === "running").length;

  const MAIN = [
    { path: "/studio",   icon: Clapperboard, label: t("shell.titleStudio"),  hotkey: "1" },
    { path: "/library",  icon: Library,      label: t("shell.titleLibrary"), hotkey: "2" },
    { path: "/history",  icon: ClockFading,  label: t("shell.titleHistory"), hotkey: "3" },
  ];

  const TOOLS = [
    { path: "/",           icon: AudioWaveform, label: t("shell.titleTTS"),          hotkey: "4" },
    { path: "/clone",      icon: Mic2,          label: t("shell.titleClone"),        hotkey: "5" },
    { path: "/downloader", icon: CloudDownload, label: t("shell.titleDownloader"),   hotkey: "6" },
    { path: "/stt",        icon: FileText,      label: t("shell.titleSTT"),          hotkey: "7" },
  ];

  return (
    <aside
      className="flex flex-col flex-shrink-0"
      style={{
        width: 220,
        background: "var(--n-1)",
        borderRight: "1px solid var(--n-3)",
      }}
    >
      {/* Brand + user menu */}
      <BrandUserBlock />

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-2 pt-3 pb-2">
        <Section title={t("sidebar.main")} />
        {MAIN.map((item) => (
          <NavItem
            key={item.path}
            item={item}
            active={isActive(loc.pathname, item.path)}
            onClick={() => nav(item.path)}
            badge={item.path === "/history" && running > 0 ? running : null}
          />
        ))}

        <div className="h-4" />
        <Section title={t("sidebar.tools")} />
        {TOOLS.map((item) => (
          <NavItem
            key={item.path}
            item={item}
            active={isActive(loc.pathname, item.path)}
            onClick={() => nav(item.path)}
          />
        ))}
      </nav>

      {/* Footer — settings + theme toggle + info popover */}
      <div className="px-2 py-2"
           style={{ borderTop: "1px solid var(--n-3)" }}>
        <div className="flex items-center gap-1">
          <div style={{ flex: 1, minWidth: 0 }}>
            <NavItem
              item={{ path: "/settings", icon: Cog, label: t("shell.titleSettings"), hotkey: "," }}
              active={isActive(loc.pathname, "/settings")}
              onClick={() => nav("/settings")}
            />
          </div>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}

/**
 * ThemeToggle — icon button 30×30 cycle dark/light/system.
 * Hiển thị icon theo theme hiện tại: Sun (light) · Moon (dark) · Monitor (system).
 */
function ThemeToggle() {
  const theme = useTheme();
  if (!theme) return null;
  const { theme: cur, setTheme } = theme;
  const ICONS = { light: Sun, dark: Moon, system: Monitor };
  const ORDER = ["dark", "light", "system"];
  const Icon = ICONS[cur] || Monitor;
  const next = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length];
  const titles = {
    light: "Sáng (click → Tối)",
    dark: "Tối (click → Sáng)",
    system: "Theo hệ thống (click → Tối)",
  };
  return (
    <button
      onClick={() => setTheme(next)}
      title={titles[cur]}
      aria-label={`Theme: ${cur}`}
      className="flex items-center justify-center rounded transition-colors flex-shrink-0"
      style={{
        width: 30, height: 30,
        color: "var(--n-8)",
        background: "transparent",
        border: "1px solid transparent",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--n-2)";
        e.currentTarget.style.color = "var(--n-10)";
        e.currentTarget.style.borderColor = "var(--n-3)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--n-8)";
        e.currentTarget.style.borderColor = "transparent";
      }}
    >
      <Icon size={13} />
    </button>
  );
}


function isActive(current, path) {
  if (path === "/") return current === "/";
  return current === path || current.startsWith(path + "/");
}

function Section({ title }) {
  return (
    <div className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-wider"
         style={{ color: "var(--n-6)" }}>
      {title}
    </div>
  );
}

function NavItem({ item, active, onClick, badge }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      className="relative w-full flex items-center gap-2 px-2.5 rounded-md transition-colors"
      style={{
        height: 30,
        color: active ? "var(--n-10)" : "var(--n-8)",
        background: active ? "var(--accent-soft)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--n-2)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      {active && (
        <motion.div
          layoutId="sidebar-active-bar"
          className="absolute left-0 top-1.5 bottom-1.5 rounded-r"
          style={{ width: 2, background: "var(--accent)" }}
          transition={{ duration: 0.12, ease: [0.2, 0.8, 0.2, 1] }}
        />
      )}
      <Icon size={14} strokeWidth={active ? 2.2 : 1.8} />
      <span className="flex-1 text-left text-[13px]"
            style={{ fontWeight: active ? 500 : 400 }}>
        {item.label}
      </span>
      {badge != null && (
        <span
          className="flex items-center justify-center rounded"
          style={{
            minWidth: 16, height: 16, padding: "0 4px",
            fontSize: 10, fontWeight: 600,
            background: "var(--accent)", color: "#fff",
          }}
        >
          {badge}
        </span>
      )}
      {item.hotkey && !badge && (
        <kbd className="opacity-70">⌘{item.hotkey}</kbd>
      )}
    </button>
  );
}

/**
 * BrandUserBlock — top of sidebar. Click mở popover tài khoản (luôn đã đăng nhập
 * vì route đã được ProtectedRoute bọc).
 */
function BrandUserBlock() {
  const { user, logout } = useAuth() || {};
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const initial = (user?.name || user?.email || "?")[0].toUpperCase();
  const hasAvatar = !!user?.avatar;

  return (
    <div ref={rootRef} style={{ position: "relative",
                                  borderBottom: "1px solid var(--n-3)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3.5 py-3.5 transition-colors"
        style={{ background: "transparent", border: "none", cursor: "pointer",
                  textAlign: "left" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--n-2)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <div
          className="rounded-md flex items-center justify-center flex-shrink-0 overflow-hidden"
          style={{
            width: 22, height: 22,
            background: hasAvatar
              ? "transparent"
              : "linear-gradient(135deg, var(--accent), #8b5cf6)",
            fontSize: 10, fontWeight: 700, color: "#fff",
          }}
        >
          {hasAvatar
            ? <img src={user.avatar} alt="" style={{ width: "100%", height: "100%", borderRadius: 6 }} />
            : initial}
        </div>
        <div className="flex flex-col leading-tight min-w-0 flex-1">
          <span className="text-[13px] font-semibold truncate"
                style={{ color: "var(--n-10)" }}>
            {user?.name || user?.email}
          </span>
          <span className="text-[10px] truncate"
                style={{ color: "var(--n-8)" }}>
            {user?.email}
          </span>
        </div>
      </button>

      {open && (
        <div
          style={{
            position: "absolute", top: "100%", left: 8, right: 8,
            marginTop: 4,
            background: "var(--n-1)",
            border: "1px solid var(--n-3)",
            borderRadius: 8,
            boxShadow: "var(--shadow-pop)",
            padding: 6,
            zIndex: 60,
          }}
        >
          <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--n-8)" }}>
            Gói {user?.plan || "Free"}
          </div>
          <MenuItem icon={UserIcon} label="Cài đặt tài khoản"
                    onClick={() => { nav("/settings"); setOpen(false); }} />
          <MenuItem icon={LogOut} label="Đăng xuất" danger
                    onClick={() => { logout(); setOpen(false); }} />
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, primary, danger }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2.5 rounded transition-colors"
      style={{
        height: 30, border: "none", cursor: "pointer",
        background: primary ? "var(--accent-soft)" : "transparent",
        color: primary ? "var(--accent)"
              : danger ? "var(--err)"
              : "var(--n-9)",
        fontSize: 13, fontWeight: primary ? 500 : 400,
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        if (primary) return;
        e.currentTarget.style.background = "var(--n-2)";
      }}
      onMouseLeave={(e) => {
        if (primary) return;
        e.currentTarget.style.background = "transparent";
      }}
    >
      <Icon size={13} />
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );
}
