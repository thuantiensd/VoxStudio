import { Fragment, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Zap, Sparkles, Check, Upload, SlidersHorizontal, Clapperboard,
  Play, X, Plus, FileVideo, CheckCircle2, Settings2, Globe,
  Mic, Captions, Volume2, FolderOpen, ArrowLeftRight, Type,
  Palette, MapPin, Wand2, Crop, Bot, Save, Rocket,
  ArrowRight, RotateCcw,
} from "lucide-react";
import { useToast } from "../ui/Toast";
import { useT } from "../../i18n/I18nContext";
import { useUpgrade } from "../UpgradeContext";
import { isQuotaError } from "../../services/errors";
import { useBatch } from "../../batch/BatchContext";
import ProjectGrid from "./ProjectGrid";
import ProjectDrawer from "./ProjectDrawer";
import {
  createDubbingProject, updateProjectSettings, updateSubtitleStyle,
  listVoices, listEdgeVoices, listPremiumVoices,
} from "../../services/api";
import { showError } from "../../services/errors";
import { getActivePreset, saveCustomPreset } from "../../services/preset";
import {
  LOCALE_MAP,
  TRANSCRIBE_SOURCES, TRANSLATE_TARGETS, langLabel,
  loadTTSSettings, saveTTSSettings,
} from "../../services/ttsSettings";

const VIDEO_RE = /\.(mp4|mov|mkv|avi|webm)$/i;
const MAX_BATCH = 10;
const MAX_SIZE_MB = 2048;

/**
 * buildSettingsPayload — map cfg → schema backend chấp nhận.
 *
 * Backend whitelist (dubbing_svc.py:update_project_settings):
 *   enable_dubbing, enable_subtitle, target_language, voice_id,
 *   source_language_input, tts_engine, edge_voice, aspect_ratio,
 *   trim_start, trim_end,
 *   keep_original_audio, original_audio_volume,
 *   crop_mode, default_emotion,
 *   auto_font_size, auto_pace, smart_chunk, highlight_keywords.
 */
function buildSettingsPayload(cfg, ttsEngine, omniVoiceId) {
  // Voice slots cho Premium multi-voice. Chỉ gửi N slot đầu tiên (theo
  // voiceCount). Slot rỗng = "" → backend hiểu là default voice cho speaker đó.
  const voiceCount = cfg.voiceCount || 1;
  const voiceSlots = (cfg.voiceSlots || [])
    .slice(0, voiceCount)
    .map((v) => v || "");
  return {
    tts_engine: ttsEngine,
    edge_voice: cfg.ttsModel === "standard" ? cfg.edgeVoice : null,
    voice_id: omniVoiceId,
    voice_count: cfg.ttsModel === "premium" ? voiceCount : 1,
    voice_slots: cfg.ttsModel === "premium" ? voiceSlots : [],
    source_language_input: cfg.sourceLang,
    target_language: cfg.targetLang,
    enable_dubbing: cfg.enableDubbing,
    enable_subtitle: cfg.enableSubtitle,
    aspect_ratio: cfg.aspect === "original" ? null : cfg.aspect,
    // Mix audio — 2 luồng riêng (nhạc nền vs giọng gốc)
    keep_accompaniment: !!cfg.keepAccompaniment,
    accompaniment_volume: (cfg.accompVolume || 0) / 100,
    keep_original_voice: !!cfg.keepOriginalVoice,
    original_voice_volume: (cfg.originalVoiceVolume || 0) / 100,
    // Crop mode (smart/center/letterbox) khi đổi aspect
    crop_mode: cfg.cropMode,
    // Cảm xúc mặc định — fallback khi LLM không set (chỉ hiệu lực khi Premium)
    default_emotion: cfg.ttsModel === "premium" ? cfg.emotion : null,
    // Auto features
    auto_font_size: !!cfg.autoFontSize,
    auto_pace: !!cfg.autoPace,
    smart_chunk: !!cfg.smartChunk,
    highlight_keywords: (cfg.highlightKeywords || "").trim(),
    // Translate engine — server không lưu api_key, chỉ engine.
    translate_engine: cfg.translateEngine || "google_free",
    topic_hint: (cfg.topicHint || "").trim(),
    glossary: (cfg.glossary || "").trim(),
    // Visual context (Pass-(-1)) — toggle nâng cao + chọn engine/model.
    // Key lookup từ KeyVault khi auto-dub chạy (BatchContext).
    enable_visual_context: !!cfg.enableVisualContext,
    visual_engine: cfg.visualEngine || null,
    visual_model: cfg.visualModel || null,
  };
}

function guessMime(name) {
  const ext = (name || "").toLowerCase().split(".").pop();
  return {
    mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska",
    avi: "video/x-msvideo", webm: "video/webm",
  }[ext] || "video/mp4";
}

/** Map cfg → subtitle_style schema backend. */
function buildSubtitleStylePayload(cfg) {
  return {
    template: cfg.template,                     // 'netflix' | 'tiktok' | ...
    font_family: cfg.font,
    font_size: cfg.fontSize,
    font_color: cfg.textColor,
    font_bold: cfg.bold,
    font_italic: cfg.italic,
    bg_color: cfg.bgColor,
    bg_opacity: (cfg.bgOpacity || 0) / 100,    // 0-100% → 0-1
    outline_color: cfg.outlineColor,
    outline_width: cfg.outlineSize,
    shadow_offset: cfg.shadow,
    position: cfg.position,                     // 'top' | 'middle' | 'bottom'
    margin_v: cfg.margin,
    animation: cfg.animation,                   // 'none' | 'fade' | ...
  };
}

/**
 * StudioDubbingHomeV2 — trang chính của Studio > Lồng tiếng video.
 *
 * Có 2 chế độ:
 *   - Batch: nhiều video, cấu hình 1 lần, chạy song song
 *   - Studio: 1 video, pipeline auto chạy default rồi mở Review Studio để edit kỹ
 *
 * Tinh thần: thiết kế gọn, không hào nhoáng. Dùng CSS variables sẵn có
 * (--n-*, --accent), icon từ lucide-react.
 */
