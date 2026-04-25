import { AnimatePresence } from "motion/react";
import { Trash2, AlertTriangle } from "lucide-react";
import ProjectCard from "./ProjectCard";
import { useBatch } from "../../batch/BatchContext";
import { useT } from "../../i18n/I18nContext";

/**
 * ProjectGrid — 2 section: "Đang xử lý" và "Hoàn tất hôm nay".
 *
 * Hiển thị flat grid 4 cột responsive. Nếu không có job nào thì render null
 * (để DropZone chiếm hết không gian trang).
 */
export default function ProjectGrid({ queue, onOpen, onRetry }) {
  const t = useT();
  const { clearByStatus } = useBatch();
  if (!queue?.length) return null;

  const active = queue.filter((q) =>
    q.status === "running" || q.status === "pending"
  );
  const done = queue.filter((q) => q.status === "done");
  const errored = queue.filter((q) =>
    q.status === "error" || q.status === "canceled"
  );
  const finished = [...done, ...errored];

  return (
    <div style={{ marginTop: 28 }}>
      {active.length > 0 && (
        <Section title={t("grid.sectionActive")} count={active.length}>
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
        <Section
          title={t("grid.sectionRecent")}
          count={finished.length}
          mt={active.length > 0 ? 28 : 0}
          actions={
            <>
              {done.length > 0 && (
                <ClearBtn
                  onClick={() => clearByStatus("done")}
                  icon={Trash2}
                  label={t("grid.clearDone", { n: done.length })}
                />
              )}
              {errored.length > 0 && (
                <ClearBtn
                  onClick={() => clearByStatus(["error", "canceled"])}
                  icon={AlertTriangle}
                  label={t("grid.clearErrors", { n: errored.length })}
                  danger
                />
              )}
            </>
          }
        >
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

function ClearBtn({ onClick, icon: Icon, label, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "4px 10px", borderRadius: 6,
        background: "transparent",
        border: "1px solid var(--n-3)",
        color: danger ? "var(--err)" : "var(--n-8)",
        fontSize: 11, fontWeight: 500, cursor: "pointer",
        letterSpacing: 0, textTransform: "none",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger
          ? "rgba(239,68,68,0.08)"
          : "var(--n-2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <Icon size={10} />
      {label}
    </button>
  );
}

function Section({ title, count, children, mt = 0, actions }) {
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
        {actions && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {actions}
          </div>
        )}
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
