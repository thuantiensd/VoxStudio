import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  X, Loader2, Play, FolderOpen, RotateCcw, Settings, ChevronRight,
  AlertTriangle, Sparkles, Check, ExternalLink,
} from "lucide-react";
import { getDubbingProject, thumbnailURL, dubbingVideoURL, listEdgeVoices, updateProjectSettings } from "../../services/api";
import { useToast } from "../ui/Toast";
import { showError } from "../../services/errors";
import ProjectCard from "./ProjectCard";
import SegmentEditor from "./SegmentEditor";
import SubtitlePanel from "./panels/SubtitlePanel";

/**
 * ProjectDrawer — side panel trượt từ phải, không navigate đi đâu.
 *
 * UX:
 *   • Simple mode (default): video preview + 3 field gọn + actions (Mở file,
 *     Mở thư mục, Chỉnh lại với setting mới, Thử lại)
 *   • Expert mode: toggle button phía trên → xổ full DubbingTab /
 *     AdvancedTab như cũ, dùng cho pro user
 *
 * Click backdrop hoặc nút X để đóng. ESC cũng đóng.
 */
export default function ProjectDrawer({ item, open, onClose }) {
  const toast = useToast();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expert, setExpert] = useState(false);
  const [expertTab, setExpertTab] = useState("quick");

  useEffect(() => {
    if (!open || !item) {
      setProject(null);
      setExpert(false);
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
          {/* Drawer */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            style={{
              position: "fixed", top: 0, right: 0, bottom: 0,
              width: expert ? "min(1200px, 92vw)" : "min(560px, 92vw)",
              zIndex: 150,
              background: "var(--n-0)",
              borderLeft: "1px solid var(--n-3)",
              boxShadow: "-12px 0 28px rgba(0,0,0,0.25)",
              display: "flex", flexDirection: "column",
              overflow: "hidden",
              transition: "width 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)",
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
                title="Đóng (ESC)"
                aria-label="Đóng"
              >
                <X size={15} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 14, fontWeight: 600, color: "var(--n-10)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }} title={item?.filename}>
                  {item?.filename || item?.projectId || "Dự án"}
                </div>
                {project?.video_duration && (
                  <div style={{ fontSize: 11, color: "var(--n-7)", marginTop: 2 }}>
                    {formatDuration(project.video_duration)}
                    {project.target_language && ` · ${project.target_language}`}
                  </div>
                )}
              </div>
              <button
                onClick={() => setExpert((v) => !v)}
                style={{
                  ...iconBtn,
                  padding: "6px 10px",
                  background: expert ? "var(--accent-soft)" : "transparent",
                  color: expert ? "var(--accent)" : "var(--n-8)",
                  fontSize: 12, gap: 4, width: "auto",
                }}
                title={expert ? "Ẩn chế độ chuyên gia" : "Bật chế độ chuyên gia"}
              >
                <Settings size={12} />
                {expert ? "Đơn giản" : "Chuyên gia"}
              </button>
            </header>

            {/* Content */}
            <div style={{ flex: 1, overflowY: expert ? "hidden" : "auto",
                           display: "flex", flexDirection: "column" }}>
              {loading && (
                <div style={{
                  flex: 1, display: "flex", alignItems: "center",
                  justifyContent: "center", color: "var(--n-8)", gap: 8,
                }}>
                  <Loader2 size={16} className="animate-spin" /> Đang tải…
                </div>
              )}

              {!loading && !project && (
                <div style={{ padding: 24 }}>
                  {/* Fallback — project chưa load được (backend lỗi) — vẫn
                      hiển thị thumbnail + status dựa trên `item` của queue */}
                  <SimpleFallback item={item} onClose={onClose} />
                </div>
              )}

              {!loading && project && !expert && (
                <SimpleView
                  item={item}
                  project={project}
                  setProject={setProject}
                  onOpenFile={() => openOutput(item, toast)}
                  onRevealFolder={() => revealOutput(item)}
                />
              )}

              {!loading && project && expert && (
                <ExpertView
                  project={project}
                  setProject={setProject}
                  tab={expertTab}
                  setTab={setExpertTab}
                />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}


/* ─── Simple view — 95% user dùng ──────────────────────── */

function SimpleView({ item, project, setProject, onOpenFile, onRevealFolder }) {
  const isDone = item?.status === "done" && item?.outputPath;
  const isError = item?.status === "error";
  const isRunning = item?.status === "running" || item?.status === "pending";

  return (
    <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Preview */}
      <Preview item={item} project={project} />

      {/* Status / Actions */}
      {isDone && (
        <div style={{ display: "flex", gap: 8 }}>
          <ActionButton primary icon={Play} label="Mở video" onClick={onOpenFile} />
          <ActionButton icon={FolderOpen} label="Mở thư mục" onClick={onRevealFolder} />
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
          {item.step || "Đang xử lý…"} {item.progress ? `(${Math.round(item.progress)}%)` : ""}
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
            <AlertTriangle size={13} /> Xử lý thất bại
          </div>
          <div style={{ color: "var(--n-8)", lineHeight: 1.5 }}>
            {item.error || "Không rõ nguyên nhân. Vui lòng thử lại."}
          </div>
        </div>
      )}

      {/* Quick config — áp dụng khi re-run */}
      <QuickConfig project={project} setProject={setProject} />

      {/* Hint expert */}
      <div style={{
        padding: "10px 14px", borderRadius: 8,
        background: "var(--n-1)", border: "1px solid var(--n-3)",
        fontSize: 11.5, color: "var(--n-7)", lineHeight: 1.55,
        display: "flex", gap: 8,
      }}>
        <Sparkles size={13} style={{ flexShrink: 0, marginTop: 1,
                                       color: "var(--accent)" }} />
        <div>
          Cần chỉnh từng câu phụ đề, timing, hoặc kiểm soát chi tiết? Bật{" "}
          <b style={{ color: "var(--n-10)" }}>Chế độ chuyên gia</b> ở góc phải.
        </div>
      </div>
    </div>
  );
}


function Preview({ item, project }) {
  const isDone = item?.status === "done" && item?.outputPath;
  const videoSrc = isDone
    ? `file://${encodeURI(item.outputPath).replace(/#/g, "%23")}`
    : dubbingVideoURL(item.projectId);

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
          src={videoSrc}
          controls
          style={{ width: "100%", height: "100%", objectFit: "contain",
                    background: "#000" }}
        />
      ) : (
        <>
          <img
            src={thumbnailURL(item.projectId)}
            alt=""
            style={{
              position: "absolute", inset: 0,
              width: "100%", height: "100%", objectFit: "cover",
              opacity: 0.6,
            }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "rgba(255,255,255,0.5)",
            fontSize: 13,
          }}>
            {item.status === "running"
              ? "Đang xử lý… video sẽ hiện khi xong"
              : item.status === "error"
              ? "Xử lý thất bại"
              : "Chưa có video"}
          </div>
        </>
      )}
    </div>
  );
}


function QuickConfig({ project, setProject }) {
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
        Chỉnh nhanh
      </div>

      <Field label="Giọng đọc">
        <select
          value={project.voice_id || ""}
          onChange={(e) => patch({ voice_id: e.target.value || null })}
          style={selectStyle}
        >
          <option value="">Giọng mặc định</option>
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name || v.id}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Ngôn ngữ đích">
        <select
          value={project.target_language || "vietnamese"}
          onChange={(e) => patch({ target_language: e.target.value })}
          style={selectStyle}
        >
          <option value="vietnamese">Tiếng Việt</option>
          <option value="english">English</option>
          <option value="chinese">中文</option>
          <option value="japanese">日本語</option>
          <option value="korean">한국어</option>
        </select>
      </Field>

      <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
        <Checkbox
          label="Lồng tiếng"
          checked={!!project.enable_dubbing}
          onChange={(v) => patch({ enable_dubbing: v })}
        />
        <Checkbox
          label="Phụ đề"
          checked={!!project.enable_subtitle}
          onChange={(v) => patch({ enable_subtitle: v })}
        />
      </div>
    </div>
  );
}


