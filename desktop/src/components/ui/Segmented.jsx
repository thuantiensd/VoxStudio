import { motion } from "motion/react";

/**
 * Segmented — tab control.
 *   options: [{ value, label, icon? }]
 *   value, onChange
 */
export default function Segmented({ options, value, onChange }) {
  return (
    <div
      style={{
        display: "inline-flex",
        padding: 3, gap: 2,
        background: "var(--n-2)",
        border: "1px solid var(--n-3)",
        borderRadius: 8,
        position: "relative",
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            onClick={() => onChange?.(opt.value)}
            style={{
              position: "relative",
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 12px",
              borderRadius: 5,
              fontSize: 12, fontWeight: 500,
              color: active ? "var(--n-10)" : "var(--n-8)",
              background: "transparent",
              border: "none", cursor: "pointer",
              transition: "color var(--dur-fast) var(--ease)",
            }}
          >
            {active && (
              <motion.div
                layoutId="segmented-active"
                style={{
                  position: "absolute", inset: 0,
                  background: "var(--n-0)",
                  border: "1px solid var(--n-4)",
                  borderRadius: 5,
                  zIndex: 0,
                }}
                transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
              />
            )}
            <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6 }}>
              {Icon && <Icon size={12} />}
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
