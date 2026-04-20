import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Wand2, Loader2, Mic, Subtitles, Download, FileDown, Folder, FolderOpen,
  Save, Copy,
} from "lucide-react";
import {
  exportVideo, exportDownloadURL, subtitleDownloadURL, getDubbingProject,
  updateProjectSettings, updateSubtitleStyle, checkHealth,
} from "../../../services/api";
import { Section } from "./LanguageVoicePanel";
import { useT } from "../../../i18n/I18nContext";
import { useBatch } from "../../../batch/BatchContext";

/**
 * OutputPanel — chọn bật Lồng tiếng / Phụ đề + nút Bắt đầu chạy pipeline.
 * Progress live qua SSE từ autoDub().
 */
const PRESET_KEY = "voxstudio:projectPreset";

export default function OutputPanel({ project, onToggle, onProjectUpdated }) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  // Khi upload batch, StudioHome truyền batchIds qua router state. Các project
  // này chưa được config; user chỉnh setting ở project hiện tại → bấm Bắt đầu
  // sẽ copy setting cho toàn bộ batch rồi enqueue cả đám.
  const batchIds = location.state?.batchIds || [project.id];
  const { outputFolder, setOutputFolder, enqueue, queue } = useBatch();
  const [exporting, setExporting] = useState(false);
  const [presetMsg, setPresetMsg] = useState(null);

  // Đọc mẫu đã lưu (state để re-render khi user save)
  const [savedPreset, setSavedPreset] = useState(() => {
    try {
      const raw = localStorage.getItem(PRESET_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  // So sánh config hiện tại với mẫu đã lưu → dirty = true nếu khác
  const currentConfig = {
    subtitle_style: project.subtitle_style || {},
    voice_id: project.voice_id || null,
    target_language: project.target_language,
    source_language_input: project.source_language || "auto",
    tts_engine: project.tts_engine,
    edge_voice: project.edge_voice || null,
    enable_dubbing: project.enable_dubbing ?? true,
    enable_subtitle: project.enable_subtitle ?? true,
  };
  const isDirty = (() => {
    if (!savedPreset) return true;
    const keys = Object.keys(currentConfig);
    for (const k of keys) {
      if (k === "subtitle_style") {
        if (JSON.stringify(currentConfig[k]) !== JSON.stringify(savedPreset[k] || {})) return true;
      } else if (currentConfig[k] !== savedPreset[k]) {
        return true;
      }
    }
    return false;
  })();

  const savePreset = () => {
    const preset = {
      subtitle_style: project.subtitle_style,
      voice_id: project.voice_id || null,
      target_language: project.target_language,
      source_language_input: project.source_language || "auto",
      tts_engine: project.tts_engine,
      edge_voice: project.edge_voice || null,
      enable_dubbing: enableDubbing,
      enable_subtitle: enableSubtitle,
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(PRESET_KEY, JSON.stringify(preset));
      setSavedPreset(preset);
      setPresetMsg("Đã lưu cấu hình làm mẫu.");
    } catch (e) {
      setPresetMsg("Lưu thất bại: " + e.message);
    }
    setTimeout(() => setPresetMsg(null), 2500);
  };

  const applyPreset = async () => {
    if (!savedPreset) return;
    try {
      const updated = await updateProjectSettings(project.id, {
        enable_dubbing: savedPreset.enable_dubbing,
        enable_subtitle: savedPreset.enable_subtitle,
        voice_id: savedPreset.voice_id,
        target_language: savedPreset.target_language,
        source_language_input: savedPreset.source_language_input,
        tts_engine: savedPreset.tts_engine,
        edge_voice: savedPreset.edge_voice,
      });
      if (savedPreset.subtitle_style) {
        await updateSubtitleStyle(project.id, savedPreset.subtitle_style);
      }
      const fresh = await getDubbingProject(project.id);
      onProjectUpdated(fresh);
      setPresetMsg("Đã áp dụng mẫu cho project.");
    } catch (e) {
      setPresetMsg("Áp dụng thất bại: " + e.message);
    }
    setTimeout(() => setPresetMsg(null), 2500);
  };

  // Xem project này có đang trong queue không (đã enqueue nhưng chưa xong)
  const inQueue = queue.find((q) => q.projectId === project.id);
  const running = inQueue && (inQueue.status === "pending" || inQueue.status === "running");

  const enableDubbing = project.enable_dubbing ?? true;
  const enableSubtitle = project.enable_subtitle ?? true;
  const hasTranslations = (project.segments || []).some(
    (s) => s.translated_text?.trim()
  );
  const doneCount = (project.segments || []).filter(
    (s) => s.status === "done"
  ).length;
  const hasDubbed = enableDubbing && doneCount > 0;
  const pipelineRan = hasDubbed || (enableSubtitle && hasTranslations);
  const isExported = project.status === "done";

  const handleExportDownload = async () => {
    if (isExported) {
      window.open(exportDownloadURL(project.id), "_blank");
      return;
    }
    setExporting(true);
    try {
      await exportVideo(project.id, {
        keep_original_audio: true,
        original_audio_volume: 0.3,
      });
      const p = await getDubbingProject(project.id);
      onProjectUpdated(p);
      window.open(exportDownloadURL(project.id), "_blank");
    } catch (e) {
      alert("Export thất bại: " + e.message);
    }
    setExporting(false);
  };

  const pickOutputFolder = async () => {
    if (!window.voxstudio?.pickFolder) {
      alert("Chức năng chọn thư mục chỉ khả dụng trong app desktop (Electron).");
      return;
    }
    const path = await window.voxstudio.pickFolder();
    if (path) setOutputFolder(path);
  };

  const run = async () => {
    if (!enableDubbing && !enableSubtitle) {
      alert(t("studio.panels.needEnable"));
      return;
    }
    if (!outputFolder) {
      alert("Vui lòng chọn thư mục lưu trước khi bắt đầu.");
      return;
    }
    // Check backend trước khi enqueue — tránh job treo pending vì backend offline
    try {
      const h = await checkHealth();
      if (h?.status !== "ok") {
        alert(
          "Backend hiện offline. Vui lòng khởi động server (uvicorn app.main:app) rồi thử lại."
        );
        return;
      }
    } catch {
      alert("Không kết nối được backend. Kiểm tra VITE_API_URL + uvicorn đang chạy.");
      return;
    }
    // Flush MỌI setting hiện tại lên toàn bộ batch (kể cả project hiện tại).
    // Các project khác trong batch được copy cùng config → user chỉ cần chỉnh 1 lần.
    const settingsPatch = {
      enable_dubbing: enableDubbing,
      enable_subtitle: enableSubtitle,
      voice_id: project.voice_id || null,
      target_language: project.target_language,
      source_language_input: project.source_language || "auto",
      tts_engine: project.tts_engine,
      edge_voice: project.edge_voice || null,
    };
    const stylePatch = project.subtitle_style || null;
    await Promise.all(batchIds.map(async (pid) => {
      try {
        await updateProjectSettings(pid, settingsPatch);
        if (stylePatch) await updateSubtitleStyle(pid, stylePatch);
      } catch (e) {
        console.warn("flush settings failed for", pid, e);
      }
    }));
    // Lấy filename cho từng project (project hiện tại đã có; các project khác
    // fetch nhanh để hiện label trong queue).
    const items = await Promise.all(batchIds.map(async (pid) => {
      if (pid === project.id) {
        return { projectId: pid, filename: project.video_filename };
      }
      try {
        const p = await getDubbingProject(pid);
        return { projectId: pid, filename: p.video_filename };
      } catch {
        return { projectId: pid, filename: pid };
      }
    }));
    enqueue(items);
    navigate("/studio");
  };

  return (
    <Section icon={<Wand2 size={13} />} title={t("studio.panels.output")}>
      <div className="space-y-2">
        <PipeToggle
          icon={<Mic size={12} />}
          label={t("studio.panels.dubbing")}
          active={enableDubbing}
          onClick={() => onToggle("enable_dubbing", !enableDubbing)}
        />
        <PipeToggle
          icon={<Subtitles size={12} />}
          label={t("studio.panels.subtitle")}
          active={enableSubtitle}
          onClick={() => onToggle("enable_subtitle", !enableSubtitle)}
        />
      </div>

      {/* Mẫu cấu hình — Lưu / Áp dụng */}
      <div className="mt-3 flex gap-2">
        <button
          onClick={savePreset}
          className="flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-semibold transition-colors"
          style={{
            background: isDirty ? "var(--accent)" : "rgba(108,92,231,0.12)",
            color: isDirty ? "#fff" : "var(--accent)",
            border: `1px solid ${isDirty ? "var(--accent)" : "rgba(108,92,231,0.3)"}`,
          }}
          title="Lưu cấu hình hiện tại làm mẫu cho lần sau"
        >
          <Save size={11} /> {isDirty ? "● Lưu làm mẫu" : "Lưu làm mẫu"}
        </button>
        <button
          onClick={applyPreset}
          disabled={!savedPreset}
          className="flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40"
          style={{
            background: "rgba(255,255,255,0.04)",
            color: "var(--text-primary)",
            border: "1px solid rgba(127,127,160,0.2)",
          }}
          title={savedPreset ? "Áp dụng mẫu đã lưu" : "Chưa có mẫu nào"}
        >
          <Copy size={11} /> Áp dụng mẫu
        </button>
      </div>
      {presetMsg && (
        <p className="text-[10px] mt-1" style={{ color: "var(--accent)" }}>
          {presetMsg}
        </p>
      )}

      {/* Thư mục lưu — nằm ngay trên nút bắt đầu */}
      <div
        className="mt-3 rounded-md p-2 flex items-center gap-2"
        style={{
          background: "rgba(255,255,255,0.03)",
          border: `1px solid ${outputFolder ? "rgba(127,127,160,0.2)" : "rgba(239,68,68,0.35)"}`,
        }}
      >
        <Folder size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium"
               style={{ color: "var(--text-primary)" }}>
            Thư mục lưu
          </div>
          <div className="text-[10px] truncate"
               style={{ color: outputFolder ? "var(--text-secondary)" : "#ef4444" }}
               title={outputFolder || "Chưa chọn"}>
            {outputFolder || "Chưa chọn — cần chọn để bắt đầu"}
          </div>
        </div>
        <button
          onClick={pickOutputFolder}
          className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors"
          style={{
            background: "rgba(108,92,231,0.15)",
            color: "var(--accent)",
            border: "1px solid rgba(108,92,231,0.3)",
          }}
        >
          <FolderOpen size={10} />
          {outputFolder ? "Đổi" : "Chọn"}
        </button>
      </div>

      <button
        onClick={run}
        disabled={running || !outputFolder || (!enableDubbing && !enableSubtitle) || isDirty}
        title={
          !enableDubbing && !enableSubtitle ? "Bật ít nhất Lồng tiếng hoặc Phụ đề"
          : !outputFolder ? "Cần chọn thư mục lưu trước"
          : isDirty ? "Cấu hình chưa lưu — nhấn Lưu làm mẫu trước khi chạy"
          : ""
        }
        className="w-full mt-2 rounded-md py-2 text-sm font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: "linear-gradient(135deg, var(--accent), #8b5cf6)",
          color: "#fff",
        }}
      >
        {running ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Wand2 size={14} />
        )}
        {running ? t("studio.panels.pipelineRunning") : t("studio.panels.pipelineStart")}
        {batchIds.length > 1 && !running && (
          <span className="ml-1 opacity-85">({batchIds.length} video)</span>
        )}
      </button>
      {batchIds.length > 1 && (
        <p className="text-[11px] mt-1.5 text-center"
           style={{ color: "var(--text-secondary)" }}>
          Setting này sẽ áp dụng cho cả {batchIds.length} video trong batch.
        </p>
      )}

      {inQueue && (
        <div className="mt-3 space-y-1">
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ background: "rgba(127,127,160,0.15)" }}
          >
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${Math.max(0, inQueue.progress || 0)}%`,
                background:
                  inQueue.status === "error"
                    ? "#ef4444"
                    : inQueue.status === "done"
                    ? "#22c55e"
                    : "var(--accent)",
              }}
            />
          </div>
          <p
            className="text-[11px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {inQueue.step || inQueue.status}
            {inQueue.status === "pending" ? " · đang chờ…" : ""}
          </p>
        </div>
      )}
    </Section>
  );
}

function SubDownload({ href, label }) {
  return (
    <a
      href={href}
      download
      className="flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-xs transition-colors"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(127,127,160,0.2)",
        color: "var(--text-secondary)",
      }}
    >
      <FileDown size={11} /> {label}
    </a>
  );
}

function PipeToggle({ icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between rounded-md px-2.5 py-1.5 transition-colors"
      style={{
        background: active ? "rgba(108,92,231,0.14)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${active ? "rgba(108,92,231,0.4)" : "rgba(127,127,160,0.15)"}`,
        color: active ? "var(--accent)" : "var(--text-secondary)",
      }}
    >
      <span className="flex items-center gap-1.5 text-xs">
        {icon} {label}
      </span>
      <span className="text-[10px] font-semibold">{active ? "ON" : "OFF"}</span>
    </button>
  );
}
