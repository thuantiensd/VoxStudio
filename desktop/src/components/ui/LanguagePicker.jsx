/**
 * LanguagePicker — searchable dropdown match style của PremiumVoicePicker.
 *
 * Visual: trigger card 36px flag-in-circle + name + locale meta + chevron.
 * Panel: rounded-xl, shadow-lg, search + scrollable list của row cards
 * có flag-circle trái + name/code phải.
 *
 * Search filter realtime theo:
 *   - Tên hiển thị (vd "Tiếng Việt", "Vietnamese")
 *   - Code locale (vd "vietnamese", "vi")
 *   - Flag emoji (vd 🇻🇳)
 *
 * Props (giữ tương thích API cũ):
 *   options: [{value, label, flag?}]   — list ngôn ngữ; label đã prepend flag
 *   value:   string                     — selected value
 *   onChange:(newValue) => void
 *   placeholder?: string
 *   disabled?: boolean
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronDown, Search, X, Globe } from "lucide-react";
import { useT } from "../../i18n/I18nContext";


// Tách flag khỏi label "🇻🇳 Tiếng Việt" → "Tiếng Việt".
// useLanguages() hiện ghép sẵn flag vào đầu label, ta strip để render
// flag trong circle riêng + name plain.
function stripFlag(label, flag) {
  if (!label) return "";
  if (flag && label.startsWith(flag)) {
    return label.slice(flag.length).trim();
  }
  return label.replace(/^[\p{Extended_Pictographic}‍️]+\s*/u, "").trim();
}

function FlagCircle({ flag, size = 36 }) {
  return (
    <div className="flex items-center justify-center flex-shrink-0"
      style={{
        width: size, height: size, borderRadius: "50%",
        background: "var(--bg-surface)",
        border: "1px solid #2a2a40",
        fontSize: size * 0.5,
        lineHeight: 1,
      }}>
      {flag || <Globe size={size * 0.45} style={{ color: "var(--text-secondary)" }} />}
    </div>
  );
}

function LanguageRow({ option, isSelected, onSelect }) {
  const name = stripFlag(option.label, option.flag);
  const code = option.value || "auto";
  return (
    <div onClick={onSelect}
      className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors"
      style={{
        background: isSelected ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "transparent",
        border: `1px solid ${isSelected ? "color-mix(in srgb, var(--accent) 40%, transparent)" : "transparent"}`,
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-surface)"; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}>
      <FlagCircle flag={option.flag} size={36} />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate" style={{ color: "var(--text-primary)" }}>
          {name}
        </div>
        <div className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
          {code}
        </div>
      </div>
    </div>
  );
}


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

  // Filter — match label/value/flag, ignore diacritics để type "tieng" match "Tiếng".
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const filtered = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return options;
    return options.filter((opt) =>
      norm(opt.label).includes(q) ||
      norm(opt.value).includes(q) ||
      (opt.flag || "").includes(query.trim())
    );
  }, [options, query]);

  const selectedOpt = options.find((o) => o.value === value);
  const triggerName = selectedOpt
    ? stripFlag(selectedOpt.label, selectedOpt.flag)
    : (placeholder || t("common.select"));
  const triggerCode = selectedOpt ? (selectedOpt.value || "auto") : "—";

  const handleSelect = (val) => {
    onChange?.(val);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`} style={style}>
      {/* Trigger — match PremiumVoicePicker visual rhythm */}
      <button type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors"
        style={{
          background: "var(--bg-card)",
          border: `1px solid ${open ? "var(--accent)" : "#2a2a40"}`,
          color: "var(--text-primary)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          textAlign: "left",
        }}>
        <FlagCircle flag={selectedOpt?.flag} size={36} />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate" style={{ color: "var(--text-primary)" }}>
            {triggerName}
          </div>
          <div className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
            {triggerCode}
          </div>
        </div>
        <ChevronDown size={16} style={{
          color: "var(--text-secondary)",
          transition: "transform 150ms",
          transform: open ? "rotate(180deg)" : "none",
          flexShrink: 0,
        }} />
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute left-0 right-0 mt-2 rounded-xl overflow-hidden z-20"
          style={{
            background: "var(--bg-card)",
            border: "1px solid #2a2a40",
            boxShadow: "0 10px 40px rgba(0,0,0,0.4)",
          }}>
          {/* Search */}
          <div className="p-3 pb-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: "var(--bg-surface)", border: "1px solid #2a2a40" }}>
              <Search size={14} style={{ color: "var(--text-secondary)" }} />
              <input ref={inputRef}
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
                }} />
              {query && (
                <button type="button" onClick={() => setQuery("")}
                  className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "#2a2a40" }} />

          {/* List */}
          <div className="px-2 py-2 max-h-80 overflow-y-auto flex flex-col gap-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm"
                style={{ color: "var(--text-secondary)" }}>
                {t("common.noResults")}
              </div>
            ) : (
              filtered.map((opt) => (
                <LanguageRow key={opt.value || "auto"} option={opt}
                  isSelected={opt.value === value}
                  onSelect={() => handleSelect(opt.value)} />
              ))
            )}
          </div>

          {/* Footer */}
          <div style={{ height: 1, background: "#2a2a40" }} />
          <div className="px-3 py-1.5 text-xs"
            style={{ color: "var(--text-secondary)" }}>
            {filtered.length}/{options.length} {t("common.languages")}
          </div>
        </div>
      )}
    </div>
  );
}
