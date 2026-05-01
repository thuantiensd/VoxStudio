import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  X, Loader2, FolderOpen, RotateCcw,
  AlertTriangle, Check, ExternalLink,
} from "lucide-react";
import { getDubbingProject, thumbnailURL, dubbingVideoURL, exportStreamURL, listEdgeVoices, updateProjectSettings } from "../../services/api";
import { useToast } from "../ui/Toast";
import { showError } from "../../services/errors";
import ProjectCard from "./ProjectCard";
import { useT } from "../../i18n/I18nContext";
import useAuthedImage from "../../hooks/useAuthedImage";

/**
 * ProjectDrawer — side panel trượt từ phải để xem nhanh dự án.
 *
 * Hiển thị: thumbnail/video preview + status (running/done/error) + actions
 * (Mở video, Mở thư mục, Thử lại) + cấu hình nhanh (giọng + đích + toggle).
 *
 * Click backdrop hoặc nút X để đóng. ESC cũng đóng.
 */
export default function ProjectDrawer({ item, open, onClose }) {
  const t = useT();
  const toast = useToast();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !item) {
      setProject(null);
      return;
    }
    setLoading(true);
    getDubbingProject(item.projectId)
      .then(setProject)
      .catch(() => setProject(null))
      .finally(() => setLoading(false));
  }, [open, item]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            style={{
              position: "fixed", inset: 0, zIndex: 140,
              background: "rgba(0,0,0,0.4)",
              backdropFilter: "blur(3px)",
            }}
          />
          {/* Modal nổi giữa màn hình */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            style={{
              position: "fixed", inset: 0, zIndex: 150,
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 24, pointerEvents: "none",
            }}
          >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(820px, 96vw)", maxHeight: "calc(100vh - 48px)",
              background: "var(--n-0)",
              border: "1px solid var(--n-3)",
              borderRadius: 12,
              boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
              display: "flex", flexDirection: "column",
              overflow: "hidden",
              pointerEvents: "auto",
            }}
          >
            {/* Header */}
            <header
              style={{
                flexShrink: 0,
                display: "flex", alignItems: "center", gap: 12,
                padding: "14px 18px",
                borderBottom: "1px solid var(--n-3)",
              }}
            >
              <button
                onClick={onClose}
                style={iconBtn}
                title={t("drawer.closeEsc")}
                aria-label={t("aria.close")}
              >
                <X size={15} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 14, fontWeight: 600, color: "var(--n-10)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }} title={item?.filename}>
                  {item?.filename || item?.projectId || t("drawer.project")}
                </div>
                {project?.video_duration && (
                  <div style={{ fontSize: 11, color: "var(--n-7)", marginTop: 2 }}>
                    {formatDuration(project.video_duration)}
                    {project.target_language && ` · ${project.target_language}`}
                  </div>
                )}
              </div>
            </header>

            {/* Content */}
            <div style={{ flex: 1, overflowY: "auto",
                           display: "flex", flexDirection: "column" }}>
              {loading && (
                <div style={{
                  flex: 1, display: "flex", alignItems: "center",
                  justifyContent: "center", color: "var(--n-8)", gap: 8,
                }}>
                  <Loader2 size={16} className="animate-spin" /> {t("drawer.loading")}
                </div>
              )}

              {!loading && !project && (
                <div style={{ padding: 24 }}>
                  <SimpleFallback item={item} onClose={onClose} />
                </div>
              )}

              {!loading && project && (
                <SimpleView
                  item={item}
                  project={project}
                  setProject={setProject}
                  onOpenFile={() => openOutput(item, toast)}
                  onRevealFolder={() => revealOutput(item)}
                />
              )}
            </div>
          </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}


/* ─── Simple view — 95% user dùng ──────────────────────── */

function SimpleView({ item, project, setProject, onOpenFile, onRevealFolder }) {
  const t = useT();
  // Ưu tiên status từ backend project (nguồn sự thật) — fallback queue item
  const status = project?.status || item?.status;
  const isDone = status === "done";
  const isError = status === "error" || item?.status === "error";
  const isRunning = !isDone && !isError &&
    (status === "running" || status === "pending" ||
     item?.status === "running" || item?.status === "pending");

  return (
    <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Preview — auto-play khi xong */}
      <Preview item={item} project={project} isDone={isDone} />

      {/* Done → chỉ nút mở thư mục (video tự phát ở trên). KHÔNG hiện cấu hình. */}
      {isDone && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onRevealFolder}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "9px 14px", borderRadius: 8,
              background: "var(--n-1)", color: "var(--n-10)",
              border: "1px solid var(--n-3)",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <FolderOpen size={14} /> {t("drawer.openFolder")}
          </button>
        </div>
      )}

      {isRunning && (
        <div style={{
          padding: "10px 14px", borderRadius: 8,
          background: "var(--accent-soft)",
          border: "1px solid var(--accent)",
          color: "var(--n-10)", fontSize: 12.5,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <Loader2 size={13} className="animate-spin" style={{ color: "var(--accent)" }} />
          {item?.step || t("drawer.processing")} {item?.progress ? `(${Math.round(item.progress)}%)` : ""}
        </div>
      )}

      {isError && (
        <div style={{
          padding: "10px 14px", borderRadius: 8,
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.3)",
          fontSize: 12.5,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6,
                         color: "var(--err)", fontWeight: 600, marginBottom: 4 }}>
            <AlertTriangle size={13} /> {t("drawer.failed")}
          </div>
          <div style={{ color: "var(--n-8)", lineHeight: 1.5 }}>
            {item?.error || t("drawer.unknownReason")}
          </div>
        </div>
      )}

      {/* Cấu hình nhanh — chỉ hiện khi CHƯA xong (chỉnh trước khi chạy lại) */}
      {!isDone && (
        <QuickConfig project={project} setProject={setProject} />
      )}
    </div>
  );
}


