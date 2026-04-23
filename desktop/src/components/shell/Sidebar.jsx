import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  Clapperboard, Mic2, AudioWaveform, Library,
  ClockFading, Settings as Cog, CloudDownload,
  FileText, PanelLeftClose, PanelLeftOpen,
  Sun, Moon, Monitor, LogOut, User as UserIcon,
} from "lucide-react";
import { useBatch } from "../../batch/BatchContext";
import { useT } from "../../i18n/I18nContext";
import { useTheme } from "../../theme/ThemeContext";
import { useAuth } from "../../auth/AuthContext";
import logoUrl from "../../assets/logo.svg";

/**
 * Sidebar — toggle giữa 220px (full) và 60px (icon-only).
 * Trạng thái lưu qua localStorage để giữ giữa các phiên.
 * Active indicator = left accent bar 2px + bg accent-soft, animate bằng layoutId.
 */
const LS_COLLAPSED = "voxstudio:sidebar:collapsed";
const WIDTH_FULL = 220;
const WIDTH_COLLAPSED = 60;

export default function Sidebar() {
  const t = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const { queue = [] } = useBatch() || {};
  const running = queue.filter((q) => q.status === "running").length;

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(LS_COLLAPSED) === "1"; }
    catch { return false; }
  });
  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(LS_COLLAPSED, next ? "1" : "0"); } catch {}
      return next;
    });
  };

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
        width: collapsed ? WIDTH_COLLAPSED : WIDTH_FULL,
        background: "var(--n-1)",
        borderRight: "1px solid var(--n-3)",
        transition: "width 180ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        overflow: "hidden",
      }}
    >
      {/* Brand header + collapse toggle */}
      <BrandHeader collapsed={collapsed} onToggle={toggleCollapsed} />

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pt-3 pb-2">
        <Section title={t("sidebar.main")} collapsed={collapsed} />
        {MAIN.map((item) => (
          <NavItem
            key={item.path}
            item={item}
            active={isActive(loc.pathname, item.path)}
            onClick={() => nav(item.path)}
            badge={item.path === "/history" && running > 0 ? running : null}
            collapsed={collapsed}
          />
        ))}

        <div className="h-4" />
        <Section title={t("sidebar.tools")} collapsed={collapsed} />
        {TOOLS.map((item) => (
          <NavItem
            key={item.path}
            item={item}
            active={isActive(loc.pathname, item.path)}
            onClick={() => nav(item.path)}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* Footer — user block (click → popover với Cài đặt + Đăng xuất) + theme toggle */}
      <UserFooter collapsed={collapsed} />
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

function Section({ title, collapsed }) {
  if (collapsed) {
    // Chỉ hiện 1 đường gạch mỏng làm divider
    return <div style={{ height: 1, margin: "8px 10px",
                          background: "var(--n-3)" }} />;
  }
  return (
    <div className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap"
         style={{ color: "var(--n-6)" }}>
      {title}
    </div>
  );
}

function NavItem({ item, active, onClick, badge, collapsed }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      title={collapsed ? `${item.label}${item.hotkey ? ` (⌘${item.hotkey})` : ""}` : undefined}
      className="relative w-full flex items-center rounded-md transition-colors"
      style={{
        height: 30,
        padding: collapsed ? 0 : "0 10px",
        gap: collapsed ? 0 : 8,
        justifyContent: collapsed ? "center" : "flex-start",
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
      {!collapsed && (
        <>
          <span className="flex-1 text-left text-[13px] truncate"
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
          {item.hotkey && badge == null && (
            <kbd className="opacity-70">⌘{item.hotkey}</kbd>
          )}
        </>
      )}
      {/* Collapsed mode: show badge dot ở góc phải icon */}
      {collapsed && badge != null && (
        <span
          style={{
            position: "absolute", top: 4, right: 6,
            minWidth: 14, height: 14, padding: "0 3px",
            borderRadius: 7,
            background: "var(--accent)", color: "#fff",
            fontSize: 9, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

/**
 * BrandHeader — top of sidebar. Logo V-Pearl + tên app + nút thu gọn.
 * Khi collapsed: chỉ hiện logo + click logo = toggle expand.
 */
function BrandHeader({ collapsed, onToggle }) {
  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        title="Mở rộng sidebar"
        className="flex items-center justify-center"
        style={{
          height: 54,
          borderBottom: "1px solid var(--n-3)",
          background: "transparent", border: "none", cursor: "pointer",
          padding: 0,
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = "var(--n-2)"}
        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
      >
        <img src={logoUrl} alt="" style={{ width: 24, height: 24 }} />
      </button>
    );
  }
  return (
    <div
      className="flex items-center gap-2 pl-3.5 pr-2 py-3"
      style={{ borderBottom: "1px solid var(--n-3)", height: 54 }}
    >
      <img
        src={logoUrl}
        alt=""
        style={{ width: 22, height: 22, flexShrink: 0 }}
      />
      <span className="text-[14px] font-semibold truncate flex-1"
            style={{ color: "var(--n-10)", letterSpacing: "-0.01em" }}>
        VoxStudio
      </span>
      <button
        onClick={onToggle}
        title="Thu gọn sidebar"
        className="flex items-center justify-center rounded transition-colors flex-shrink-0"
        style={{
          width: 26, height: 26,
          background: "transparent", border: "none", cursor: "pointer",
          color: "var(--n-8)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--n-2)";
          e.currentTarget.style.color = "var(--n-10)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--n-8)";
        }}
      >
        <PanelLeftClose size={14} />
      </button>
    </div>
  );
}

/**
 * UserFooter — bottom of sidebar. User avatar + name + email. Click → popover
 * (mở UPWARD vì nằm bottom) chứa Cài đặt tài khoản + Đăng xuất. Theme toggle
 * đứng cạnh bên phải.
 */
function UserFooter({ collapsed }) {
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

  const avatarEl = (
    <div
      className="rounded-md flex items-center justify-center flex-shrink-0 overflow-hidden"
      style={{
        width: collapsed ? 28 : 24,
        height: collapsed ? 28 : 24,
        background: hasAvatar
          ? "transparent"
          : "linear-gradient(135deg, var(--accent), #8b5cf6)",
        fontSize: collapsed ? 12 : 11, fontWeight: 700, color: "#fff",
      }}
    >
      {hasAvatar
        ? <img src={user.avatar} alt="" style={{ width: "100%", height: "100%", borderRadius: 6 }} />
        : initial}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={collapsed ? "py-2 flex flex-col items-center gap-1" : "px-2 py-2"}
      style={{ borderTop: "1px solid var(--n-3)", position: "relative" }}
    >
      {collapsed ? (
        <>
          <button
            onClick={() => setOpen((o) => !o)}
            title={user?.name || user?.email}
            className="flex items-center justify-center rounded-md transition-colors"
            style={{
              width: 36, height: 36,
              background: open ? "var(--n-2)" : "transparent",
              border: "none", cursor: "pointer",
            }}
            onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = "var(--n-2)"; }}
            onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = "transparent"; }}
          >
            {avatarEl}
          </button>
          <ThemeToggle />
        </>
      ) : (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2 rounded-md transition-colors"
            style={{
              flex: 1, minWidth: 0,
              padding: "6px 8px",
              background: open ? "var(--n-2)" : "transparent",
              border: "none", cursor: "pointer", textAlign: "left",
            }}
            onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = "var(--n-2)"; }}
            onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = "transparent"; }}
          >
            {avatarEl}
            <div className="flex flex-col leading-tight min-w-0 flex-1">
              <span className="text-[12.5px] font-semibold truncate"
                    style={{ color: "var(--n-10)" }}>
                {user?.name || user?.email}
              </span>
              <span className="text-[10px] truncate"
                    style={{ color: "var(--n-7)" }}>
                {user?.email}
              </span>
            </div>
          </button>
          <ThemeToggle />
        </div>
      )}

      {open && (
        <div
          style={{
            position: "absolute",
            bottom: collapsed ? 4 : "calc(100% + 4px)",
            left: collapsed ? "calc(100% + 6px)" : 8,
            right: collapsed ? "auto" : 8,
            minWidth: collapsed ? 200 : undefined,
            background: "var(--n-1)",
            border: "1px solid var(--n-3)",
            borderRadius: 8,
            boxShadow: "var(--shadow-pop)",
            padding: 6,
            zIndex: 60,
          }}
        >
          {collapsed && (
            <div style={{ padding: "8px 10px 4px", fontSize: 12,
                           fontWeight: 600, color: "var(--n-10)" }}>
              {user?.name || user?.email}
            </div>
          )}
          <div style={{ padding: collapsed ? "0 10px 8px" : "8px 10px",
                         fontSize: 11, color: "var(--n-8)" }}>
            Gói {user?.plan || "Free"}
          </div>
          <MenuItem icon={Cog} label="Cài đặt"
                    onClick={() => { nav("/settings"); setOpen(false); }} />
          <MenuItem icon={UserIcon} label="Tài khoản"
                    onClick={() => { nav("/settings#account"); setOpen(false); }} />
          <div style={{ height: 1, background: "var(--n-3)", margin: "4px 4px" }} />
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
