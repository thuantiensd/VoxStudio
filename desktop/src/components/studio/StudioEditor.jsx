import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Mic, SlidersHorizontal } from "lucide-react";
import { getDubbingProject } from "../../services/api";
import { useT } from "../../i18n/I18nContext";
import DubbingTab from "./DubbingTab";
import AdvancedTab from "./AdvancedTab";

/**
 * StudioEditor — sau khi upload xong, user rơi vào đây.
 * Khung chỉ chứa topbar + tab switcher. Nội dung từng tab sống trong
 * DubbingTab / AdvancedTab.
 */
export default function StudioEditor() {
  const t = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("dubbing"); // "dubbing" | "advanced"

  useEffect(() => {
    let cancelled = false;
    // Demo mode để xem giao diện khi chưa có backend. Sẽ xóa ở Bước 5.
    if (id === "demo") {
      setProject(buildDemoProject());
      setLoading(false);
      return;
    }
    getDubbingProject(id)
      .then((p) => !cancelled && setProject(p))
      .catch(() => !cancelled && setProject(null))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={20} className="animate-spin"
                 style={{ color: "var(--accent)" }} />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {t("studio.notFound")}
        </p>
        <button
          onClick={() => navigate("/studio")}
          className="text-sm underline"
          style={{ color: "var(--accent)" }}
        >
          ← {t("studio.back")}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col"
         style={{ background: "var(--bg-primary)" }}>
      {/* ── Topbar ── */}
      <div
        className="flex items-center gap-3 px-3 h-12 flex-shrink-0"
        style={{
          background: "var(--bg-surface)",
          borderBottom: "1px solid rgba(127,127,160,0.15)",
        }}
      >
        <button
          onClick={() => navigate("/studio")}
          className="p-1.5 rounded hover:bg-white/10 transition-colors"
          style={{ color: "var(--text-secondary)" }}
          title={t("studio.back")}
        >
          <ArrowLeft size={16} />
        </button>
        <div className="w-px h-5"
             style={{ background: "rgba(127,127,160,0.2)" }} />
        <p className="text-sm truncate"
           style={{ color: "var(--text-primary)", maxWidth: 260 }}
           title={project.video_filename}>
          {project.video_filename}
        </p>

        {/* Tab switcher — trung tâm */}
        <div className="flex-1 flex justify-center">
          <div
            className="flex rounded-md overflow-hidden"
            style={{
              background: "rgba(0,0,0,0.2)",
              border: "1px solid rgba(127,127,160,0.15)",
            }}
          >
            <TabButton
              active={tab === "dubbing"}
              onClick={() => setTab("dubbing")}
              icon={<Mic size={13} />}
              label={t("studio.tabs.dubbing")}
            />
            <TabButton
              active={tab === "advanced"}
              onClick={() => setTab("advanced")}
              icon={<SlidersHorizontal size={13} />}
              label={t("studio.tabs.advanced")}
            />
          </div>
        </div>

        {/* Phải: để trống, từng tab tự thêm nút export */}
        <div style={{ minWidth: 1 }} />
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "dubbing" ? (
          <DubbingTab project={project} setProject={setProject} />
        ) : (
          <AdvancedTab project={project} setProject={setProject} />
        )}
      </div>
    </div>
  );
}

function buildDemoProject() {
  return {
    id: "demo",
    video_filename: "demo.mp4",
    video_duration: 60,
    source_language: "auto",
    target_language: "vietnamese",
    voice_id: null,
    enable_dubbing: true,
    enable_subtitle: true,
    has_accompaniment: true,
    status: "created",
    subtitle_style: {
      font_family: "Arial", font_size: 24, font_color: "#FFFFFF",
      font_bold: false, font_italic: false,
      bg_color: "#000000", bg_opacity: 0.6,
      outline_color: "#000000", outline_width: 2, shadow_offset: 0,
      position: "bottom", margin_v: 30,
    },
    segments: [
      { id: "s1", start: 2, end: 6,  status: "done", translated_text: "Chào mừng đến với VoxStudio." },
      { id: "s2", start: 7, end: 11, status: "done", translated_text: "Đây là bản demo của timeline CapCut-style." },
      { id: "s3", start: 13, end: 17, status: "done", translated_text: "Thanh ruler phía trên có thể click để seek." },
      { id: "s4", start: 20, end: 25, status: "done", translated_text: "Ctrl + cuộn chuột để zoom." },
      { id: "s5", start: 28, end: 32, status: "done", translated_text: "Nhấn Space để play / pause." },
      { id: "s6", start: 38, end: 44, status: "done", translated_text: "Mỗi khối cam là một phụ đề; clip tím là audio." },
      { id: "s7", start: 50, end: 56, status: "done", translated_text: "Bước sau sẽ thêm drag, trim, split." },
    ],
  };
}

function TabButton({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium transition-colors"
      style={{
        background: active ? "var(--accent)" : "transparent",
        color: active ? "#fff" : "var(--text-secondary)",
      }}
    >
      {icon} {label}
    </button>
  );
}
