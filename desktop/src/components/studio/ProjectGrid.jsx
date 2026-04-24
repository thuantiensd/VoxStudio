import { AnimatePresence } from "motion/react";
import ProjectCard from "./ProjectCard";

/**
 * ProjectGrid — 2 section: "Đang xử lý" và "Hoàn tất hôm nay".
 *
 * Hiển thị flat grid 4 cột responsive. Nếu không có job nào thì render null
 * (để DropZone chiếm hết không gian trang).
 */
export default function ProjectGrid({ queue, onOpen, onRetry }) {
  if (!queue?.length) return null;

  const active = queue.filter((q) =>
    q.status === "running" || q.status === "pending"
  );
  const finished = queue.filter((q) =>
    q.status === "done" || q.status === "error" || q.status === "canceled"
  );

  return (
    <div style={{ marginTop: 28 }}>
      {active.length > 0 && (
        <Section title="Đang xử lý" count={active.length}>
          <Grid>
            <AnimatePresence>
              {active.map((it) => (
                <ProjectCard
                  key={it.projectId}
                  item={it}
                  onOpen={onOpen}
                  onRetry={onRetry}
                />
              ))}
            </AnimatePresence>
          </Grid>
        </Section>
      )}

      {finished.length > 0 && (
        <Section title="Đã xử lý gần đây" count={finished.length} mt={active.length > 0 ? 28 : 0}>
          <Grid>
            <AnimatePresence>
              {finished.map((it) => (
                <ProjectCard
                  key={it.projectId}
                  item={it}
                  onOpen={onOpen}
                  onRetry={onRetry}
                />
              ))}
            </AnimatePresence>
          </Grid>
        </Section>
      )}
    </div>
  );
}

function Section({ title, count, children, mt = 0 }) {
  return (
    <div style={{ marginTop: mt }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          marginBottom: 12,
          fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--n-7)",
        }}
      >
        <span>{title}</span>
        <span
          style={{
            padding: "1px 7px", borderRadius: 10,
            background: "var(--n-2)", color: "var(--n-8)",
            fontSize: 10, letterSpacing: 0,
          }}
        >
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

function Grid({ children }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}