function Preview({ item, project, isDone }) {
  const t = useT();
  const projectId = item?.projectId || project?.id;
  // Khi xong: ưu tiên file local (nhanh, offline), nếu không có thì stream
  // file export đã dub (KHÔNG phải video gốc). Khi đang xử lý → video gốc.
  const videoSrc = item?.outputPath
    ? `file://${encodeURI(item.outputPath).replace(/#/g, "%23")}`
    : isDone
      ? exportStreamURL(projectId)
      : dubbingVideoURL(projectId);

  // Thumbnail cần auth header → fetch qua hook → blob URL
  const { src: thumbSrc } = useAuthedImage(
    !isDone && projectId ? thumbnailURL(projectId) : null
  );

  return (
    <div style={{
      aspectRatio: "16/9",
      background: "linear-gradient(135deg, rgba(30,30,50,0.8), rgba(10,10,25,0.95))",
      borderRadius: 10,
      overflow: "hidden",
      position: "relative",
    }}>
      {isDone ? (
        <video
          key={videoSrc}
          src={videoSrc}
          controls
          autoPlay
          style={{ width: "100%", height: "100%", objectFit: "contain",
                    background: "#000" }}
        />
      ) : (
        <>
          {thumbSrc && (
            <img
              src={thumbSrc}
              alt=""
              style={{
                position: "absolute", inset: 0,
                width: "100%", height: "100%", objectFit: "cover",
                opacity: 0.6,
              }}
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          )}
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "rgba(255,255,255,0.5)",
            fontSize: 13,
          }}>
            {item.status === "running"
              ? t("drawer.processingHint")
              : item.status === "error"
              ? t("drawer.failed")
              : t("drawer.noVideo")}
          </div>
        </>
      )}
    </div>
  );
}


function QuickConfig({ project, setProject }) {
  const t = useT();
  const toast = useToast();
  const [voices, setVoices] = useState([]);
  useEffect(() => {
    listEdgeVoices().then((d) => setVoices(d?.voices || [])).catch(() => {});
  }, []);

  const patch = async (changes) => {
    // Optimistic
    setProject((p) => ({ ...p, ...changes }));
    try {
      const updated = await updateProjectSettings(project.id, changes);
      if (updated?.project) setProject(updated.project);
    } catch (e) {
      showError(toast, e, { context: "update settings" });
    }
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 10,
      padding: 14, borderRadius: 10,
      background: "var(--n-1)", border: "1px solid var(--n-3)",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
                     textTransform: "uppercase", color: "var(--n-7)",
                     marginBottom: 4 }}>
        {t("drawer.quickEdit")}
      </div>

      <Field label={t("drawer.voice")}>
        <select
          value={project.voice_id || ""}
          onChange={(e) => patch({ voice_id: e.target.value || null })}
          style={selectStyle}
        >
          <option value="">{t("drawer.voiceDefault")}</option>
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name || v.id}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("drawer.targetLang")}>
        <select
          value={project.target_language || "vietnamese"}
          onChange={(e) => patch({ target_language: e.target.value })}
          style={selectStyle}
        >
          <option value="vietnamese">{t("langs.vietnamese")}</option>
          <option value="english">English</option>
          <option value="chinese">中文</option>
          <option value="japanese">日本語</option>
          <option value="korean">한국어</option>
        </select>
      </Field>

      <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
        <Checkbox
          label={t("drawer.dubbing")}
          checked={!!project.enable_dubbing}
          onChange={(v) => patch({ enable_dubbing: v })}
        />
        <Checkbox
          label={t("drawer.subtitle")}
          checked={!!project.enable_subtitle}
          onChange={(v) => patch({ enable_subtitle: v })}
        />
      </div>
    </div>
  );
}


function SimpleFallback({ item, onClose }) {
  const t = useT();
  return (
    <div style={{
      textAlign: "center", padding: "40px 20px",
      color: "var(--n-8)",
    }}>
      <AlertTriangle size={32} style={{ color: "var(--warn)", margin: "0 auto 10px" }} />
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--n-10)" }}>
        {t("drawer.fallbackTitle")}
      </div>
      <div style={{ fontSize: 12, marginTop: 4 }}>
        {t("drawer.fallbackHint")}
      </div>
      <ProjectCard item={item} onOpen={() => {}} />
    </div>
  );
}



function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--n-7)", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function Checkbox({ label, checked, onChange }) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: 6,
      fontSize: 12.5, color: "var(--n-10)", cursor: "pointer",
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--accent)" }}
      />
      {label}
    </label>
  );
}

function openOutput(item, toast) {
  if (!item?.outputPath) return;
  window.voxstudio?.openFileInApp?.(item.outputPath)
    .catch((err) => showError(toast, err, { context: "open file" }));
}

function revealOutput(item) {
  if (!item?.outputPath) return;
  window.voxstudio?.revealFileInFolder?.(item.outputPath);
}

function formatDuration(secs) {
  const s = Math.round(secs || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

const iconBtn = {
  width: 32, height: 32, borderRadius: 6,
  background: "transparent", border: "none",
  color: "var(--n-8)",
  cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  gap: 4,
};

const selectStyle = {
  width: "100%", height: 32, padding: "0 10px",
  background: "var(--n-0)", border: "1px solid var(--n-3)",
  borderRadius: 6, color: "var(--n-10)", fontSize: 13,
};
