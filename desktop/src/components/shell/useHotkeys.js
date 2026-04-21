import { useEffect } from "react";

/**
 * useHotkeys — đăng ký danh sách hotkey cho toàn app.
 *
 * hotkeys: { "mod+k": () => openPalette, "mod+1": () => navigate("/studio"), ... }
 *   mod = Cmd (Mac) | Ctrl (Win/Linux)
 *   shift/alt prefix hỗ trợ: "mod+shift+p"
 *
 * Skip khi target là input/textarea/contenteditable (trừ khi startsWith "mod+").
 */
export function useHotkeys(hotkeys, deps = []) {
  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const norm = (e) => {
      const parts = [];
      if (isMac ? e.metaKey : e.ctrlKey) parts.push("mod");
      if (e.shiftKey) parts.push("shift");
      if (e.altKey) parts.push("alt");
      const k = e.key.toLowerCase();
      if (!["meta", "control", "shift", "alt"].includes(k)) parts.push(k);
      return parts.join("+");
    };
    const onKey = (e) => {
      const combo = norm(e);
      const handler = hotkeys[combo];
      if (!handler) return;
      // Nếu là mod-combo → ưu tiên, luôn chặn default
      if (combo.startsWith("mod+")) {
        e.preventDefault();
        handler(e);
        return;
      }
      // Non-mod: bỏ qua khi đang gõ trong input
      const t = e.target;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      e.preventDefault();
      handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
