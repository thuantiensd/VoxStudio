/**
 * Button — primary/secondary/ghost/danger; sm/md.
 *
 * Props: variant, size, icon (leading), trailing, loading, disabled, onClick, children
 */
import { Loader2 } from "lucide-react";

const VARIANTS = {
  primary: {
    background: "var(--accent)",
    color: "#fff",
    border: "1px solid var(--accent)",
    hoverBg: "var(--accent-hover)",
  },
  secondary: {
    background: "var(--n-1)",
    color: "var(--n-10)",
    border: "1px solid var(--n-3)",
    hoverBg: "var(--n-2)",
  },
  ghost: {
    background: "transparent",
    color: "var(--n-9)",
    border: "1px solid transparent",
    hoverBg: "var(--n-2)",
  },
  danger: {
    background: "var(--err)",
    color: "#fff",
    border: "1px solid var(--err)",
    hoverBg: "#e04242",
  },
};

const SIZES = {
  sm: { height: 26, fontSize: 12, padX: 10, iconSize: 12 },
  md: { height: 32, fontSize: 13, padX: 12, iconSize: 14 },
  lg: { height: 38, fontSize: 14, padX: 14, iconSize: 14 },
};

export default function Button({
  variant = "secondary", size = "md",
  icon: Icon, trailing: Trailing,
  loading, disabled,
  children, onClick, type = "button",
  className = "", style: extStyle = {},
  ...rest
}) {
  const v = VARIANTS[variant] || VARIANTS.secondary;
  const s = SIZES[size] || SIZES.md;
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      onClick={onClick}
      className={className}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        gap: 6,
        height: s.height, padding: `0 ${s.padX}px`,
        borderRadius: 6,
        fontSize: s.fontSize, fontWeight: 500,
        letterSpacing: "-0.003em",
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.55 : 1,
        transition: "background var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease)",
        userSelect: "none",
        ...v,
        ...extStyle,
      }}
      onMouseEnter={(e) => {
        if (!isDisabled) e.currentTarget.style.background = v.hoverBg;
      }}
      onMouseLeave={(e) => {
        if (!isDisabled) e.currentTarget.style.background = v.background;
      }}
      {...rest}
    >
      {loading ? (
        <Loader2 size={s.iconSize} className="animate-spin" />
      ) : Icon ? (
        <Icon size={s.iconSize} />
      ) : null}
      {children}
      {Trailing && <Trailing size={s.iconSize} />}
    </button>
  );
}
