import { useEffect, useMemo, useState } from "react";
import {
  Loader2, Hourglass, Film, Folder, Ban, Search, ExternalLink,
  FolderOpen as FolderOpenIcon, X, FileVideo,
} from "lucide-react";
import { useBatch } from "../batch/BatchContext";
import { thumbnailURL } from "../services/api";
import { Table, THead, TBody, Th, Tr, Td } from "../components/ui/Table";
import StatusDot from "../components/ui/StatusDot";
import Segmented from "../components/ui/Segmented";
import Button from "../components/ui/Button";
import { useT } from "../i18n/I18nContext";

/**
 * HistoryPage — Linear-style table + filter + sort.
 */
export default function HistoryPage() {
  const t = useT();
  const { queue, outputFolder, clearDone, cancelItem, removeItem } = useBatch();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Tick mỗi giây khi có running job
  const [, force] = useState(0);
  useEffect(() => {
    const has = queue.some((q) => q.status === "running");
    if (!has) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [queue]);

  const stats = useMemo(() => ({
    all:      queue.length,
    running:  queue.filter((q) => q.status === "running").length,
    pending:  queue.filter((q) => q.status === "pending").length,
    done:     queue.filter((q) => q.status === "done").length,
    error:    queue.filter((q) => q.status === "error").length,
    canceled: queue.filter((q) => q.status === "canceled").length,
  }), [queue]);

  const rows = useMemo(() => {
    let r = [...queue].reverse(); // latest first
    if (filter !== "all") r = r.filter((q) => q.status === filter);
    if (search.trim()) {
      const s = search.toLowerCase();
      r = r.filter((q) => (q.filename || "").toLowerCase().includes(s));
    }
    return r;
  }, [queue, filter, search]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title={t("shell.titleHistory")}
                  subtitle={outputFolder} outputFolder={outputFolder} />

      <div className="px-6 pt-3 pb-2 flex items-center gap-3"
           style={{ borderBottom: "1px solid var(--n-2)" }}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all",      label: `Tất cả · ${stats.all}` },
            { value: "running",  label: `Đang · ${stats.running}` },
            { value: "pending",  label: `Chờ · ${stats.pending}` },
            { value: "done",     label: `Xong · ${stats.done}` },
            { value: "error",    label: `Lỗi · ${stats.error}` },
            { value: "canceled", label: `Huỷ · ${stats.canceled}` },
          ]}
        />
        <div className="relative flex-1 max-w-xs">
          <Search size={12} style={{
            position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
            color: "var(--n-6)", pointerEvents: "none",
          }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm filename…"
            style={{
              width: "100%", height: 30,
              padding: "0 10px 0 28px",
              background: "var(--n-1)",
              border: "1px solid var(--n-3)",
              borderRadius: 6,
              fontSize: 12, color: "var(--n-10)",
            }}
          />
        </div>
        {stats.done > 0 && (
          <Button size="sm" variant="ghost" onClick={clearDone}>
            Xoá {stats.done} đã xong
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-3">
        {rows.length === 0 ? (
          <Empty />
        ) : (
          <Table>
            <THead>
              <Th width={56} />
              <Th>Tên</Th>
              <Th width={140}>Trạng thái</Th>
              <Th width={140}>Bước</Th>
              <Th width={100}>Thời gian</Th>
              <Th width={90} align="right"> </Th>
            </THead>
            <TBody>
              {rows.map((it) => (
                <HistoryRow
                  key={it.projectId}
                  item={it}
                  onCancel={() => cancelItem(it.projectId)}
                  onRemove={() => removeItem(it.projectId)}
                />
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function PageHeader({ title, outputFolder }) {
  return (
    <div className="flex items-center justify-between px-6 pt-6 pb-3"
         style={{ borderBottom: "1px solid var(--n-2)" }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--n-10)", margin: 0 }}>
          {title}
        </h1>
        {outputFolder && (
          <div className="flex items-center gap-1.5 mt-1 text-xs"
               style={{ color: "var(--n-8)" }}>
            <Folder size={11} />
            <span>Lưu vào:</span>
            <span className="font-mono" style={{ color: "var(--n-9)" }}
                  title={outputFolder}>
              {outputFolder}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-20"
         style={{ color: "var(--n-8)" }}>
      <FileVideo size={40} style={{ opacity: 0.35, marginBottom: 10 }} />
      <p style={{ fontSize: 13 }}>
        Chưa có job nào. Upload video từ Studio để bắt đầu.
      </p>
    </div>
  );
}

function HistoryRow({ item, onCancel, onRemove }) {
  const isRunning = item.status === "running";
  const isPending = item.status === "pending";
  const canCancel = isRunning || isPending;

  const duration = item.startedAt
    ? formatDuration(item.finishedAt || Date.now(), item.startedAt)
    : "—";

  return (
    <Tr>
      <Td>
        <div
          className="flex-shrink-0 rounded overflow-hidden relative flex items-center justify-center"
          style={{
            width: 44, height: 26,
            background: "var(--n-2)",
            border: "1px solid var(--n-3)",
          }}
        >
          <img
            src={thumbnailURL(item.projectId)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
          <Film size={10} style={{ color: "var(--n-5)" }} />
        </div>
      </Td>
      <Td title={item.filename}>
        <div style={{ color: "var(--n-10)", fontWeight: 500, fontSize: 13 }}>
          {item.filename}
        </div>
        {(item.error || item.step) && (
          <div style={{ fontSize: 11, color: item.error ? "var(--err)" : "var(--n-8)",
                         overflow: "hidden", textOverflow: "ellipsis", maxWidth: 380 }}>
            {item.error || item.step}
          </div>
        )}
      </Td>
      <Td>
        <StatusDot status={item.status} pulse={isRunning} />
        {isRunning && typeof item.progress === "number" && (
          <span className="font-mono" style={{ marginLeft: 6, color: "var(--n-8)", fontSize: 11 }}>
            {Math.round(item.progress)}%
          </span>
        )}
      </Td>
      <Td>
        {isRunning ? (
          <div
            style={{
              height: 4, borderRadius: 2,
              background: "var(--n-2)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.max(0, Math.min(100, item.progress || 0))}%`,
                background: "var(--accent)",
                transition: "width 600ms linear",
              }}
            />
          </div>
        ) : (
          <span style={{ color: "var(--n-8)" }}>—</span>
        )}
      </Td>
      <Td>
        <span className="font-mono" style={{ color: "var(--n-8)", fontSize: 12 }}>
          {duration}
        </span>
      </Td>
      <Td align="right">
        <div className="flex items-center gap-1 justify-end">
          {item.status === "done" && item.outputPath && (
            <>
              <IconBtn
                title="Mở file"
                onClick={(e) => { e.stopPropagation();
                  window.voxstudio?.openFileInApp?.(item.outputPath); }}
              >
                <ExternalLink size={12} />
              </IconBtn>
              <IconBtn
                title="Hiện trong Finder"
                onClick={(e) => { e.stopPropagation();
                  window.voxstudio?.revealFileInFolder?.(item.outputPath); }}
              >
                <FolderOpenIcon size={12} />
              </IconBtn>
            </>
          )}
          <IconBtn
            title={canCancel ? "Huỷ" : "Xoá"}
            danger={canCancel}
            onClick={(e) => {
              e.stopPropagation();
              canCancel ? onCancel() : onRemove();
            }}
          >
            <X size={12} />
          </IconBtn>
        </div>
      </Td>
    </Tr>
  );
}

function IconBtn({ children, onClick, title, danger }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 24, height: 24,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: "transparent", border: "none", cursor: "pointer",
        borderRadius: 4,
        color: "var(--n-8)",
        transition: "all var(--dur-fast) var(--ease)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? "rgba(248,81,73,0.15)" : "var(--n-2)";
        e.currentTarget.style.color = danger ? "var(--err)" : "var(--n-10)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--n-8)";
      }}
    >
      {children}
    </button>
  );
}

function formatDuration(end, start) {
  const secs = Math.floor((end - start) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
