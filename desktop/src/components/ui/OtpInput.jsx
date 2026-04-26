import { useEffect, useRef } from "react";

/**
 * OtpInput — 6 ô nhập 1 chữ số. Auto-focus next on type, backspace
 * goes back, paste auto-fill 6 chữ số. Controlled component.
 *
 * Props:
 *   value: string (chuỗi 0-6 chữ số)
 *   onChange(next: string)
 *   onComplete?(code: string) — gọi khi đủ 6 chữ số
 *   length?: number = 6
 *   autoFocus?: bool = true
 *   disabled?: bool
 */
export default function OtpInput({
  value = "",
  onChange,
  onComplete,
  length = 6,
  autoFocus = true,
  disabled = false,
}) {
  const refs = useRef([]);
  const digits = value.padEnd(length, " ").slice(0, length).split("");

  useEffect(() => {
    if (autoFocus && refs.current[0]) refs.current[0].focus();
  }, [autoFocus]);

  const setDigit = (i, ch) => {
    const arr = digits.slice();
    arr[i] = ch;
    const next = arr.join("").replace(/\s/g, "");
    onChange?.(next);
    if (next.length === length) onComplete?.(next);
  };

  const onKey = (e, i) => {
    if (e.key === "Backspace") {
      if (digits[i].trim()) {
        setDigit(i, " ");
      } else if (i > 0) {
        refs.current[i - 1]?.focus();
        setDigit(i - 1, " ");
      }
      e.preventDefault();
    } else if (e.key === "ArrowLeft" && i > 0) {
      refs.current[i - 1]?.focus();
      e.preventDefault();
    } else if (e.key === "ArrowRight" && i < length - 1) {
      refs.current[i + 1]?.focus();
      e.preventDefault();
    }
  };

  const onInput = (e, i) => {
    const ch = e.target.value.replace(/\D/g, "").slice(-1);
    if (!ch) {
      setDigit(i, " ");
      return;
    }
    setDigit(i, ch);
    if (i < length - 1) refs.current[i + 1]?.focus();
  };

  const onPaste = (e) => {
    const txt = (e.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, length);
    if (!txt) return;
    e.preventDefault();
    onChange?.(txt);
    if (txt.length === length) onComplete?.(txt);
    const focusIdx = Math.min(txt.length, length - 1);
    refs.current[focusIdx]?.focus();
  };

  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          value={digits[i].trim()}
          onChange={(e) => onInput(e, i)}
          onKeyDown={(e) => onKey(e, i)}
          onPaste={onPaste}
          disabled={disabled}
          style={{
            width: 44, height: 52,
            textAlign: "center",
            fontSize: 24, fontWeight: 600,
            fontFamily: "var(--font-mono, 'SF Mono', Menlo, monospace)",
            color: "var(--n-10)",
            background: "var(--n-1)",
            border: `1.5px solid ${digits[i].trim() ? "var(--accent)" : "var(--n-3)"}`,
            borderRadius: 8,
            outline: "none",
            transition: "border-color 0.12s",
            opacity: disabled ? 0.5 : 1,
          }}
        />
      ))}
    </div>
  );
}
