import { useEffect, useState } from "react";
import { Search, Minus, Square, X } from "lucide-react";
import Breadcrumb from "./Breadcrumb";

/**
 * Titlebar — 36px drag region.
 *   Mac: chừa 78px trái cho traffic lights (BrowserWindow dùng hiddenInset).
 *   Win/Linux: custom min/max/close buttons bên phải.
 *
 * Props: onOpenPalette — trigger ⌘K pill.
 */
export default function Titlebar({ onOpenPalette }) {
  const [platform, setPlatform] = useState("darwin");
  const [isMax, setIsMax] = useState(false);

  useEffect(() => {
    const p = window.voxstudio?.platform || (navigator.platform.toUpperCase().includes("MAC") ? "darwin" : "win32");
    setPlatform(p);
  }, []);

  const isMac = platform === "darwin";
  const modKey = isMac ? "⌘" : "Ctrl";

  // Window controls — chỉ cho Windows/Linux (Mac dùng traffic lights native)
  const win = {
    min:    () => window.voxstudio?.winControl?.("minimize"),
    max:    () => {
      window.voxstudio?.winControl?.("toggleMaximize");
      setIsMax((m) => !m);
    },
    close:  () => window.voxstudio?.winControl?.("close"),
  };

  return (
    <div
      className="drag-region flex items-center justify-between select-none"
      style={{
        height: 36,
        paddingLeft: isMac ? 82 : 12,
        paddingRight: isMac ? 12 : 0,
        background: "var(--n-0)",
        borderBottom: "1px solid var(--n-3)",
        flexShrink: 0,
      }}
    >
      {/* Left — breadcrumb */}
      <div className="no-drag flex items-center gap-2 min-w-0">
        <Breadcrumb />
      </div>

      {/* Right — ⌘K pill + (Windows-only) window controls */}
      <div className="flex items-center">
        <button
          onClick={onOpenPalette}
          className="no-drag flex items-center gap-2 px-2.5 py-1 rounded-md transition-colors"
          style={{
            background: "var(--n-2)",
            border: "1px solid var(--n-3)",
            color: "var(--n-8)",
            fontSize: 12,
            minWidth: 180,
          }}
          title="Tìm kiếm & lệnh nhanh"
        >
          <Search size={12} />
          <span className="flex-1 text-left">Tìm kiếm…</span>
          <kbd style={{ fontSize: 10 }}>{modKey}K</kbd>
        </button>

        {!isMac && (
          <div className="no-drag flex ml-2">
            <WinCtrl onClick={win.min}  label="minimize"><Minus size={12} /></WinCtrl>
            <WinCtrl onClick={win.max}  label="maximize"><Square size={10} /></WinCtrl>
            <WinCtrl onClick={win.close} label="close" danger><X size={12} /></WinCtrl>
          </div>
        )}
      </div>
    </div>
  );
}

function WinCtrl({ children, onClick, label, danger }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex items-center justify-center transition-colors"
      style={{
        width: 46, height: 36,
        color: "var(--n-8)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? "#e81123" : "var(--n-2)";
        e.currentTarget.style.color = danger ? "#fff" : "var(--n-10)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--n-8)";
      }}
    >
      {children}
    </button>
  );
}
