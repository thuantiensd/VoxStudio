import { useRef, useState, useCallback } from "react";
import { updateProjectSettings, updateSubtitleStyle } from "../../services/api";
import VideoPreview from "./VideoPreview";
import LanguageVoicePanel from "./panels/LanguageVoicePanel";
import SubtitlePanel from "./panels/SubtitlePanel";
import OutputPanel from "./panels/OutputPanel";
import { useT } from "../../i18n/I18nContext";

const DEFAULT_STYLE = {
  font_family: "Arial", font_size: 24, font_color: "#FFFFFF",
  font_bold: false, font_italic: false,
  bg_color: "#000000", bg_opacity: 0.6,
  outline_color: "#000000", outline_width: 2, shadow_offset: 0,
  position: "bottom", margin_v: 30,
};

/**
 * DubbingTab — layout 2 cột: video (trái) + config panel (phải).
 * Mọi thay đổi setting đều optimistic và đồng bộ nhẹ với backend.
 * Subtitle style debounce 300ms để không spam API khi user kéo slider.
 */
const PANEL_KEY = "voxstudio:dubbingPanelWidth";
const PANEL_MIN = 280;
const PANEL_MAX = 1000;
const VIDEO_MIN = 240; // tối thiểu video còn lại bao nhiêu px

export default function DubbingTab({ project, setProject }) {
  const t = useT();
  const styleTimer = useRef(null);
  const style = project.subtitle_style || DEFAULT_STYLE;
  const [panelWidth, setPanelWidth] = useState(() => {
    const v = parseInt(localStorage.getItem(PANEL_KEY) || "", 10);
    return Number.isFinite(v) ? Math.max(PANEL_MIN, Math.min(PANEL_MAX, v)) : 380;
  });

  // Kéo mép trái panel để đổi width. Persist qua localStorage.
  const startResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    // Tính container width để clamp không lấn quá, chừa VIDEO_MIN cho video
    const container = e.currentTarget?.parentElement;
    const maxPanel = container
      ? Math.min(PANEL_MAX, container.clientWidth - VIDEO_MIN)
      : PANEL_MAX;
    const onMove = (ev) => {
      const next = Math.max(
        PANEL_MIN,
        Math.min(maxPanel, startW - (ev.clientX - startX))
      );
      setPanelWidth(next);
    };
    const onUp = () => {
      try { localStorage.setItem(PANEL_KEY, String(panelWidth)); } catch {}
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [panelWidth]);

  const handleUpdateSettings = async (patch) => {
    setProject((p) => ({ ...p, ...patch }));
    try {
      const updated = await updateProjectSettings(project.id, patch);
      setProject(updated);
    } catch (e) {
      // rollback sơ bộ — giữ UI mượt, không alert nặng
      console.warn("updateProjectSettings failed:", e);
    }
  };

  const handleTogglePipe = (key, value) => handleUpdateSettings({ [key]: value });

  const handleUpdateStyle = (next, { immediate = false } = {}) => {
    setProject((p) => ({ ...p, subtitle_style: next }));
    clearTimeout(styleTimer.current);
    if (immediate) {
      updateSubtitleStyle(project.id, next).catch(() => {});
    } else {
      styleTimer.current = setTimeout(() => {
        updateSubtitleStyle(project.id, next).catch(() => {});
      }, 150);
    }
  };

  return (
    <div className="h-full flex">
      {/* Video — cột trái */}
      <div className="flex-1 min-w-0 relative">
        <VideoPreview
          project={project}
          subtitleStyle={style}
          showSubtitles={project.enable_subtitle ?? true}
          previewSubtitle={
            (project.segments || []).some((s) => s.translated_text?.trim())
              ? null
              : t("studio.placeholder")
          }
          onSubtitleCommit={(patch) => {
            handleUpdateStyle({ ...style, ...patch }, { immediate: true });
          }}
        />
      </div>

      {/* Resizer — kéo để đổi rộng panel phải (vùng grab rộng cho dễ hit) */}
      <div
        onMouseDown={startResize}
        style={{
          width: 8,
          cursor: "ew-resize",
          background: "rgba(127,127,160,0.2)",
          flexShrink: 0,
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent)")}
        onMouseLeave={(e) =>
          (e.currentTarget.style.background = "rgba(127,127,160,0.2)")
        }
        title={t("studio.panelResize")}
      />

      {/* Panel — cột phải */}
      <aside
        className="flex-shrink-0 overflow-y-auto"
        style={{
          width: panelWidth,
          background: "var(--bg-surface)",
          borderLeft: "1px solid rgba(127,127,160,0.15)",
        }}
      >
        <div className="p-3 space-y-3">
          <LanguageVoicePanel
            project={project}
            onUpdate={handleUpdateSettings}
          />
          <SubtitlePanel
            project={project}
            onToggle={(v) => handleTogglePipe("enable_subtitle", v)}
            onUpdateStyle={handleUpdateStyle}
            onProjectUpdated={setProject}
          />
          <OutputPanel
            project={project}
            onToggle={handleTogglePipe}
            onProjectUpdated={setProject}
          />
        </div>
      </aside>
    </div>
  );
}
