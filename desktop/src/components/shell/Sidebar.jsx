import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  Clapperboard, Mic2, AudioWaveform, Library,
  ClockFading, Settings as Cog, Sparkles,
} from "lucide-react";
import { useBatch } from "../../batch/BatchContext";

const MAIN = [
  { path: "/studio",   icon: Clapperboard,    label: "Studio",       hotkey: "1" },
  { path: "/library",  icon: Library,    label: "Thư viện",     hotkey: "2" },
  { path: "/history",  icon: ClockFading,     label: "Lịch sử",      hotkey: "3" },
];

const TOOLS = [
  { path: "/",         icon: AudioWaveform,   label: "TTS",          hotkey: "4" },
  { path: "/clone",    icon: Mic2,            label: "Voice Clone",  hotkey: "5" },
];

/**
 * Sidebar — 220px fixed. Section headers uppercase nhỏ. Item 32px.
 * Active indicator = left accent bar 2px + bg accent-soft, animate bằng layoutId.
 */
export default function Sidebar() {
  const nav = useNavigate();
  const loc = useLocation();
  const { queue = [] } = useBatch() || {};
  const running = queue.filter((q) => q.status === "running").length;

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
        <Section title="Chính" />
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
        <Section title="Công cụ" />
        {TOOLS.map((item) => (
          <NavItem
            key={item.path}
            item={item}
            active={isActive(loc.pathname, item.path)}
            onClick={() => nav(item.path)}
          />
        ))}
      </nav>

      {/* Footer — settings + backend status */}
      <div className="px-2 py-2"
           style={{ borderTop: "1px solid var(--n-3)" }}>
        <NavItem
          item={{ path: "/settings", icon: Cog, label: "Cài đặt", hotkey: "," }}
          active={isActive(loc.pathname, "/settings")}
          onClick={() => nav("/settings")}
        />
        <BackendStatus />
      </div>
    </aside>
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

function BackendStatus() {
  // Placeholder — sau connect checkHealth. Hiện tại mặc định "ok" để không giả trạng thái sai.
  return (
    <div className="mt-2 mx-1 flex items-center gap-2 text-[11px]"
         style={{ color: "var(--n-8)" }}>
      <span
        className="inline-block rounded-full"
        style={{ width: 6, height: 6, background: "var(--ok)" }}
      />
      <span>Backend online</span>
    </div>
  );
}
