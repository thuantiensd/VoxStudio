import { useEffect, useRef } from "react";
import { Scissors, Copy, Trash2 } from "lucide-react";

/**
 * ContextMenu — popover chuột phải khi right-click clip.
 *   items: [{ id, icon, label, onClick, disabled, danger }]
 */
export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onEsc = (e) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed rounded-md shadow-xl py-1 overflow-hidden"
      style={{
        left: x,
        top: y,
        zIndex: 100,
        minWidth: 180,
        background: "var(--bg-surface)",
        border: "1px solid rgba(127,127,160,0.25)",
      }}
    >
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => {
            if (it.disabled) return;
            it.onClick?.();
            onClose();
          }}
          disabled={it.disabled}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors disabled:opacity-40"
          style={{
            color: it.danger ? "#f87171" : "var(--text-primary)",
          }}
          onMouseEnter={(e) => {
            if (!it.disabled) e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          }}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          {it.icon}
          <span className="flex-1">{it.label}</span>
          {it.shortcut && (
            <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
              {it.shortcut}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export { Scissors, Copy, Trash2 };
