/**
 * LanguagePicker — searchable dropdown thay native <select>.
 *
 * Lý do: 99 ngôn ngữ Whisper trong native select rất khó scroll/tìm.
 * Component này có ô search filter realtime theo:
 *   - Tên hiển thị (vd "Tiếng Việt", "Vietnamese")
 *   - Code locale (vd "vietnamese", "vi")
 *   - Flag emoji (vd 🇻🇳)
 *
 * Props:
 *   options: [{value, label, flag?}]   — danh sách ngôn ngữ
 *   value:   string                     — selected value
 *   onChange:(newValue) => void
 *   placeholder?: string
 *   disabled?: boolean
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { useT } from "../../i18n/I18nContext";

export default function LanguagePicker({
  options = [],
  value = "",
  onChange,
  placeholder,
  disabled = false,
  className = "",
  style = {},
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // Đóng khi click outside
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Auto-focus input khi mở
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Filter options theo query (search trong label + value + flag)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => {
      const label = (opt.label || "").toLowerCase();
      const val = (opt.value || "").toLowerCase();
      const flag = (opt.flag || "").toLowerCase();
      return label.includes(q) || val.includes(q) || flag.includes(q);
    });
  }, [options, query]);

  // Hiển thị label của value đang chọn
  const selectedOpt = options.find((o) => o.value === value);
  const displayLabel = selectedOpt?.label || placeholder || t("common.select");

  const handleSelect = (val) => {
    onChange?.(val);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`} style={style}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="w-full p-2.5 rounded-lg text-sm flex items-center justify-between"
        style={{
          background: "var(--bg-card)",
          border: "1px solid #2a2a40",
          color: "var(--text-primary)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          textAlign: "left",
        }}
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronDown size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute z-50 mt-1 rounded-lg shadow-lg overflow-hidden"
          style={{
            width: "100%",
            background: "var(--bg-card)",
            border: "1px solid #3a3a50",
            maxHeight: 320,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Search input */}
          <div
            className="flex items-center gap-2 p-2"
            style={{ borderBottom: "1px solid #2a2a40" }}
          >
            <Search size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("common.searchLang")}
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: "var(--text-primary)" }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                  setQuery("");
                } else if (e.key === "Enter" && filtered.length > 0) {
                  handleSelect(filtered[0].value);
                }
              }}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="p-0.5 rounded"
                style={{ color: "var(--text-secondary)", cursor: "pointer" }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Options list */}
          <div className="overflow-y-auto" style={{ flex: 1 }}>
            {filtered.length === 0 ? (
              <div
                className="p-3 text-xs text-center"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("common.noResults")}
              </div>
            ) : (
              filtered.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value || "auto"}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className="w-full px-3 py-2 text-left text-sm flex items-center"
                    style={{
                      background: isSelected
                        ? "rgba(124, 92, 255, 0.15)"
                        : "transparent",
                      color: "var(--text-primary)",
                      cursor: "pointer",
                      borderLeft: isSelected
                        ? "2px solid var(--accent)"
                        : "2px solid transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected)
                        e.currentTarget.style.background =
                          "rgba(255, 255, 255, 0.04)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected)
                        e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer count */}
          <div
            className="px-3 py-1.5 text-xs"
            style={{
              borderTop: "1px solid #2a2a40",
              color: "var(--text-secondary)",
            }}
          >
            {filtered.length}/{options.length} {t("common.languages")}
          </div>
        </div>
      )}
    </div>
  );
}
