import { useEffect, useState } from "react";
import { Clock, CheckCircle2, XCircle, Loader2, Hourglass, Film, Folder, Ban } from "lucide-react";
import { useBatch } from "../batch/BatchContext";
import { thumbnailURL } from "../services/api";

/**
 * HistoryPage — hiển thị queue batch (đang chạy + đã xong) kèm thời gian xử lý.
 * Dữ liệu từ BatchContext (chỉ session hiện tại — sau có thể persist).
 */
export default function HistoryPage() {
  const { queue, outputFolder, clearDone } = useBatch();
  // Tick mỗi giây khi có job đang chạy để duration cập nhật
  const [, force] = useState(0);
  useEffect(() => {
    const hasRunning = queue.some((q) => q.status === "running");
    if (!hasRunning) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [queue]);

  const pending = queue.filter((q) => q.status === "pending");
  const running = queue.filter((q) => q.status === "running");
  const done = queue.filter((q) => q.status === "done");
  const errored = queue.filter((q) => q.status === "error");
  const canceled = queue.filter((q) => q.status === "canceled");

  return (
    <div className="p-6 mx-auto" style={{ maxWidth: 900, width: "100%" }}>
      <div className="flex items-center gap-3 mb-6">
        <Clock size={22} style={{ color: "var(--accent)" }} />
        <h2 className="text-xl font-semibold"
            style={{ color: "var(--text-primary)" }}>
          Lịch sử xử lý
        </h2>
      </div>

      {outputFolder && (
        <div className="flex items-center gap-2 mb-4 text-xs"
             style={{ color: "var(--text-secondary)" }}>
          <Folder size={12} />
          <span>Thư mục xuất: </span>
          <span style={{ color: "var(--text-primary)" }} title={outputFolder}>
            {outputFolder}
          </span>
        </div>
      )}

      {queue.length === 0 ? (
        <div className="text-center py-16"
             style={{ color: "var(--text-secondary)" }}>
          <Film size={40} className="mx-auto mb-3 opacity-50" />
          <p className="text-sm">Chưa có job nào. Upload video từ STT Studio.</p>
        </div>
      ) : (
        <>
          <StatsRow
            pending={pending.length}
            running={running.length}
            done={done.length}
            errored={errored.length}
            canceled={canceled.length}
          />

          <div className="mt-4 space-y-2">
            {queue.map((it) => (
              <JobRow key={it.projectId} item={it} />
            ))}
          </div>

          {done.length > 0 && (
            <button
              onClick={clearDone}
              className="mt-4 text-xs"
              style={{ color: "var(--text-secondary)" }}
            >
              Xoá {done.length} job đã xong
            </button>
          )}
        </>
      )}
    </div>
  );
}

function StatsRow({ pending, running, done, errored, canceled }) {
  return (
    <div className="grid grid-cols-5 gap-3">
      <Stat
        icon={<Hourglass size={14} />}
        label="Chờ" value={pending}
        color="var(--text-secondary)" />
      <Stat
        icon={<Loader2 size={14} className={running > 0 ? "animate-spin" : ""} />}
        label="Đang chạy" value={running}
        color="var(--accent)" />
      <Stat
        icon={<CheckCircle2 size={14} />}
        label="Xong" value={done}
        color="#22c55e" />
      <Stat
        icon={<XCircle size={14} />}
        label="Lỗi" value={errored}
        color="#ef4444" />
      <Stat
        icon={<Ban size={14} />}
        label="Đã huỷ" value={canceled}
        color="#9ca3af" />
    </div>
  );
}

function Stat({ icon, label, value, color }) {
  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid rgba(127,127,160,0.15)",
      }}
    >
      <div className="flex items-center gap-1.5 text-[11px] mb-1"
           style={{ color }}>
        {icon} {label}
      </div>
      <div className="text-lg font-semibold"
           style={{ color: "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );
}

function JobRow({ item }) {
  const statusInfo =
    item.status === "done" ? { color: "#22c55e", label: "Xong", Icon: CheckCircle2 }
    : item.status === "error" ? { color: "#ef4444", label: "Lỗi", Icon: XCircle }
    : item.status === "running" ? { color: "var(--accent)", label: "Đang chạy", Icon: Loader2 }
    : { color: "var(--text-secondary)", label: "Chờ", Icon: Hourglass };

  const duration =
    item.startedAt
      ? formatDuration(item.finishedAt || Date.now(), item.startedAt)
      : "—";

  const IconC = statusInfo.Icon;
  const showBar =
    item.status === "running" || item.status === "pending" ||
    (item.status === "done" && item.progress === 100);

  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid rgba(127,127,160,0.15)",
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex-shrink-0 rounded overflow-hidden relative flex items-center justify-center"
          style={{
            width: 56, height: 32,
            background: "linear-gradient(135deg, rgba(30,30,50,0.8), rgba(10,10,25,0.95))",
          }}
        >
          <img
            src={thumbnailURL(item.projectId)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
          <Film size={14} style={{ color: "rgba(255,255,255,0.25)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm truncate"
             style={{ color: "var(--text-primary)" }}
             title={item.filename}>
            {item.filename}
          </p>
          {(item.step || item.error) && (
            <p className="text-[11px] truncate"
               style={{ color: item.error ? "#ef4444" : "var(--text-secondary)" }}
               title={item.error || item.step}>
              {item.error || item.step}
            </p>
          )}
        </div>
        <span className="text-xs font-mono"
              style={{ color: "var(--text-secondary)" }}>
          {duration}
        </span>
        <div className="flex items-center gap-1.5 text-xs"
             style={{ color: statusInfo.color, minWidth: 96, justifyContent: "flex-end" }}>
          <IconC size={13} className={item.status === "running" ? "animate-spin" : ""} />
          {statusInfo.label}
          {item.status === "running" && typeof item.progress === "number" && (
            <span className="text-[11px]"
                  style={{ color: "var(--text-secondary)", marginLeft: 4 }}>
              {Math.round(item.progress)}%
            </span>
          )}
        </div>
      </div>
      {showBar && (
        <div
          className="h-1 rounded-full overflow-hidden mt-2"
          style={{ background: "rgba(127,127,160,0.15)" }}
        >
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${Math.max(0, Math.min(100, item.progress || 0))}%`,
              background:
                item.status === "error" ? "#ef4444"
                : item.status === "done" ? "#22c55e"
                : "var(--accent)",
            }}
          />
        </div>
      )}
    </div>
  );
}

function formatDuration(end, start) {
  const secs = Math.floor((end - start) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
