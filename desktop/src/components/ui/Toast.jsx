import { createContext, useCallback, useContext, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";

/**
 * Toast — notification góc phải dưới, auto-dismiss. Stack nhiều toast.
 *
 * API:
 *   const t = useToast();
 *   t.success("Đã lưu"); t.error("Có lỗi"); t.info("..."); t.warn("...");
 */
const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((variant, message, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, variant, message, ...opts }]);
    const duration = opts.duration ?? 3500;
    if (duration > 0) {
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, duration);
    }
    return id;
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const api = {
    success: (m, o) => push("success", m, o),
    error:   (m, o) => push("error",   m, { duration: 6000, ...o }),
    warn:    (m, o) => push("warn",    m, o),
    info:    (m, o) => push("info",    m, o),
    dismiss,
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <Viewport toasts={toasts} onDismiss={dismiss} />
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

function Viewport({ toasts, onDismiss }) {
  return (
    <div
      style={{
        position: "fixed", bottom: 20, right: 20, zIndex: 200,
        display: "flex", flexDirection: "column-reverse", gap: 8,
        pointerEvents: "none",
      }}
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

const VARIANTS = {
  success: { Icon: CheckCircle2,    color: "var(--ok)" },
  error:   { Icon: XCircle,         color: "var(--err)" },
  warn:    { Icon: AlertTriangle,   color: "var(--warn)" },
  info:    { Icon: Info,            color: "var(--accent)" },
};

function ToastItem({ toast, onDismiss }) {
  const { Icon, color } = VARIANTS[toast.variant] || VARIANTS.info;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 20, transition: { duration: 0.1 } }}
      transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
      style={{
        minWidth: 280, maxWidth: 420,
        background: "var(--n-1)",
        border: "1px solid var(--n-3)",
        borderLeft: `2px solid ${color}`,
        borderRadius: 8,
        padding: "10px 12px",
        display: "flex", alignItems: "flex-start", gap: 10,
        fontSize: 13,
        color: "var(--n-9)",
        boxShadow: "var(--shadow-pop)",
        pointerEvents: "auto",
      }}
    >
      <Icon size={14} style={{ color, marginTop: 2, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        {toast.title && (
          <div style={{ color: "var(--n-10)", fontWeight: 500, marginBottom: 2 }}>
            {toast.title}
          </div>
        )}
        <div>{toast.message}</div>
      </div>
      <button
        onClick={onDismiss}
        aria-label="Đóng"
        style={{
          background: "transparent", border: "none", cursor: "pointer",
          color: "var(--n-6)", padding: 2, marginTop: -2,
        }}
      >
        <X size={12} />
      </button>
    </motion.div>
  );
}
