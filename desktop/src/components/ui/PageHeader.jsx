/**
 * PageHeader — consistent header cho mọi page.
 *
 * Props: title, subtitle, children (actions slot bên phải)
 */
export default function PageHeader({ title, subtitle, children }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 16,
        padding: "20px 24px 14px",
        borderBottom: "1px solid var(--n-2)",
        flexShrink: 0,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1 style={{
          fontSize: 20, fontWeight: 600, letterSpacing: "var(--tr-tight)",
          color: "var(--n-10)", margin: 0, lineHeight: 1.2,
        }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{
            marginTop: 4, fontSize: 12, color: "var(--n-8)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {subtitle}
          </p>
        )}
      </div>
      {children && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * PageContent — wrapper cho main scroll area.
 */
export function PageContent({ children, maxWidth, padded = true }) {
  return (
    <div style={{
      flex: 1, overflowY: "auto",
      padding: padded ? "20px 24px" : 0,
    }}>
      <div style={{ maxWidth, margin: maxWidth ? "0 auto" : undefined }}>
        {children}
      </div>
    </div>
  );
}

/**
 * Page — flex column shell cho mọi page (Header trên, Content scroll dưới).
 */
export function Page({ children }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100%", overflow: "hidden",
      background: "var(--n-0)",
    }}>
      {children}
    </div>
  );
}
