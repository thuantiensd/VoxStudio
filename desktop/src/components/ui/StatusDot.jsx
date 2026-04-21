const COLORS = {
  running:  "var(--accent)",
  pending:  "var(--n-6)",
  queued:   "var(--n-6)",
  done:     "var(--ok)",
  error:    "var(--err)",
  canceled: "var(--n-6)",
};

const LABELS = {
  running: "Đang chạy",
  pending: "Chờ",
  queued:  "Chờ",
  done:    "Hoàn tất",
  error:   "Lỗi",
  canceled:"Đã huỷ",
};

/**
 * StatusDot — dot + label, dùng thống nhất trong history/queue.
 */
export default function StatusDot({ status, withLabel = true, pulse }) {
  const color = COLORS[status] || COLORS.pending;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      fontSize: 12, color: "var(--n-9)",
    }}>
      <span
        style={{
          width: 6, height: 6, borderRadius: "50%",
          background: color,
          boxShadow: pulse ? `0 0 0 3px ${color}33` : "none",
          animation: pulse ? "pulse 2s ease-in-out infinite" : "none",
        }}
      />
      {withLabel && (LABELS[status] || status)}
    </span>
  );
}
