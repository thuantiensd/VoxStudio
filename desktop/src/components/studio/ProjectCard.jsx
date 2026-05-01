import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  Film, X, Loader2, Check, AlertTriangle, RotateCcw,
  FolderOpen, Play, Settings, Hourglass, Clock,
} from "lucide-react";
import { useBatch } from "../../batch/BatchContext";
import { useToast } from "../ui/Toast";
import { thumbnailURL } from "../../services/api";
import { showError } from "../../services/errors";
import { useT } from "../../i18n/I18nContext";
import useAuthedImage from "../../hooks/useAuthedImage";

/**
 * ProjectCard — 1 card hiển thị 1 dự án trong grid.
 *
 * Trạng thái hiển thị khác nhau:
 *   pending  → xám + icon Hourglass
 *   running  → progress bar + current step realtime
 *   done     → thumbnail + [Mở file] [Mở thư mục] [Chi tiết]
 *   error    → đỏ + [Thử lại] [Xoá]
 *   canceled → xám + [Xoá]
 */
export default function ProjectCard({ item, onOpen, onRetry }) {
  const t = useT();
  const { cancelItem, removeItem } = useBatch();
  const toast = useToast();

  const isPending = item.status === "pending";
  const isRunning = item.status === "running";
  const isDone = item.status === "done";
  const isError = item.status === "error";
  const isCanceled = item.status === "canceled";
  const canCancel = isRunning || isPending;
  const active = isRunning || isPending;

  // Auto-tick mỗi giây khi running để ETA + relTime cập nhật
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [active]);

  const handleCancel = (e) => {
    e.stopPropagation();
    if (canCancel) {
      if (confirm(t("grid.cancelConfirm", { name: item.filename || item.projectId }))) {
        cancelItem(item.projectId);
      }
    } else {
      removeItem(item.projectId);
    }
  };

  const handleOpenFile = (e) => {
    e?.stopPropagation?.();
    if (!isDone || !item.outputPath) return;
    window.voxstudio?.openFileInApp?.(item.outputPath)
      .catch((err) => showError(toast, err, { context: "open file" }));
  };

  const handleReveal = (e) => {
    e.stopPropagation();
    if (!item.outputPath) return;
    window.voxstudio?.revealFileInFolder?.(item.outputPath);
  };

  const handleRetry = (e) => {
    e.stopPropagation();
    onRetry?.(item);
  };

  // ETA tính từ progress + elapsed
  const eta = (() => {
    if (!isRunning || !item.startedAt || !item.progress) return null;
    const elapsed = (Date.now() - item.startedAt) / 1000;
    const remain = (elapsed / item.progress) * (100 - item.progress);
    if (!isFinite(remain) || remain > 3600 || remain < 2) return null;
    const m = Math.floor(remain / 60);
    const s = Math.floor(remain % 60);
    return m > 0 ? `${m}p` : `${s}s`;
  })();

  // Thời gian tương đối (đã xong X phút trước)
  const relTime = (() => {
    const ts = item.finishedAt || item.startedAt;
    if (!ts) return t("grid.justAdded");
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60) return t("grid.relSec", { s: secs });
    const m = Math.floor(secs / 60);
    if (m < 60) return t("grid.relMin", { m });
    const h = Math.floor(m / 60);
    if (h < 24) return t("grid.relHour", { h });
    return t("grid.relDay", { d: Math.floor(h / 24) });
  })();

  const borderColor =
    isError    ? "rgba(239,68,68,0.35)" :
    isRunning  ? "var(--accent)" :
    isDone     ? "var(--n-3)" :
    "var(--n-3)";

  // Thumbnail cần auth header → fetch qua hook → blob URL.
  // Chỉ load khi project đã có id và pipeline đủ tiến triển để có thumbnail.
  const showThumb = !!item.projectId && (isRunning || isDone);
  const { src: thumbSrc } = useAuthedImage(
    showThumb ? thumbnailURL(item.projectId) : null
  );

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.18 }}
      onClick={() => onOpen?.(item)}
      style={{
        borderRadius: 12,
        overflow: "hidden",
        background: "var(--n-1)",
        border: `1px solid ${borderColor}`,
        cursor: isDone || isError ? "pointer" : "default",
        display: "flex", flexDirection: "column",
        transition: "border-color 0.15s ease",
      }}
    >
      {/* Thumbnail area 16:9 */}
      <div
        style={{
          position: "relative",
          aspectRatio: "16/9",
          background: "linear-gradient(135deg, rgba(30,30,50,0.8), rgba(10,10,25,0.95))",
          overflow: "hidden",
        }}
      >
        {thumbSrc && (
          <img
            src={thumbSrc}
            alt=""
            style={{
              position: "absolute", inset: 0,
              width: "100%", height: "100%", objectFit: "cover",
            }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        )}
        {/* Fallback icon */}
        <div
          style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none", zIndex: 0,
          }}
        >
          <Film size={36} style={{ color: "rgba(255,255,255,0.12)" }} />
        </div>

        {/* Status badge top-left */}
        <StatusBadge status={item.status} />

        {/* Close/cancel button top-right */}
        <button
          onClick={handleCancel}
          title={canCancel ? t("grid.cancelTitle") : t("grid.removeTitle")}
          style={{
            position: "absolute", top: 8, right: 8,
            width: 22, height: 22,
            borderRadius: "50%",
            background: canCancel ? "rgba(239,68,68,0.88)" : "rgba(0,0,0,0.6)",
            color: "#fff", border: "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", backdropFilter: "blur(4px)",
          }}
        >
          <X size={11} />
        </button>

        {/* Progress overlay khi running/pending */}
        {active && (
          <ProgressOverlay
            isRunning={isRunning}
            progress={item.progress || 0}
            step={item.step}
            eta={eta}
          />
        )}

        {/* Error overlay */}
        {isError && (
          <div
            style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              background: "rgba(239,68,68,0.9)",
              padding: "8px 12px",
              color: "#fff", fontSize: 11,
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <AlertTriangle size={12} />
            <span style={{ flex: 1 }} title={item.error}>
              {truncate(item.error, 60) || t("grid.failedDefault")}
            </span>
          </div>
        )}

        {/* Play button overlay khi done */}
        {isDone && item.outputPath && (
          <button
            onClick={handleOpenFile}
            style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              width: 48, height: 48,
              borderRadius: "50%",
              background: "rgba(108,92,231,0.9)",
              color: "#fff", border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", backdropFilter: "blur(8px)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
            title={t("grid.openVideo")}
          >
            <Play size={18} fill="#fff" />
          </button>
        )}
      </div>

      {/* Meta + actions */}
      <div style={{ padding: "10px 12px" }}>
        <div
          style={{
            fontSize: 12.5, fontWeight: 500, color: "var(--n-10)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}
          title={item.filename}
        >
          {item.filename || item.projectId}
        </div>
        <div
          style={{
            fontSize: 10.5, color: "var(--n-7)", marginTop: 2,
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <Clock size={9} /> {relTime}
          </span>
          {isDone && item.outputPath && (
            <button
              onClick={handleReveal}
              style={{
                marginLeft: "auto", background: "transparent", border: "none",
                color: "var(--accent)", fontSize: 10.5, cursor: "pointer",
                padding: 0,
              }}
              title={t("grid.showInFinder")}
            >
              {t("grid.openFolder")}
            </button>
          )}
          {isError && (
            <button
              onClick={handleRetry}
              style={{
                marginLeft: "auto", background: "transparent", border: "none",
                color: "var(--accent)", fontSize: 10.5, cursor: "pointer",
                padding: 0,
                display: "flex", alignItems: "center", gap: 3,
              }}
              title={t("grid.retry")}
            >
              <RotateCcw size={10} /> {t("grid.retry")}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function StatusBadge({ status }) {
  const t = useT();
  const cfg = {
    pending:  { labelKey: "status.badgePending", bg: "rgba(107,114,128,0.85)", icon: Hourglass },
    running:  { labelKey: "status.badgeRunning", bg: "rgba(108,92,231,0.88)", icon: Loader2 },
    done:     { labelKey: "status.badgeDone",    bg: "rgba(34,197,94,0.88)",  icon: Check },
    error:    { labelKey: "status.badgeError",   bg: "rgba(239,68,68,0.88)",  icon: AlertTriangle },
    canceled: { labelKey: "status.badgeCanceled",bg: "rgba(148,163,184,0.88)", icon: X },
  }[status] || {};
  if (!cfg.labelKey) return null;
  const Icon = cfg.icon;
  return (
    <div
      style={{
        position: "absolute", top: 8, left: 8,
        padding: "3px 8px", borderRadius: 4,
        background: cfg.bg, color: "#fff",
        fontSize: 10, fontWeight: 600,
        display: "flex", alignItems: "center", gap: 4,
        backdropFilter: "blur(4px)",
      }}
    >
      <Icon size={10} className={status === "running" ? "animate-spin" : ""} />
      {t(cfg.labelKey)}
    </div>
  );
}

function ProgressOverlay({ isRunning, progress, step, eta }) {
  const t = useT();
  return (
    <div
      style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
        padding: "18px 12px 10px",
      }}
    >
      {step && (
        <p style={{
          fontSize: 10.5, color: "rgba(255,255,255,0.92)",
          marginBottom: 6,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {step}
        </p>
      )}
      <div
        style={{
          position: "relative",
          height: 18, borderRadius: 4,
          background: "rgba(255,255,255,0.18)",
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.2)",
        }}
      >
        <div
          style={{
            position: "absolute", left: 0, top: 0, bottom: 0,
            width: `${Math.max(0, Math.min(100, progress))}%`,
            background: "linear-gradient(90deg, #16a34a, #22c55e)",
            transition: "width 600ms linear",
          }}
        />
        <div
          style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", gap: 5,
            padding: "0 8px",
          }}
        >
          {isRunning
            ? <Loader2 size={9} className="animate-spin" color="#fff" />
            : <Hourglass size={9} color="#fff" />}
          <span style={{
            fontSize: 10, fontWeight: 600, color: "#fff",
            textShadow: "0 1px 2px rgba(0,0,0,0.5)",
          }}>
            {Math.round(progress)}%
          </span>
          {eta && (
            <span style={{
              fontSize: 9.5, color: "rgba(255,255,255,0.85)",
              textShadow: "0 1px 2px rgba(0,0,0,0.5)",
            }}>
              {t("grid.etaSuffix", { eta })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