export default function StudioDubbingHomeV2() {
  const t = useT();
  const toast = useToast();
  const upgrade = useUpgrade();
  const location = useLocation();
  const nav = useNavigate();
  const { enqueue, outputFolder, setOutputFolder, queue } = useBatch();
  const [drawerItem, setDrawerItem] = useState(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [voicesOmni, setVoicesOmni] = useState([]);
  const [voicesEdge, setVoicesEdge] = useState([]);
  const [savedSnapshot, setSavedSnapshot] = useState(null);
  const [cfg, setCfg] = useState(() => {
    const p = getActivePreset();
    const tts = loadTTSSettings();
    return {
      sourceLang: p.sourceLanguage || "auto",
      targetLang: p.targetLanguage || "vietnamese",
      enableDubbing: p.enableDubbing ?? true,
      enableSubtitle: p.enableSubtitle ?? true,
      // Nhạc nền (accompaniment đã tách giọng) — BẬT mặc định
      keepAccompaniment: true,
      accompVolume: 35,
      // Giọng gốc (vocals đã tách) — TẮT mặc định, vì sẽ trùng giọng dub
      keepOriginalVoice: false,
      originalVoiceVolume: 20,
      // === TTS settings (đồng bộ với TTS page qua ttsSettings.js) ===
      ttsModel: tts.engine === "omnivoice" ? "premium" : "standard",
      voiceLang: tts.language || "auto",   // "auto" hoặc semantic (vietnamese/english/...)
      // Default LUÔN là "" (built-in default voice). Không auto-restore voice
      // đã pick lần trước vì user nhầm voice clone là "default" — UX confusing.
      // User pick voice clone khi muốn (dropdown vẫn cho phép).
      voiceId: "",
      // Số giọng dùng cho video (1-5). Default 1 = single voice cho mọi
      // speaker. >1 → app hiện N slot, app sẽ map speaker (theo gender từ
      // diarization) vào các slot. Voice clone tag gender → filter chính xác.
      voiceCount: 1,
      // Mapping slot index → voice_id. Index 0..N-1. Empty string = default.
      voiceSlots: ["", "", "", "", ""],
      edgeVoice: tts.edgeVoice || "",
      emotion: tts.emotion || "normal",
      // subtitle styling (tạm lưu local, chưa wire backend)
      template: "netflix",
      font: "Inter",
      fontSize: 24,
      bold: false,
      italic: false,
      textColor: "#FFFFFF",
      outlineColor: "#000000",
      outlineSize: 2,
      bgColor: "#000000",
      bgOpacity: 70,
      shadow: 2,
      position: "bottom",
      margin: 48,
      animation: "none",
      aspect: "original",
      cropMode: "smart",
      autoFontSize: true,
      autoPace: true,
      smartChunk: true,
      highlightKeywords: "",  // chuỗi từ khoá cách nhau bởi dấu phẩy. Rỗng = tắt.
      outputDir: "",
      // Translate engine — Google Free mặc định (no key, OK ngay).
      translateEngine: p.translateEngine || "google_free",
      // Cải thiện chất lượng dịch: topic hint + glossary (free-form text).
      // LLM engines tận dụng được nhất; Google Free chỉ áp dụng glossary
      // qua post-process replacement.
      topicHint: p.topicHint || "",
      glossary: p.glossary || "",
      // Visual Context (nâng cao) — BYOK, default OFF
      enableVisualContext: p.enableVisualContext ?? false,
      visualEngine: p.visualEngine || "",
      visualModel: p.visualModel || "",
    };
  });

  // Snapshot baseline để biết user đã thay đổi gì → nút "Lưu preset" sáng lên
  useEffect(() => {
    if (!savedSnapshot) setSavedSnapshot(cfg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isDirty = savedSnapshot && JSON.stringify(cfg) !== JSON.stringify(savedSnapshot);

  /** Thay đổi cfg KHÔNG persist xuống localStorage. Chỉ khi user bấm
   *  "Lưu thành preset" mới persist. Lần mở sau cfg về preset đã lưu. */
  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));

  // Khi user vào /studio từ DownloaderPage qua route state → pre-fill file
  // bằng project đã tải sẵn (có projectId) + mở modal cấu hình. Submit sẽ
  // bypass createDubbingProject vì project đã tồn tại trên backend.
  useEffect(() => {
    const fd = location.state?.fromDownload;
    if (!fd?.projectId) return;
    setFiles([{
      id: crypto.randomUUID(),
      file: { existingProjectId: fd.projectId, name: fd.filename, size: 0, isExisting: true },
      name: fd.filename,
      size: 0,
    }]);
    setConfigOpen(true);
    window.history.replaceState({}, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load voice lists once.
  // OmniVoice voices = premium presets (31, shared) + user clones (per-user).
  // Premium được normalize về shape giống user clone để OmniVoicePicker
  // không cần code branching: {id, name, tags, language, gender, isPremium}.
  useEffect(() => {
    Promise.all([
      listPremiumVoices().then(d => d?.voices || []).catch(() => []),
      listVoices().then(d => Array.isArray(d) ? d : (d?.voices || [])).catch(() => []),
    ]).then(([premium, clones]) => {
      const normalizedPremium = premium.map(v => ({
        id: v.slug,
        name: v.display_name,
        language: v.language,
        gender: v.gender,
        // tags chứa language + gender → voiceMatchesLang + genderOf hoạt
        // động bình thường cho cả premium + clone (cùng pipeline).
        tags: [v.language, v.gender, "premium"].filter(Boolean),
        isPremium: true,
        preview_url: v.preview_url,
      }));
      setVoicesOmni([...normalizedPremium, ...clones]);
    });
    listEdgeVoices().then((data) => {
      const list = Array.isArray(data) ? data : (data?.voices || []);
      setVoicesEdge(list);
    }).catch(() => {});
  }, []);

  /* ───────── file handlers ───────── */
  function addFiles(list) {
    const accepted = [];
    const rejected = [];
    for (const f of list) {
      if (!VIDEO_RE.test(f.name)) { rejected.push(`${f.name}: không hỗ trợ định dạng`); continue; }
      if (f.size > MAX_SIZE_MB * 1024 * 1024) { rejected.push(`${f.name}: vượt ${MAX_SIZE_MB}MB`); continue; }
      accepted.push({ id: crypto.randomUUID(), file: f, name: f.name, size: f.size });
    }
    if (rejected.length) toast.warn(rejected.join("\n"));
    if (!accepted.length) return;

    setFiles((prev) => {
      const wasEmpty = prev.length === 0;
      const next = [...prev, ...accepted].slice(0, MAX_BATCH);
      if (prev.length + accepted.length > MAX_BATCH) {
        toast.warn(`Chỉ nhận tối đa ${MAX_BATCH} video / lần. Số dư đã bị bỏ.`);
      }
      if (wasEmpty && next.length > 0) setConfigOpen(true);
      return next;
    });
  }
  function removeFile(id) { setFiles((prev) => prev.filter((f) => f.id !== id)); }
  function clearFiles() { setFiles([]); }

  /* ───────── pipeline submit ───────── */
  async function handleSubmit() {
    if (!files.length) { toast.warn(t("dub.toastNoVideo")); return; }
    setBusy(true);

    const { enableDubbing, enableSubtitle } = cfg;
    const created = [];
    const errors = [];
    const ttsEngine = cfg.ttsModel === "premium" ? "omnivoice" : "edge";
    const omniVoiceId = cfg.ttsModel === "premium" ? cfg.voiceId : null;
    const settingsPayload = buildSettingsPayload(cfg, ttsEngine, omniVoiceId);
    const stylePayload = buildSubtitleStylePayload(cfg);

    await Promise.all(files.map(async (f) => {
      try {
        let projId;
        // 3 nguồn project:
        // 1. Existing (từ DownloaderPage) — đã có projectId backend, skip create
        // 2. Local path (từ Quét thư mục) — đọc buffer qua IPC rồi upload
        // 3. File trình duyệt (drop / Chọn file) — upload trực tiếp
        if (f.file?.isExisting && f.file?.existingProjectId) {
          projId = f.file.existingProjectId;
        } else {
          let videoFile = f.file;
          if (videoFile?.isLocalPath) {
            if (!window.voxstudio?.readFileAsBuffer) throw new Error(t("dub.toastReadFailed"));
            const buf = await window.voxstudio.readFileAsBuffer(videoFile.path);
            const blob = new Blob([buf], { type: guessMime(videoFile.name) });
            videoFile = new File([blob], videoFile.name, { type: blob.type });
          }
          const proj = await createDubbingProject(
            videoFile, cfg.targetLang, omniVoiceId || undefined,
            cfg.sourceLang, enableDubbing, enableSubtitle,
          );
          projId = proj.id;
        }
        const proj = { id: projId };
        // Apply full settings + subtitle style. Lỗi từng cái = warn (không fatal),
        // pipeline vẫn chạy với default + những gì đã set thành công.
        try { await updateProjectSettings(proj.id, settingsPayload); }
        catch (e) { console.warn("[dubbing v2] update settings:", e); }
        if (enableSubtitle) {
          try { await updateSubtitleStyle(proj.id, stylePayload); }
          catch (e) { console.warn("[dubbing v2] update style:", e); }
        }
        created.push({ projectId: proj.id, filename: f.name });
      } catch (e) {
        errors.push({ name: f.name, err: e });
      }
    }));

    setBusy(false);
    const quotaErr = errors.find(({ err }) => isQuotaError(err));
    if (quotaErr) {
      upgrade.open(quotaErr.err?.message || null);
    } else if (errors.length) {
      toast.warn(t("dub.toastErrorsCount", { e: errors.length, n: files.length }));
      console.warn("[dubbing v2]", errors.map((e) => `${e.name}: ${e.err?.message || e.err}`));
    }
    if (created.length) {
      enqueue(created);
      setFiles([]);
      toast.success(
        created.length === 1
          ? t("dub.toastStartedOne")
          : t("dub.toastStartedMany", { n: created.length })
      );
    }
  }

  /** Revert mọi thay đổi về preset đã lưu (snapshot). Sau revert isDirty=false. */
  function resetToDefault() {
    if (savedSnapshot) setCfg(savedSnapshot);
  }

  /** Persist cfg hiện tại thành preset (preset.js) + đồng bộ TTS settings
   *  để trang TTS thấy. Chỉ chạy khi user bấm "Lưu thành preset". */
  function savePreset() {
    saveCustomPreset({
      sourceLanguage: cfg.sourceLang, targetLanguage: cfg.targetLang,
      enableDubbing: cfg.enableDubbing, enableSubtitle: cfg.enableSubtitle,
      voiceId: cfg.voiceId, description: t("dub.presetDesc"),
    });
    saveTTSSettings({
      engine: cfg.ttsModel === "premium" ? "omnivoice" : "edge",
      // voiceLang đã bỏ — dùng targetLang làm canonical language cho TTS preset
      language: cfg.targetLang === "auto" ? "" : cfg.targetLang,
      voiceId: cfg.voiceId || "",
      edgeVoice: cfg.edgeVoice || "",
      emotion: cfg.emotion || "normal",
    });
    setSavedSnapshot(cfg);
    toast.success(t("dub.toastSavedPreset"));
  }

  function retryProject(item) {
    enqueue([{ projectId: item.projectId, filename: item.filename }]);
    toast.info(t("dub.toastReQueued"));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--n-0)" }}>
      {/* Top bar — nút quay lại Studio Hub */}
      <div style={{
        flexShrink: 0,
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 24px", height: 48,
        borderBottom: "1px solid var(--n-3)",
        background: "var(--n-1)",
      }}>
        <button
          onClick={() => nav("/studio")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "5px 11px", borderRadius: 6,
            background: "transparent", border: "1px solid var(--n-3)",
            color: "var(--n-9)", fontSize: 12.5, fontWeight: 500,
            cursor: "pointer", fontFamily: "inherit",
            transition: "all 0.12s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--n-2)";
            e.currentTarget.style.borderColor = "var(--n-5)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "var(--n-3)";
          }}
        >
          {t("dub.backToStudio")}
        </button>
        <span style={{ color: "var(--n-6)", fontSize: 12 }}>·</span>
        <Clapperboard size={13} style={{ color: "var(--accent)" }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--n-10)" }}>
          {t("dub.title")}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "24px 32px 60px", boxSizing: "border-box", width: "100%" }}>
          <BatchView
            files={files} cfg={cfg} set={set} busy={busy} isDirty={isDirty}
            voicesOmni={voicesOmni} voicesEdge={voicesEdge}
            outputFolder={outputFolder} setOutputFolder={setOutputFolder}
            onPickFiles={addFiles} onRemove={removeFile} onClear={clearFiles}
            onSubmit={handleSubmit} onSavePreset={savePreset} onResetDefault={resetToDefault}
            configOpen={configOpen} onOpenConfig={() => setConfigOpen(true)}
            onCloseConfig={() => setConfigOpen(false)}
          />

          <ProjectGrid
            queue={queue}
            onOpen={setDrawerItem}
            onRetry={retryProject}
          />
        </div>
      </div>

      <ProjectDrawer
        item={drawerItem}
        open={!!drawerItem}
        onClose={() => setDrawerItem(null)}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Batch view — chế độ duy nhất                                          */
/* ─────────────────────────────────────────────────────────────────── */
function BatchView({ files, cfg, set, busy, isDirty, voicesOmni, voicesEdge, outputFolder, setOutputFolder, onPickFiles, onRemove, onClear, onSubmit, onSavePreset, onResetDefault, configOpen, onOpenConfig, onCloseConfig }) {
  const t = useT();
  const totalMB = (files.reduce((a, f) => a + f.size, 0) / (1024 * 1024)).toFixed(1);
  return (
    <>
      <PageHeader
        title={t("dub.subtitle")}
        subtitle={t("dub.batchSubtitle")}
      />

      <Stepper current={files.length ? 2 : 1} />

      <DropArea onFilesAccepted={onPickFiles} multi />

      {files.length > 0 && (
        <>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            margin: "12px 0 8px", fontSize: 12.5, color: "var(--n-8)",
          }}>
            <span><b style={{ color: "var(--n-10)" }}>{files.length} video</b> · {totalMB} MB</span>
            <button onClick={onClear} style={linkBtn}>{t("dub.clearAll")}</button>
          </div>
          <FileList files={files} onRemove={onRemove} />
          <AddMoreBtn onPickFiles={onPickFiles} />

          <button onClick={onOpenConfig} style={{ ...ghostBtn, marginTop: 12 }}>
            <Settings2 size={13} /> {t("dub.reopenConfig")}
          </button>

          <FloatModal
            open={configOpen}
            onClose={onCloseConfig}
            title={t("dub.configTitle")}
            meta={t("dub.configMeta", { n: files.length })}
            footer={
              <>
                {isDirty && (
                  <>
                    <button onClick={onResetDefault} style={resetDefaultBtn}>
                      <RotateCcw size={13} /> {t("dub.defaultBtn")}
                    </button>
                    <button onClick={onSavePreset} style={savePresetActive}>
                      <Save size={13} /> {t("dub.savePreset")}
                    </button>
                  </>
                )}
                <span style={{ flex: 1 }} />
                <button
                  onClick={() => { onSubmit(); onCloseConfig(); }}
                  disabled={busy}
                  style={{ ...primaryBtn, opacity: busy ? 0.5 : 1 }}
                >
                  <Rocket size={14} />
                  {busy ? t("dub.submitting") : t("dub.submitStart", { n: files.length })}
                </button>
              </>
            }
          >
            <LangGroup cfg={cfg} set={set} />
            <TranslateEngineGroup cfg={cfg} set={set} />
            <DubbingGroup cfg={cfg} set={set} voicesOmni={voicesOmni} voicesEdge={voicesEdge} />
            <SubtitleGroup cfg={cfg} set={set} />
            <OriginalMixGroup cfg={cfg} set={set} />
            <FolderGroup outputFolder={outputFolder} setOutputFolder={setOutputFolder} />
          </FloatModal>
        </>
      )}
    </>
  );
}

/**
 * FloatModal — overlay nổi lên trên page với backdrop. Esc hoặc click backdrop
 * để đóng. Dùng cho panel "Cấu hình xử lý" — xuất hiện sau khi thả video.
 */
function FloatModal({ open, onClose, title, meta, children, footer }) {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === "Escape") onClose?.(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
        animation: "vsModalIn 0.18s ease-out",
      }}
    >
      <style>{`
        @keyframes vsModalIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes vsSheetIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      <div
        style={{
          width: "100%", maxWidth: 720, maxHeight: "calc(100vh - 48px)",
          background: "var(--n-0)", border: "1px solid var(--n-3)",
          borderRadius: 12, overflow: "hidden",
          display: "flex", flexDirection: "column",
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
          animation: "vsSheetIn 0.24s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 18px",
          borderBottom: "1px solid var(--n-3)",
          flexShrink: 0,
        }}>
          <Settings2 size={16} style={{ color: "var(--accent)" }} />
          <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 650, color: "var(--n-10)" }}>{title}</h2>
          {meta && <span style={{ color: "var(--n-7)", fontSize: 12 }}>· {meta}</span>}
          <span style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, borderRadius: 6, border: "none",
              background: "transparent", color: "var(--n-7)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            title={t("dub.closeEsc")}
          ><X size={15} /></button>
        </div>

        <div style={{
          flex: 1, overflowY: "auto",
          padding: "16px 18px",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          {children}
        </div>

        {footer && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "12px 18px",
            borderTop: "1px solid var(--n-3)",
            background: "var(--n-1)",
            flexShrink: 0,
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Building blocks                                                      */
/* ─────────────────────────────────────────────────────────────────── */
function PageHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h1 style={{
        margin: "0 0 4px", fontSize: 22, fontWeight: 650,
        color: "var(--n-10)", letterSpacing: "-0.01em",
      }}>{title}</h1>
      <p style={{ margin: 0, color: "var(--n-7)", fontSize: 13, lineHeight: 1.5 }}>{subtitle}</p>
    </div>
  );
}

function Stepper({ current = 1 }) {
  const t = useT();
  const steps = [
    { id: 1, label: t("dub.stepUpload") },
    { id: 2, label: t("dub.stepConfig") },
    { id: 3, label: t("dub.stepProcess") },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
      {steps.map((s, i) => {
        const done = current > s.id;
        const active = current === s.id;
        const color = done ? "var(--accent)" : active ? "var(--n-10)" : "var(--n-6)";
        return (
          <Fragment key={s.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color, flexShrink: 0 }}>
              <div style={{
                width: 24, height: 24, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: done ? "var(--accent-soft)" : active ? "var(--accent)" : "var(--n-2)",
                border: done ? "1.5px solid var(--accent)" : active ? "none" : "1.5px solid var(--n-3)",
                color: active ? "#fff" : color,
                fontSize: 11, fontWeight: 700, flexShrink: 0,
              }}>
                {done ? <Check size={12} /> : s.id}
              </div>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                flex: 1, height: 1.5,
                background: done ? "var(--accent)" : "var(--n-3)",
                margin: "0 12px",
                transition: "background 0.2s",
              }} />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

function DropArea({ onFilesAccepted, multi = true }) {
  const t = useT();
  const ref = useRef(null);
  const toast = useToast();
  const [over, setOver] = useState(false);

  // Global drag listener
  useEffect(() => {
    const onDragOver = (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault(); setOver(true);
    };
    const onDragLeave = (e) => { if (e.relatedTarget === null) setOver(false); };
    const onDrop = (e) => {
      e.preventDefault(); setOver(false);
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) onFilesAccepted(multi ? files : files.slice(0, 1));
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [multi, onFilesAccepted]);

  async function scanFolder(e) {
    e.stopPropagation();
    if (!window.voxstudio?.pickFolder) {
      toast.warn(t("dub.folderOnlyDesktop"));
      return;
    }
    const folder = await window.voxstudio.pickFolder();
    if (!folder) return;
    if (!window.voxstudio.listVideosInFolder) {
      toast.error(t("dub.appNotReady"));
      return;
    }
    try {
      const list = await window.voxstudio.listVideosInFolder(folder);
      if (!list?.length) {
        toast.warn(t("dub.folderNoVideo"));
        return;
      }
      const fds = list.map((f) => ({
        name: f.name, path: f.path, size: f.size, isLocalPath: true,
      }));
      onFilesAccepted(fds);
    } catch (err) {
      toast.error(t("dub.scanFolderFailed") + (err?.message || err));
    }
  }

  return (
    <div
      onClick={() => ref.current?.click()}
      style={{
        border: `1.5px dashed ${over ? "var(--accent)" : "var(--n-3)"}`,
        background: over ? "var(--accent-soft)" : "var(--n-1)",
        borderRadius: 10, padding: "32px 24px", textAlign: "center",
        cursor: "pointer", transition: "border-color 0.12s, background 0.12s",
      }}
    >
      <input
        ref={ref} type="file" multiple={multi}
        accept=".mp4,.mov,.mkv,.avi,.webm" hidden
        onChange={(e) => {
          const list = Array.from(e.target.files || []);
          if (list.length) onFilesAccepted(list);
          e.target.value = "";
        }}
      />
      <div style={{
        width: 48, height: 48, borderRadius: 10,
        background: "var(--accent-soft)", border: "1px solid var(--accent-ring)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        marginBottom: 12,
      }}>
        <Upload size={20} style={{ color: "var(--accent)" }} />
      </div>
      <div style={{ fontSize: 15, color: "var(--n-10)", fontWeight: 600, marginBottom: 4 }}>
        {multi ? t("dub.dropMulti") : t("dub.dropSingle")}
      </div>
      <div style={{ fontSize: 12, color: "var(--n-7)", marginBottom: 14 }}>
        {t("dub.dropClickHint")}{multi ? t("dub.dropMultiHint") : ""}
      </div>
      {multi && (
        <div style={{
          display: "inline-flex", gap: 8, marginBottom: 12,
        }}>
          <button
            onClick={(e) => { e.stopPropagation(); ref.current?.click(); }}
            style={dropBtnPrimary}
          >
            <Upload size={13} /> {t("dub.chooseFile")}
          </button>
          <button onClick={scanFolder} style={dropBtnGhost}>
            <FolderOpen size={13} /> {t("dub.scanFolder")}
          </button>
        </div>
      )}
      <div style={{ fontSize: 11, color: "var(--n-6)" }}>
        {t("dub.dropMaxSize", { n: MAX_SIZE_MB })}
      </div>
    </div>
  );
}

const dropBtnPrimary = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "7px 14px", borderRadius: 7,
  background: "var(--accent)", color: "#fff", border: "none",
  fontSize: 12.5, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
};
const dropBtnGhost = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "7px 14px", borderRadius: 7,
  background: "var(--n-2)", color: "var(--n-9)",
  border: "1px solid var(--n-3)",
  fontSize: 12.5, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
};

function FileList({ files, onRemove }) {
  const t = useT();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {files.map((f) => (
        <div key={f.id} style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "9px 12px", borderRadius: 7,
          background: "var(--n-1)", border: "1px solid var(--n-3)",
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: 5, background: "var(--n-2)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <FileVideo size={14} style={{ color: "var(--n-6)" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: "var(--n-10)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {f.name}
            </div>
            <div style={{ fontSize: 11, color: "var(--n-7)", marginTop: 2, display: "inline-flex", alignItems: "center", gap: 5 }}>
              {(f.size / (1024 * 1024)).toFixed(1)} MB ·
              <CheckCircle2 size={11} style={{ color: "#22c55e" }} /> {t("dub.fileReady")}
            </div>
          </div>
          <button onClick={() => onRemove(f.id)} style={iconXBtn}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function AddMoreBtn({ onPickFiles }) {
  const t = useT();
  const ref = useRef(null);
  return (
    <>
      <button
        onClick={() => ref.current?.click()}
        style={{
          width: "100%", padding: "9px 14px", marginTop: 8,
          border: "1.5px dashed var(--n-3)", borderRadius: 7,
          background: "transparent", color: "var(--n-8)", fontSize: 12.5,
          cursor: "pointer", fontFamily: "inherit",
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}
      >
        <Plus size={13} /> {t("dub.addVideo")}
      </button>
      <input
        ref={ref} type="file" multiple
        accept=".mp4,.mov,.mkv,.avi,.webm" hidden
        onChange={(e) => {
          const list = Array.from(e.target.files || []);
          if (list.length) onPickFiles(list);
          e.target.value = "";
        }}
      />
    </>
  );
}

function Section({ icon: Icon, title, sub, toggle, children }) {
  return (
    <div style={{
      background: "var(--n-1)", border: "1px solid var(--n-3)",
      borderRadius: 9, padding: "14px 16px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: children ? 12 : 0 }}>
        {Icon && <Icon size={15} style={{ color: "var(--n-8)" }} />}
        <h3 style={{ margin: 0, fontSize: 13, color: "var(--n-10)", fontWeight: 600 }}>{title}</h3>
        {sub && <span style={{ color: "var(--n-7)", fontSize: 11.5 }}>{sub}</span>}
        {toggle != null && <>
          <span style={{ flex: 1 }} />
          <Toggle on={toggle.value} onChange={toggle.onChange} />
        </>}
      </div>
      {children && (
        <div style={{
          opacity: toggle && !toggle.value ? 0.4 : 1,
          pointerEvents: toggle && !toggle.value ? "none" : "auto",
          display: "flex", flexDirection: "column", gap: 12,
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={{
        width: 32, height: 18, borderRadius: 9, border: "none",
        background: on ? "var(--accent)" : "var(--n-4)",
        position: "relative", cursor: "pointer", transition: "background 0.15s",
        padding: 0, flexShrink: 0,
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: on ? 16 : 2,
        width: 14, height: 14, borderRadius: "50%",
        background: "#fff", transition: "left 0.15s",
      }} />
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Config groups                                                        */
/* ─────────────────────────────────────────────────────────────────── */
function LangGroup({ cfg, set }) {
  const t = useT();
  return (
    <Section icon={Globe} title={t("dub.language")}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <LangSelect label={t("dub.langSource")} value={cfg.sourceLang} onChange={(v) => set({ sourceLang: v })} sourceMode />
        <button
          onClick={() => set({ sourceLang: cfg.targetLang === "auto" ? "vietnamese" : cfg.targetLang, targetLang: cfg.sourceLang === "auto" ? "vietnamese" : cfg.sourceLang })}
          title={t("dub.langSwap")}
          style={{
            width: 32, height: 32, borderRadius: 7,
            background: "var(--accent-soft)", border: "1px solid var(--accent-ring)",
            color: "var(--accent)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 1,
          }}
        >
          <ArrowLeftRight size={14} />
        </button>
        <LangSelect label={t("dub.langTarget")} value={cfg.targetLang} onChange={(v) => set({ targetLang: v })} />
      </div>
    </Section>
  );
}

function LangSelect({ label, value, onChange, sourceMode }) {
  const opts = sourceMode ? TRANSCRIBE_SOURCES : TRANSLATE_TARGETS;
  return (
    <div style={{ flex: 1 }}>
      <label style={{ display: "block", fontSize: 11, color: "var(--n-7)", fontWeight: 500, marginBottom: 5 }}>{label}</label>
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        style={selectStyle}
      >
        {opts.map((code) => (
          <option key={code} value={code}>{langLabel(code)}</option>
        ))}
      </select>
    </div>
  );
}

// ── Translate engine picker ─────────────────────────
const TRANSLATE_ENGINES = [
  { id: "google_free",  needsKey: false },
  { id: "google_cloud", needsKey: true  },
  { id: "deepl",        needsKey: true  },
  { id: "gemini",       needsKey: true  },
  { id: "openai",       needsKey: true  },
  { id: "claude",       needsKey: true  },
];

function TranslateEngineGroup({ cfg, set }) {
  const t = useT();
  const nav = useNavigate();
  const [savedKeys, setSavedKeys] = useState({});
  // Load danh sách key đã có sẵn → biết engine nào ready, engine nào cần thêm key
  useEffect(() => {
    let stopped = false;
    import("../../services/keyvault").then(({ listKeys }) => {
      listKeys().then((r) => { if (!stopped) setSavedKeys(r?.ids || {}); })
                .catch(() => {});
    });
    return () => { stopped = true; };
  }, []);

  const sel = cfg.translateEngine || "google_free";
  const selMeta = TRANSLATE_ENGINES.find((e) => e.id === sel) || TRANSLATE_ENGINES[0];
  const missingKey = selMeta.needsKey && !savedKeys[sel];

  return (
    <Section icon={Wand2} title={t("dubTrans.title")} sub={t("dubTrans.sub")}>
      <div>
        <Label>{t("dubTrans.engine")}</Label>
        <select
          value={sel}
          onChange={(e) => set({ translateEngine: e.target.value })}
          style={selectStyle}
        >
          {TRANSLATE_ENGINES.map((e) => (
            <option key={e.id} value={e.id}>
              {t(`dubTrans.engineLabel.${e.id}`)}
              {e.needsKey
                ? (savedKeys[e.id] ? " ✓" : t("dubTrans.needsKeySuffix"))
                : ""}
            </option>
          ))}
        </select>
      </div>

      {missingKey && (
        <div style={{
          marginTop: 8, padding: "10px 12px", borderRadius: 7,
          background: "rgba(251,191,36,0.10)",
          border: "1px solid rgba(251,191,36,0.30)",
          fontSize: 12, color: "var(--n-9)", lineHeight: 1.5,
        }}>
          {t("dubTrans.missingKeyWarn", { engine: t(`dubTrans.engineLabel.${sel}`) })}{" "}
          <a
            onClick={() => nav("/settings", { state: { tab: "integrations" } })}
            style={{
              color: "var(--accent)", cursor: "pointer", fontWeight: 500,
              textDecoration: "underline", textUnderlineOffset: 2,
            }}
          >
            {t("dubTrans.addKey")}
          </a>
        </div>
      )}

      <p style={{
        marginTop: 6, fontSize: 11.5, color: "var(--n-7)", lineHeight: 1.5,
      }}>
        {t(`dubTrans.hint.${sel}`)}
      </p>

      {/* Topic hint — context giúp LLM dịch chính xác hơn */}
      <div style={{ marginTop: 12 }}>
        <Label flex>
          <span>{t("dubTrans.topicHintLabel")}</span>
          <span style={{ fontSize: 10, color: "var(--n-7)", fontWeight: 400 }}>
            {(cfg.topicHint || "").length}/500
          </span>
        </Label>
        <input
          type="text"
          maxLength={500}
          placeholder={t("dubTrans.topicHintPlaceholder")}
          value={cfg.topicHint || ""}
          onChange={(e) => set({ topicHint: e.target.value })}
          style={{
            width: "100%", padding: "8px 10px", borderRadius: 6,
            background: "var(--n-1)", border: "1px solid var(--n-3)",
            color: "var(--n-10)", fontSize: 12.5, fontFamily: "inherit",
            outline: "none",
          }}
        />
        <p style={{ marginTop: 4, fontSize: 11, color: "var(--n-7)", lineHeight: 1.4 }}>
          {t("dubTrans.topicHintHelp")}
        </p>
      </div>

      {/* Glossary — terms cần giữ nguyên hoặc dịch theo cách user chỉ định */}
      <div style={{ marginTop: 12 }}>
        <Label>{t("dubTrans.glossaryLabel")}</Label>
        <textarea
          rows={4}
          placeholder={t("dubTrans.glossaryPlaceholder")}
          value={cfg.glossary || ""}
          onChange={(e) => set({ glossary: e.target.value })}
          spellCheck={false}
          style={{
            width: "100%", padding: "8px 10px", borderRadius: 6,
            background: "var(--n-1)", border: "1px solid var(--n-3)",
            color: "var(--n-10)", fontSize: 12,
            fontFamily: "var(--font-mono, 'SF Mono', monospace)",
            outline: "none", resize: "vertical", minHeight: 70,
          }}
        />
        <p style={{ marginTop: 4, fontSize: 11, color: "var(--n-7)", lineHeight: 1.4 }}>
          {t("dubTrans.glossaryHelp")}
        </p>
      </div>

      {/* Visual Context (Pass-(-1)) — toggle nâng cao + dropdown engine/model */}
      <VisualContextGroup cfg={cfg} set={set} savedKeys={savedKeys} />
    </Section>
  );
}


// ── Visual Context (nâng cao) — bật VLM phân tích keyframe ──
function VisualContextGroup({ cfg, set, savedKeys }) {
  const [models, setModels] = useState({});
  const [loadingModels, setLoadingModels] = useState(false);

  const enabled = !!cfg.enableVisualContext;
  const vEngine = cfg.visualEngine || "gemini";

  // Load model list từ backend lần đầu khi user bật toggle
  useEffect(() => {
    if (!enabled || Object.keys(models).length > 0) return;
    setLoadingModels(true);
    import("../../services/api").then(({ getVisionModels }) => {
      getVisionModels()
        .then((r) => { setModels(r?.models || {}); })
        .catch(() => {})
        .finally(() => setLoadingModels(false));
    });
  }, [enabled, models]);

  const engineOptions = [
    { id: "gemini", label: "Gemini" },
    { id: "openai", label: "OpenAI" },
    { id: "claude", label: "Claude" },
  ];
  const modelList = models[vEngine] || [];
  const selectedModel = cfg.visualModel
    || (modelList.find((m) => m.default)?.id || modelList[0]?.id || "");
  const missingKey = enabled && !savedKeys[vEngine];

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px dashed var(--n-3)" }}>
      <label style={{
        display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
        userSelect: "none",
      }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => set({ enableVisualContext: e.target.checked })}
          style={{ cursor: "pointer", width: 14, height: 14 }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--n-10)" }}>
            🎬 Phân tích video (nâng cao)
          </div>
          <div style={{ fontSize: 11, color: "var(--n-7)", marginTop: 2, lineHeight: 1.4 }}>
            AI xem 8 keyframe video → detect bối cảnh + nhân vật → giảm sai xưng hô.
            Cộng thêm chi phí API tuỳ engine bạn pick.
          </div>
        </div>
      </label>

      {enabled && (
        <div style={{ marginTop: 12, paddingLeft: 24, display: "grid", gap: 10 }}>
          <div>
            <Label>Engine VLM</Label>
            <select
              value={vEngine}
              onChange={(e) => set({ visualEngine: e.target.value, visualModel: "" })}
              style={selectStyle}
            >
              {engineOptions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}{savedKeys[e.id] ? " ✓" : " (cần key)"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label>Model</Label>
            <select
              value={selectedModel}
              onChange={(e) => set({ visualModel: e.target.value })}
              style={selectStyle}
              disabled={loadingModels || modelList.length === 0}
            >
              {loadingModels && <option>Đang tải...</option>}
              {!loadingModels && modelList.length === 0 && (
                <option value="">(không có model)</option>
              )}
              {modelList.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>

          {missingKey && (
            <div style={{
              padding: "8px 10px", borderRadius: 6,
              background: "rgba(251,191,36,0.10)",
              border: "1px solid rgba(251,191,36,0.30)",
              fontSize: 11.5, color: "var(--n-9)", lineHeight: 1.5,
            }}>
              ⚠️ Chưa có API key cho {vEngine}. Visual context sẽ skip nếu thiếu key.
              Vào Cài đặt → API keys để thêm.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const EMOTION_IDS = ["normal", "happy", "sad", "excited", "serious", "whisper"];
const EMOTION_KEYS = {
  normal: "emoNormal", happy: "emoHappy", sad: "emoSad",
  excited: "emoExcited", serious: "emoSerious", whisper: "emoWhisper",
};

function DubbingGroup({ cfg, set, voicesOmni = [], voicesEdge = [] }) {
  const t = useT();
  const isPremium = cfg.ttsModel === "premium";
  return (
    <Section
      icon={Mic} title={t("dub.sectionDubbing")} sub={t("dub.sectionDubbingSub")}
      toggle={{ value: cfg.enableDubbing, onChange: (v) => set({ enableDubbing: v }) }}
    >
      <div>
        <Label>{t("dub.modelTTS")}</Label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <TTSCard
            active={!isPremium}
            onClick={() => set({ ttsModel: "standard" })}
            icon={Zap} name={t("dub.standard")} tag={t("dub.standardTag")} tagColor="var(--n-9)"
            desc={t("dub.standardDesc")}
            time={t("dub.standardTime")}
          />
          <TTSCard
            active={isPremium}
            onClick={() => set({ ttsModel: "premium" })}
            icon={Sparkles} name={t("dub.premium")} tag={t("dub.premiumTag")} tagColor="var(--accent)"
            desc={t("dub.premiumDesc")}
            time={t("dub.premiumTime")}
          />
        </div>
      </div>

      {/* Voice picker — khác nhau giữa Standard và Premium */}
      {isPremium ? (
        <OmniVoicePicker cfg={cfg} set={set} voices={voicesOmni} />
      ) : (
        <EdgeVoicePicker cfg={cfg} set={set} voices={voicesEdge} />
      )}

      {/* Emotion — chỉ có ở Premium (OmniVoice) */}
      {isPremium && (
        <div>
          <Label>{t("dub.defaultEmotion")}</Label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {EMOTION_IDS.map((id) => (
              <Chip key={id} active={cfg.emotion === id} onClick={() => set({ emotion: id })}>{t(`dub.${EMOTION_KEYS[id]}`)}</Chip>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

/**
 * Kiểm tra voice có thuộc semantic language không. Match THEO LOCALE/LANGUAGE
 * field chính xác — KHÔNG dùng substring trên name/tags vì sẽ match nhầm
 * (vd: "vi" match cả "Victor", "Vivien", "Sylvie"...).
 */
function voiceMatchesLang(voice, semantic) {
  if (!semantic || semantic === "auto") return true;
  const prefix = LOCALE_MAP[semantic];           // "vietnamese" → "vi"
  const sem = semantic.toLowerCase();

  // 1. Locale chính xác — Edge TTS luôn có (vd "vi-VN")
  const loc = (voice.locale || "").toLowerCase();
  if (loc) {
    const locPrefix = loc.split(/[-_]/)[0];
    if (prefix && locPrefix === prefix) return true;
    // không match → loại luôn (locale là nguồn chuẩn nhất)
    return false;
  }

  // 2. Voice không có locale (OmniVoice cũ) → match qua language field hoặc tags TÁCH BIỆT
  const lang = (voice.language || "").toLowerCase();
  if (lang === sem || (prefix && lang === prefix)) return true;

  // tags là array hoặc string — split rồi compare từng phần tử
  const tagsRaw = voice.tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map((t) => String(t).toLowerCase())
    : String(tagsRaw || "").toLowerCase().split(/[\s,;]+/).filter(Boolean);
  for (const t of tags) {
    if (t === sem || (prefix && t === prefix)) return true;
  }
  return false;
}

function VoicePickerLayout({ count, children }) {
  // Bỏ language picker bên trong — voice list tự filter theo targetLang
  // ở top (sourceLang/targetLang ⇄). Tránh redundant + giảm UI clutter.
  const t = useT();
  return (
    <div>
      <Label>{t("dub.voice")}{count != null ? ` · ${t("dub.voiceCount", { n: count })}` : ""}</Label>
      {children}
    </div>
  );
}

function OmniVoicePicker({ cfg, set, voices }) {
  const t = useT();
  // Filter voices theo targetLang trước (UI consistency).
  const matchedByLang = voices.filter((v) => voiceMatchesLang(v, cfg.targetLang));
  const userClones = matchedByLang.length > 0 ? matchedByLang : voices;
  const showingAll = matchedByLang.length === 0 && voices.length > 0;

  // Voice count UI: 1-5. Default 1.
  const count = cfg.voiceCount || 1;
  const slots = cfg.voiceSlots || ["", "", "", "", ""];

  // Phân loại voices theo gender tag để app gợi ý nam/nữ cho từng slot.
  // Voice tag chứa "male" / "female" / "nam" / "nữ" → match.
  const genderOf = (v) => {
    const tagsStr = (Array.isArray(v.tags) ? v.tags.join(",") : (v.tags || "")).toLowerCase();
    if (/\b(female|nữ|nu)\b/.test(tagsStr)) return "female";
    if (/\b(male|nam)\b/.test(tagsStr)) return "male";
    return "any";
  };
  const maleVoices = userClones.filter((v) => genderOf(v) === "male");
  const femaleVoices = userClones.filter((v) => genderOf(v) === "female");

  // Suggest gender cho từng slot: slot 1 = male, slot 2 = female, slot 3+ = any
  const slotGender = (i) => (i === 0 ? "male" : i === 1 ? "female" : "any");
  const voicesForSlot = (i) => {
    const g = slotGender(i);
    if (g === "male" && maleVoices.length) return maleVoices;
    if (g === "female" && femaleVoices.length) return femaleVoices;
    return userClones;  // fallback: tất cả
  };

  const setSlot = (i, voiceId) => {
    const next = [...slots];
    next[i] = voiceId;
    set({ voiceSlots: next });
  };

  const setCount = (n) => {
    set({ voiceCount: n });
  };

  return (
    <VoicePickerLayout count={count + 1}>
      {/* Số giọng */}
      <div style={{ marginBottom: 10 }}>
        <Label>{t("dub.voiceCountLabel")}</Label>
        <select
          value={count}
          onChange={(e) => setCount(parseInt(e.target.value, 10))}
          style={{ ...selectStyle, maxWidth: 140 }}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {t("dub.voiceCountValue", { n })}
            </option>
          ))}
        </select>
        <div style={{ marginTop: 4, fontSize: 11, color: "var(--n-7)" }}>
          {count === 1
            ? t("dub.voiceCountHintSingle")
            : t("dub.voiceCountHintMulti", { n: count })}
        </div>
      </div>

      {/* N slot pickers */}
      {Array.from({ length: count }).map((_, i) => {
        const g = slotGender(i);
        const slotVoices = voicesForSlot(i);
        // Map gender → i18n key (camelCase, không dùng dot trong key vì
        // i18n resolve split dot thành nested object).
        const slotKey = g === "male" ? "dub.slotMale"
          : g === "female" ? "dub.slotFemale"
          : "dub.slotAny";
        const slotLabel = count === 1
          ? t("dub.slotSingle")
          : t(slotKey, { i: i + 1 });
        return (
          <div key={i} style={{ marginBottom: i < count - 1 ? 8 : 0 }}>
            <Label>{slotLabel}</Label>
            <select
              value={slots[i] || ""}
              onChange={(e) => setSlot(i, e.target.value)}
              style={selectStyle}
            >
              <option value="">★ {t("dub.defaultPremiumVoice")}</option>
              {slotVoices.map((v) => {
                // Premium preset prefix với ✨ để user phân biệt khỏi
                // clone của mình. Clone voice giữ format cũ {name · tags}.
                const prefix = v.isPremium ? "✨ " : "";
                const meta = v.isPremium
                  ? (v.language || "")
                  : (v.tags ? (Array.isArray(v.tags) ? v.tags.join(", ") : v.tags) : "");
                return (
                  <option key={v.id} value={v.id}>
                    {prefix}{v.name || v.id}{meta ? ` · ${meta}` : ""}
                  </option>
                );
              })}
            </select>
          </div>
        );
      })}

      {voices.length === 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--n-7)" }}>
          ⓘ {t("dub.cloneHintShort")}
        </div>
      )}
      {showingAll && (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--n-7)" }}>
          ⓘ {t("dub.showingAllVoices", { lang: cfg.targetLang })}
        </div>
      )}
    </VoicePickerLayout>
  );
}

function EdgeVoicePicker({ cfg, set, voices }) {
  const t = useT();
  if (!voices.length) {
    return (
      <div style={{
        padding: "10px 12px", background: "var(--n-1)",
        border: "1px solid var(--n-3)", borderRadius: 7,
        color: "var(--n-7)", fontSize: 12,
      }}>
        {t("dub.loadingVoices")}
      </div>
    );
  }
  // Filter theo targetLang (top-level "Ngôn ngữ đích")
  const filtered = voices.filter((v) => voiceMatchesLang(v, cfg.targetLang));
  if (filtered.length && !filtered.some((v) => (v.short_name || v.name) === cfg.edgeVoice)) {
    setTimeout(() => set({ edgeVoice: filtered[0].short_name || filtered[0].name }), 0);
  }
  return (
    <VoicePickerLayout count={filtered.length}>
      {filtered.length === 0 ? (
        <div style={emptyVoiceStyle}>{t("dub.noVoiceForLang")}</div>
      ) : (
        <select value={cfg.edgeVoice || ""} onChange={(e) => set({ edgeVoice: e.target.value })} style={selectStyle}>
          {filtered.map((v) => {
            const id = v.short_name || v.name;
            const label = `${v.display_name || v.name || id}${v.gender ? ` · ${v.gender}` : ""}${v.locale ? ` · ${v.locale}` : ""}`;
            return <option key={id} value={id}>{label}</option>;
          })}
        </select>
      )}
    </VoicePickerLayout>
  );
}

const emptyVoiceStyle = {
  padding: "10px 12px", background: "var(--n-1)", border: "1px solid var(--n-3)",
  borderRadius: 7, color: "var(--n-7)", fontSize: 12,
};

function TTSCard({ active, onClick, icon: Icon, name, tag, tagColor, desc, time }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "relative", textAlign: "left",
        padding: 14, borderRadius: 8,
        background: active ? "var(--accent-soft)" : "var(--n-0)",
        border: `1.5px solid ${active ? "var(--accent)" : "var(--n-3)"}`,
        cursor: "pointer", fontFamily: "inherit",
      }}
    >
      <span style={{
        position: "absolute", top: 10, right: 10,
        fontSize: 10, fontWeight: 600, color: tagColor,
        padding: "2px 7px", borderRadius: 9,
        background: "var(--n-2)", border: `1px solid var(--n-3)`,
      }}>{tag}</span>
      <Icon size={16} style={{ color: active ? "var(--accent)" : "var(--n-8)", marginBottom: 6 }} />
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--n-10)", marginBottom: 3 }}>{name}</div>
      <div style={{ fontSize: 11.5, color: "var(--n-7)", lineHeight: 1.4, marginBottom: 6 }}>{desc}</div>
      <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: "var(--n-6)" }}>{time}</div>
    </button>
  );
}

/* ─── Subtitle group: tất cả tuỳ chọn inline ─── */
const SUB_TEMPLATES = [
  { id: "netflix", name: "Netflix", descKey: "tplNetflixDesc",
    style: { font: "Inter", fontSize: 24, bold: true, italic: false,
      textColor: "#FFFFFF", outlineColor: "#000000", outlineSize: 1,
      bgColor: "#000000", bgOpacity: 70, shadow: 1,
      position: "bottom", margin: 40 } },
  { id: "tiktok",  name: "TikTok",  descKey: "tplTiktokDesc",
    style: { font: "Montserrat", fontSize: 28, bold: true, italic: false,
      textColor: "#FCD34D", outlineColor: "#000000", outlineSize: 3,
      bgColor: "#000000", bgOpacity: 0, shadow: 4,
      position: "bottom", margin: 60 } },
  { id: "news",    name: "News",    descKey: "tplNewsDesc",
    style: { font: "Roboto", fontSize: 20, bold: true, italic: false,
      textColor: "#FFFFFF", outlineColor: "#000000", outlineSize: 1,
      bgColor: "#DC2626", bgOpacity: 95, shadow: 0,
      position: "top", margin: 30 } },
  { id: "minimal", name: "Minimal", descKey: "tplMinimalDesc",
    style: { font: "Inter", fontSize: 22, bold: false, italic: false,
      textColor: "#FFFFFF", outlineColor: "#000000", outlineSize: 2,
      bgColor: "#000000", bgOpacity: 0, shadow: 3,
      position: "bottom", margin: 50 } },
  { id: "karaoke", name: "Karaoke", descKey: "tplKaraokeDesc",
    style: { font: "Be Vietnam Pro", fontSize: 30, bold: true, italic: false,
      textColor: "#A855F7", outlineColor: "#FFFFFF", outlineSize: 2,
      bgColor: "#000000", bgOpacity: 0, shadow: 4,
      position: "bottom", margin: 50 } },
];
const ASPECT_DEFS = [
  { id: "original", labelKey: "aspectOriginal" },
  { id: "16:9",     labelKey: "aspectYt" },
  { id: "9:16",     labelKey: "aspectTt" },
  { id: "1:1",      labelKey: "aspectIg" },
  { id: "4:5",      labelKey: "aspectFeed" },
  { id: "16:9w",    labelKey: "aspectTw" },
];
const POSITION_DEFS = [
  { id: "top", labelKey: "posTop" },
  { id: "middle", labelKey: "posMiddle" },
  { id: "bottom", labelKey: "posBottom" },
];

function SubtitleGroup({ cfg, set }) {
  const t = useT();
  return (
    <Section
      icon={Captions} title={t("dub.subSection")} sub={t("dub.subSectionSub")}
      toggle={{ value: cfg.enableSubtitle, onChange: (v) => set({ enableSubtitle: v }) }}
    >
      <SubGroup title={t("dub.template")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
          {SUB_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => set({ template: tpl.id, ...tpl.style })}
              style={{
                padding: 8, borderRadius: 7, textAlign: "left",
                background: cfg.template === tpl.id ? "var(--accent-soft)" : "var(--n-0)",
                border: `1.5px solid ${cfg.template === tpl.id ? "var(--accent)" : "var(--n-3)"}`,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--n-10)" }}>{tpl.name}</div>
              <div style={{ fontSize: 10.5, color: "var(--n-7)", marginTop: 2 }}>{t(`dub.${tpl.descKey}`)}</div>
            </button>
          ))}
        </div>
      </SubGroup>

      <SubGroup title={t("dub.text")} Icon={Type}>
        <Row2>
          <div>
            <Label>{t("dub.fontLabel")}</Label>
            <select value={cfg.font} onChange={(e) => set({ font: e.target.value })} style={selectStyle}>
              <option>Inter</option><option>Roboto</option><option>Montserrat</option><option>Be Vietnam Pro</option>
            </select>
          </div>
          <div>
            <Label flex><span>{t("dub.fontSize")}</span><Mono>{cfg.fontSize}px</Mono></Label>
            <input type="range" min="12" max="48" value={cfg.fontSize}
              onChange={(e) => set({ fontSize: +e.target.value })}
              style={{ width: "100%", accentColor: "var(--accent)" }} />
          </div>
        </Row2>
        <Row2>
          <CheckChip on={cfg.bold}   onChange={(v) => set({ bold: v })}  >Bold</CheckChip>
          <CheckChip on={cfg.italic} onChange={(v) => set({ italic: v })}>Italic</CheckChip>
        </Row2>
      </SubGroup>

      <SubGroup title={t("dub.color")} Icon={Palette}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <ColorField label={t("dub.colorText")}  value={cfg.textColor}    onChange={(v) => set({ textColor: v })} />
          <ColorField label={t("dub.colorOutline")} value={cfg.outlineColor} onChange={(v) => set({ outlineColor: v })} />
          <ColorField label={t("dub.colorBg")}  value={cfg.bgColor}      onChange={(v) => set({ bgColor: v })} />
        </div>
        <Row2>
          <Slider label={t("dub.outlineSize")} value={cfg.outlineSize} min={0} max={6}   suffix="px" onChange={(v) => set({ outlineSize: v })} />
          <Slider label={t("dub.bgOpacity")} value={cfg.bgOpacity}   min={0} max={100} suffix="%"  onChange={(v) => set({ bgOpacity: v })} />
        </Row2>
        <Row2>
          <Slider label={t("dub.shadow")} value={cfg.shadow} min={0} max={10} suffix="px" onChange={(v) => set({ shadow: v })} />
          <div />
        </Row2>
      </SubGroup>

      <SubGroup title={t("dub.position")} Icon={MapPin}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          {POSITION_DEFS.map((p) => (
            <button
              key={p.id}
              onClick={() => set({ position: p.id })}
              style={{
                padding: "8px 12px", borderRadius: 7,
                background: cfg.position === p.id ? "var(--accent-soft)" : "var(--n-0)",
                border: `1.5px solid ${cfg.position === p.id ? "var(--accent)" : "var(--n-3)"}`,
                color: "var(--n-10)", fontSize: 12.5, fontWeight: 500,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >{t(`dub.${p.labelKey}`)}</button>
          ))}
        </div>
        <Slider label={t("dub.margin")} value={cfg.margin} min={0} max={120} suffix="px" onChange={(v) => set({ margin: v })} />
      </SubGroup>

      <SubGroup title={t("dub.animation")} Icon={Wand2}>
        <select value={cfg.animation} onChange={(e) => set({ animation: e.target.value })} style={selectStyle}>
          <option value="none">{t("dub.animNone")}</option>
          <option value="fade">{t("dub.animFade")}</option>
          <option value="slide">{t("dub.animSlide")}</option>
          <option value="typewriter">{t("dub.animType")}</option>
        </select>
      </SubGroup>

      <SubGroup title={t("dub.aspect")}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {ASPECT_DEFS.map((a) => {
            const on = cfg.aspect === a.id;
            return (
              <button
                key={a.id}
                onClick={() => set({ aspect: a.id })}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 12px", borderRadius: 7,
                  background: on ? "var(--accent-soft)" : "var(--n-0)",
                  border: `1.5px solid ${on ? "var(--accent)" : "var(--n-3)"}`,
                  color: "var(--n-10)", fontSize: 12.5,
                  cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                }}
              >
                <input type="radio" checked={on} readOnly
                  style={{ accentColor: "var(--accent)" }} />
                {t(`dub.${a.labelKey}`)}
              </button>
            );
          })}
        </div>
      </SubGroup>

      <SubGroup title={t("dub.cropTitle")} Icon={Crop}>
        {[
          { id: "smart",     bKey: "cropSmart",  eKey: "cropSmartHint", rec: true },
          { id: "center",    bKey: "cropCenter", eKey: "cropCenterHint" },
          { id: "letterbox", bKey: "cropLetter", eKey: "cropLetterHint" },
        ].map((c) => (
          <label
            key={c.id}
            onClick={() => set({ cropMode: c.id })}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 12px", marginBottom: 6, borderRadius: 7,
              background: cfg.cropMode === c.id ? "var(--accent-soft)" : "var(--n-0)",
              border: `1.5px solid ${cfg.cropMode === c.id ? "var(--accent)" : "var(--n-3)"}`,
              cursor: "pointer",
            }}
          >
            <input type="radio" checked={cfg.cropMode === c.id} readOnly
              style={{ accentColor: "var(--accent)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: "var(--n-10)", fontWeight: 600 }}>
                {t(`dub.${c.bKey}`)}
                {c.rec && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: "var(--accent-soft)", color: "var(--accent)" }}>{t("dub.recommended")}</span>}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--n-7)", marginTop: 2 }}>{t(`dub.${c.eKey}`)}</div>
            </div>
          </label>
        ))}
      </SubGroup>

      <SubGroup title={t("dub.autoTitle")} Icon={Bot}>
        {[
          { key: "autoFontSize", bKey: "autoFont",   eKey: "autoFontHint" },
          { key: "autoPace",     bKey: "autoPace",   eKey: "autoPaceHint" },
          { key: "smartChunk",   bKey: "smartChunk", eKey: "smartChunkHint" },
        ].map((f) => (
          <div key={f.key} style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 12px", marginBottom: 6, borderRadius: 7,
            background: "var(--n-0)", border: "1px solid var(--n-3)",
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, color: "var(--n-10)", fontWeight: 600 }}>{t(`dub.${f.bKey}`)}</div>
              <div style={{ fontSize: 11.5, color: "var(--n-7)", marginTop: 2 }}>{t(`dub.${f.eKey}`)}</div>
            </div>
            <Toggle on={cfg[f.key]} onChange={(v) => set({ [f.key]: v })} />
          </div>
        ))}

        {/* Highlight từ khoá — text input thay toggle vì cần danh sách từ */}
        <div style={{
          padding: "10px 12px", borderRadius: 7,
          background: "var(--n-0)", border: "1px solid var(--n-3)",
        }}>
          <div style={{ fontSize: 12.5, color: "var(--n-10)", fontWeight: 600 }}>{t("dub.highlight")}</div>
          <div style={{ fontSize: 11.5, color: "var(--n-7)", marginTop: 2, marginBottom: 8 }}>
            {t("dub.highlightHint")}
          </div>
          <input
            type="text"
            placeholder={t("dub.highlightPlaceholder")}
            value={cfg.highlightKeywords}
            onChange={(e) => set({ highlightKeywords: e.target.value })}
            style={{
              width: "100%", padding: "7px 10px", borderRadius: 6,
              background: "var(--n-1)", border: "1px solid var(--n-3)",
              color: "var(--n-10)", fontSize: 12.5, fontFamily: "inherit",
              outline: "none",
            }}
          />
        </div>
      </SubGroup>
    </Section>
  );
}

function OriginalMixGroup({ cfg, set }) {
  const t = useT();
  return (
    <>
      <Section
        icon={Volume2} title={t("dub.bgMusic")} sub={t("dub.bgMusicSub")}
        toggle={{ value: cfg.keepAccompaniment, onChange: (v) => set({ keepAccompaniment: v }) }}
      >
        <Slider
          label={t("dub.bgMusicVolume")} value={cfg.accompVolume}
          min={0} max={100} suffix="%"
          onChange={(v) => set({ accompVolume: v })}
        />
      </Section>
      <Section
        icon={Mic} title={t("dub.origVoice")} sub={t("dub.origVoiceSub")}
        toggle={{ value: cfg.keepOriginalVoice, onChange: (v) => set({ keepOriginalVoice: v }) }}
      >
        <Slider
          label={t("dub.origVoiceVolume")} value={cfg.originalVoiceVolume}
          min={0} max={100} suffix="%"
          onChange={(v) => set({ originalVoiceVolume: v })}
        />
      </Section>
    </>
  );
}

function FolderGroup({ outputFolder, setOutputFolder }) {
  const t = useT();
  return (
    <Section icon={FolderOpen} title={t("dub.saveTo")}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 12px", background: "var(--n-0)",
        border: "1px solid var(--n-3)", borderRadius: 7,
      }}>
        <span style={{
          flex: 1, fontFamily: "var(--font-mono, monospace)", fontSize: 12,
          color: "var(--n-9)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {outputFolder || t("dub.folderDefault")}
        </span>
        <button
          onClick={async () => {
            try {
              const dir = await window.voxstudio?.pickFolder?.();
              if (dir) setOutputFolder(dir);
            } catch { /* ignore */ }
          }}
          style={ghostBtn}
        >{t("dub.chooseDots")}</button>
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Tiny atoms                                                           */
/* ─────────────────────────────────────────────────────────────────── */
function SubGroup({ title, Icon, children }) {
  return (
    <div style={{
      paddingTop: 12, marginTop: 12,
      borderTop: "1px dashed var(--n-3)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 11, color: "var(--accent)", fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.06em",
        marginBottom: 8,
      }}>
        {Icon && <Icon size={11} />}
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {children}
      </div>
    </div>
  );
}
function Label({ children, flex }) {
  return (
    <label style={{
      display: flex ? "flex" : "block",
      justifyContent: flex ? "space-between" : undefined,
      alignItems: flex ? "center" : undefined,
      fontSize: 11, color: "var(--n-7)", fontWeight: 500, marginBottom: 5,
    }}>{children}</label>
  );
}
function Mono({ children }) {
  return <b style={{ color: "var(--accent)", fontFamily: "var(--font-mono, monospace)", fontWeight: 500 }}>{children}</b>;
}
function Row2({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{children}</div>;
}
function Chip({ active, onClick, ghost, icon: Icon, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 11px", borderRadius: 14, fontFamily: "inherit",
        background: active ? "var(--accent-soft)" : "var(--n-0)",
        border: `1.5px ${ghost ? "dashed" : "solid"} ${active ? "var(--accent)" : "var(--n-3)"}`,
        color: ghost ? "var(--n-7)" : "var(--n-10)",
        fontSize: 12, cursor: "pointer",
        display: "inline-flex", alignItems: "center", gap: 5,
      }}
    >
      {Icon && <Icon size={11} />}
      {children}
    </button>
  );
}
function CheckChip({ on, onChange, children }) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 12px", borderRadius: 7,
        background: on ? "var(--accent-soft)" : "var(--n-0)",
        border: `1.5px solid ${on ? "var(--accent)" : "var(--n-3)"}`,
        color: "var(--n-10)", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit",
      }}
    >
      <span style={{
        width: 14, height: 14, borderRadius: 3,
        background: on ? "var(--accent)" : "transparent",
        border: `1.5px solid ${on ? "var(--accent)" : "var(--n-4)"}`,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        color: "#fff",
      }}>{on && <Check size={9} />}</span>
      {children}
    </button>
  );
}
function ColorField({ label, value, onChange }) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "7px 10px", background: "var(--n-0)",
      border: "1px solid var(--n-3)", borderRadius: 7, cursor: "pointer",
    }}>
      <span style={{ color: "var(--n-7)", fontSize: 11.5, minWidth: 26 }}>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: 22, height: 22, padding: 0, border: "none", borderRadius: 4, cursor: "pointer", background: "transparent" }} />
      <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--n-9)" }}>{value.toUpperCase()}</span>
    </label>
  );
}
function Slider({ label, value, min, max, suffix, onChange }) {
  return (
    <div>
      <Label flex><span>{label}</span><Mono>{value}{suffix}</Mono></Label>
      <input type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(+e.target.value)}
        style={{ width: "100%", accentColor: "var(--accent)" }} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Inline style atoms                                                   */
/* ─────────────────────────────────────────────────────────────────── */
const selectStyle = {
  width: "100%", padding: "8px 10px", borderRadius: 7,
  background: "var(--n-0)", border: "1px solid var(--n-3)",
  color: "var(--n-10)", fontSize: 12.5, fontFamily: "inherit", cursor: "pointer",
};
const primaryBtn = {
  display: "inline-flex", alignItems: "center", gap: 7,
  padding: "10px 18px", borderRadius: 8,
  background: "var(--accent)", color: "#fff", border: "none",
  fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
const ghostBtn = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "6px 12px", borderRadius: 6,
  background: "transparent", border: "1px solid var(--n-3)",
  color: "var(--n-9)", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};
const savePresetActive = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "6px 12px", borderRadius: 6,
  background: "var(--accent-soft)", border: "1px solid var(--accent)",
  color: "var(--accent)", fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit",
};
const resetDefaultBtn = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "6px 12px", borderRadius: 6,
  background: "transparent", border: "1px solid var(--n-3)",
  color: "var(--n-8)", fontSize: 12, fontWeight: 500,
  cursor: "pointer", fontFamily: "inherit",
};
const linkBtn = {
  background: "transparent", border: "none", color: "var(--n-7)",
  fontSize: 12, cursor: "pointer", textDecoration: "underline",
  textUnderlineOffset: 2, fontFamily: "inherit",
};
const iconXBtn = {
  width: 26, height: 26, borderRadius: 5,
  background: "transparent", border: "none", color: "var(--n-7)",
  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
};
