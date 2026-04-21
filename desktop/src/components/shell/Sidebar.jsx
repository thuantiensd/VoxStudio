import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  Clapperboard, Mic2, AudioWaveform, Library,
  ClockFading, Settings as Cog, Sparkles, CloudDownload,
  Sun, Moon, Monitor, Info, Check, ExternalLink,
} from "lucide-react";
import { useBatch } from "../../batch/BatchContext";
import { useT, useI18n } from "../../i18n/I18nContext";
import { useTheme } from "../../theme/ThemeContext";

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
    { path: "/",           icon: AudioWaveform, label: "TTS",                        hotkey: "4" },
    { path: "/clone",      icon: Mic2,          label: t("shell.titleClone"),        hotkey: "5" },
    { path: "/downloader", icon: CloudDownload, label: t("shell.titleDownloader"),   hotkey: "6" },
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
      {/* Brand */}
      <div className="flex items-center gap-2 px-3.5 py-3.5"
           style={{ borderBottom: "1px solid var(--n-3)" }}>
        <div
          className="rounded-md flex items-center justify-center"
          style={{
            width: 22, height: 22,
            background: "linear-gradient(135deg, var(--accent), #8b5cf6)",
          }}
        >
          <Sparkles size={12} color="#fff" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-[13px] font-semibold"
                style={{ color: "var(--n-10)" }}>
            VoxStudio
          </span>
          <span className="text-[10px]"
                style={{ color: "var(--n-8)" }}>
            AI Dubbing
          </span>
        </div>
      </div>

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
          <InfoPopover />
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

/**
 * InfoPopover — icon ⓘ 30×30, click mở popover 240px với:
 *   - Backend status (dot online/offline + nhãn)
 *   - Language picker (VI / EN dạng Check list)
 *   - App version
 *   - Link "Tìm hiểu thêm" về Chrome cookie flow
 */
function InfoPopover() {
  const t = useT();
  const { locale, setLocale, locales } = useI18n();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState("");
  const rootRef = useRef(null);

  useEffect(() => {
    window.voxstudio?.getVersion?.().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={t("shell.moreTip") || "Thông tin & ngôn ngữ"}
        className="flex items-center justify-center rounded transition-colors flex-shrink-0"
        style={{
          width: 30, height: 30,
          color: open ? "var(--n-10)" : "var(--n-8)",
          background: open ? "var(--n-2)" : "transparent",
          border: `1px solid ${open ? "var(--n-3)" : "transparent"}`,
        }}
        onMouseEnter={(e) => {
          if (open) return;
          e.currentTarget.style.background = "var(--n-2)";
          e.currentTarget.style.color = "var(--n-10)";
          e.currentTarget.style.borderColor = "var(--n-3)";
        }}
        onMouseLeave={(e) => {
          if (open) return;
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--n-8)";
          e.currentTarget.style.borderColor = "transparent";
        }}
      >
        <Info size={13} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)", right: 0,
            width: 240,
            background: "var(--n-1)",
            border: "1px solid var(--n-3)",
            borderRadius: 10,
            boxShadow: "var(--shadow-pop)",
            padding: 8,
            zIndex: 60,
            fontSize: 12,
          }}
        >
          {/* Backend status */}
          <div
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 10px", borderRadius: 6,
            }}
          >
            <span
              className="inline-block rounded-full"
              style={{
                width: 8, height: 8, background: "var(--ok)",
                boxShadow: "0 0 0 3px rgba(63,185,80,0.18)",
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "var(--n-10)", fontWeight: 500, fontSize: 12 }}>
                {t("sidebar.backendOnline")}
              </div>
              <div style={{ fontSize: 10, color: "var(--n-6)" }}>
                {version ? `v${version}` : "VoxStudio"}
              </div>
            </div>
          </div>

          {/* Separator */}
          <div style={{ height: 1, background: "var(--n-3)", margin: "4px 0" }} />

          {/* Language picker */}
          <div style={{
            padding: "4px 10px 2px",
            fontSize: 10, fontWeight: 600, textTransform: "uppercase",
            letterSpacing: "0.06em", color: "var(--n-6)",
          }}>
            {t("user.language") || "Ngôn ngữ"}
          </div>
          {locales.map((lc) => {
            const active = lc === locale;
            const label = lc === "vi" ? "Tiếng Việt" : lc === "en" ? "English" : lc.toUpperCase();
            return (
              <button
                key={lc}
                onClick={() => { setLocale(lc); setOpen(false); }}
                className="w-full flex items-center gap-2 px-2.5 rounded transition-colors"
                style={{
                  height: 30,
                  background: active ? "var(--accent-soft)" : "transparent",
                  color: active ? "var(--n-10)" : "var(--n-9)",
                  border: "none", cursor: "pointer",
                  fontWeight: active ? 500 : 400,
                  textAlign: "left",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = "var(--n-2)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
              >
                <span style={{
                  fontSize: 10, fontWeight: 600, fontFamily: "var(--font-mono)",
                  width: 22, textAlign: "center",
                  color: active ? "var(--accent)" : "var(--n-6)",
                }}>
                  {lc.toUpperCase()}
                </span>
                <span style={{ flex: 1, fontSize: 12 }}>{label}</span>
                {active && <Check size={12} style={{ color: "var(--accent)" }} />}
              </button>
            );
          })}

          {/* Separator */}
          <div style={{ height: 1, background: "var(--n-3)", margin: "4px 0" }} />

          {/* Learn more */}
          <button
            onClick={() => {
              window.voxstudio?.openExternal?.("https://github.com/thuantiensd/VoxStudio");
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-2.5 rounded transition-colors"
            style={{
              height: 28,
              background: "transparent",
              color: "var(--n-8)",
              border: "none", cursor: "pointer",
              fontSize: 11,
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
            <ExternalLink size={11} />
            <span style={{ flex: 1, textAlign: "left" }}>
              {t("shell.learnMore") || "Tìm hiểu thêm"}
            </span>
          </button>
        </div>
      )}
    </div>
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

