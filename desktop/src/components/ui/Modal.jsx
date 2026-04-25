import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useEffect } from "react";
import { useT } from "../../i18n/I18nContext";

/**
 * Modal — centered dialog, backdrop blur, fade+scale 120ms.
 *
 * Props: open, onClose, title, actions (node), children, width
 */
export default function Modal({
  open, onClose, title, children, actions, width = 480,
}) {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={onClose}
          style={{
            position: "fixed", inset: 0, zIndex: 150,
            background: "rgba(0,0,0,0.45)",
            backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1,    y: 0 }}
            exit={{    opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width, maxWidth: "90vw", maxHeight: "85vh",
              background: "var(--n-1)",
              border: "1px solid var(--n-3)",
              borderRadius: 10,
              boxShadow: "var(--shadow-pop)",
              display: "flex", flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {title && (
              <div
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "14px 16px",
                  borderBottom: "1px solid var(--n-3)",
                }}
              >
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--n-10)", margin: 0 }}>
                  {title}
                </h3>
                <button
                  onClick={onClose}
                  aria-label={t("aria.close")}
                  style={{
                    background: "transparent", border: "none", cursor: "pointer",
                    color: "var(--n-8)", padding: 4,
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <div style={{
              padding: "14px 16px",
              overflowY: "auto",
              flex: 1,
              fontSize: 13, color: "var(--n-9)",
            }}>
              {children}
            </div>
            {actions && (
              <div style={{
                display: "flex", justifyContent: "flex-end", gap: 8,
                padding: "12px 16px",
                borderTop: "1px solid var(--n-3)",
                background: "var(--n-0)",
              }}>
                {actions}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