function SimpleFallback({ item, onClose }) {
  return (
    <div style={{
      textAlign: "center", padding: "40px 20px",
      color: "var(--n-8)",
    }}>
      <AlertTriangle size={32} style={{ color: "var(--warn)", margin: "0 auto 10px" }} />
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--n-10)" }}>
        Không tải được chi tiết dự án
      </div>
      <div style={{ fontSize: 12, marginTop: 4 }}>
        Dự án có thể đang khởi tạo — vui lòng chờ 1 chút.
      </div>
      <ProjectCard item={item} onOpen={() => {}} />
    </div>
  );
}


/* ─── Expert view — pro user, 2-cột: SegmentEditor + Settings ──────── */

function ExpertView({ project, setProject, tab, setTab }) {
  const videoRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const toast = useToast();

  // Sync currentTime từ video player
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const tick = () => setCurrentTime(v.currentTime);
    const iv = setInterval(() => {
      if (!v.paused) tick();
    }, 200);
    v.addEventListener("seeked", tick);
    v.addEventListener("play", tick);
    return () => {
      clearInterval(iv);
      v.removeEventListener("seeked", tick);
      v.removeEventListener("play", tick);
    };
  }, [project?.id]);

  const handleSeek = (sec) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = sec;
    if (v.paused) v.play().catch(() => {});
  };

  const handleSegmentChange = (seg) => {
    setProject((p) => {
      if (!p) return p;
      return {
        ...p,
        segments: (p.segments || []).map((s) => s.id === seg.id ? { ...s, ...seg } : s),
      };
    });
  };

  return (
    <div style={{
      flex: 1, display: "flex", minHeight: 0, overflow: "hidden",
    }}>
      {/* Left column: video + segments */}
      <div style={{
        flex: 1, minWidth: 0,
        display: "flex", flexDirection: "column",
        borderRight: "1px solid var(--n-3)",
      }}>
        <div style={{
          flexShrink: 0,
          padding: 12,
          background: "var(--n-1)",
          borderBottom: "1px solid var(--n-3)",
        }}>
          <ExpertVideo project={project} videoRef={videoRef} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <SegmentEditor
            project={project}
            currentTime={currentTime}
            onSeek={handleSeek}
            onSegmentChange={handleSegmentChange}
          />
        </div>
      </div>

      {/* Right column: settings panels */}
      <div style={{
        flexShrink: 0, width: 320,
        display: "flex", flexDirection: "column",
        background: "var(--n-1)",
      }}>
        <div style={{
          flexShrink: 0,
          padding: "10px 14px",
          borderBottom: "1px solid var(--n-3)",
          display: "flex", gap: 4,
        }}>
          <TabBtn active={tab === "style"} onClick={() => setTab("style")}>
            Kiểu phụ đề
          </TabBtn>
          <TabBtn active={tab === "quick"} onClick={() => setTab("quick")}>
            Cài đặt
          </TabBtn>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {tab === "style" && (
            <SubtitlePanel project={project} setProject={setProject} />
          )}
          {tab === "quick" && (
            <div style={{ padding: 14 }}>
              <QuickConfig project={project} setProject={setProject} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function ExpertVideo({ project, videoRef }) {
  const [failed, setFailed] = useState(false);
  const src = dubbingVideoURL(project?.id);

  if (failed) {
    return (
      <div style={{
        aspectRatio: "16/9", maxHeight: 220,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--n-2)", borderRadius: 8,
        color: "var(--n-7)", fontSize: 12,
      }}>
        Chưa có video để xem (đang xử lý)
      </div>
    );
  }

  return (
    <div style={{
      background: "#000", borderRadius: 8, overflow: "hidden",
      maxHeight: 240,
    }}>
      <video
        ref={videoRef}
        src={src}
        controls
        style={{ width: "100%", maxHeight: 240, display: "block" }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}


/* ─── Small parts ─── */

function ActionButton({ icon: Icon, label, primary, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "9px 14px", borderRadius: 8,
        background: primary ? "var(--accent)" : "var(--n-1)",
        color: primary ? "#fff" : "var(--n-10)",
        border: primary ? "none" : "1px solid var(--n-3)",
        fontSize: 13, fontWeight: 500, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: 6,
      }}
    >
      <Icon size={13} /> {label}
    </button>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px", borderRadius: 6,
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent)" : "var(--n-8)",
        border: "none", cursor: "pointer",
        fontSize: 12.5, fontWeight: active ? 600 : 500,
      }}
    >
      {children}
    </button>
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
