import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Upload, Loader2, Film, X, FolderOpen, Folder,
  Library as LibraryIcon, Mic, ChevronLeft, ChevronRight, Hourglass,
} from "lucide-react";
import { createDubbingProject, thumbnailURL } from "../../services/api";
import { useT } from "../../i18n/I18nContext";
import { useBatch } from "../../batch/BatchContext";
import { useToast } from "../ui/Toast";
import { showError } from "../../services/errors";
import PageHeader, { Page } from "../ui/PageHeader";
import Segmented from "../ui/Segmented";

const MAX_BATCH = 10;

/**
 * StudioHome (redesign theo reference Quick Magic):
 *   - 2 tab: Thư viện (chọn project đã có) · Upload (kéo file mới)
 *   - Danh sách hiện trong tab, checkbox chọn tối đa 10
 *   - Strip "Video đã chọn" dưới cùng với remove X
 *   - Chế độ xuất · Thư mục lưu · Bắt đầu lồng tiếng (disabled khi thiếu)
 */
export default function StudioHome() {
  const t = useT();
  const navigate = useNavigate();
  const toast = useToast();
  const { queue } = useBatch();
  const fileRef = useRef(null);
  const [tab, setTab] = useState("library"); // "library" | "upload"

  // Thư viện = thư mục local chọn từ máy
  const [libFolder, setLibFolder] = useState(""); // đường dẫn folder đang xem
  const [libFiles, setLibFiles] = useState([]);   // [{name, path, size}]
  const [libLoading, setLibLoading] = useState(false);
  // selectedLibPaths chứa các path của file local đã chọn
  const [selectedLibPaths, setSelectedLibPaths] = useState(new Set());

  const [pendingFiles, setPendingFiles] = useState([]); // file drag/drop
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // ── Selection helpers ────────────────────────────────────
  const selectedCount = selectedLibPaths.size + pendingFiles.length;
  const remaining = Math.max(0, MAX_BATCH - selectedCount);

  const toggleLibFile = (path) => {
    setSelectedLibPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else if (selectedCount < MAX_BATCH) next.add(path);
      return next;
    });
  };

  // Chọn folder từ máy + liệt kê video bên trong
  const pickLibraryFolder = async () => {
    if (!window.voxstudio?.pickFolder) {
      toast.warn("Chọn thư mục chỉ khả dụng trong app desktop.");
      return;
    }
    if (!window.voxstudio?.listVideosInFolder) {
      toast.error("IPC chưa sẵn sàng. Hãy Cmd+Q app rồi mở lại.");
      return;
    }
    const folder = await window.voxstudio.pickFolder();
    if (!folder) return;
    setLibLoading(true);
    setLibFolder(folder);
    try {
      const files = await window.voxstudio.listVideosInFolder(folder);
      setLibFiles(Array.isArray(files) ? files : []);
    } catch (e) {
      showError(toast, e, { context: "read folder" });
      setLibFolder("");
      setLibFiles([]);
    }
    setLibLoading(false);
  };

  const backToNoFolder = () => {
    setLibFolder("");
    setLibFiles([]);
    setSelectedLibPaths(new Set());
  };

  const addFiles = (files) => {
    const videos = Array.from(files).filter((f) =>
      /^video\//.test(f.type) || /\.(mp4|mov|mkv|avi|webm)$/i.test(f.name)
    );
    const take = videos.slice(0, remaining);
    if (take.length > 0) {
      setPendingFiles((prev) => [...prev, ...take]);
      // Sau khi thêm video → chuyển sang tab Thư viện để thấy toàn bộ đã chọn
      setTab("library");
    }
  };

  const removePendingFile = (idx) =>
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));

  const removeLibFile = (path) =>
    setSelectedLibPaths((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });

  const clearSelection = () => {
    setSelectedLibPaths(new Set());
    setPendingFiles([]);
  };

  // "Chọn" button — tạo project(s) rồi điều hướng sang trang lồng tiếng
  // (project đầu tiên). Các project khác đã tạo user có thể mở từ library.
  const handleOpen = async () => {
    if (uploading || selectedCount === 0) return;
    setUploading(true);
    const errors = [];

    // Upload song song thay vì tuần tự — tránh block khi 1 file lâu.
    const libTasks = Array.from(selectedLibPaths).map(async (p) => {
      const meta = libFiles.find((f) => f.path === p);
      if (!meta) return null;
      try {
        const buf = await window.voxstudio.readFileAsBuffer(p);
        const blob = new Blob([buf], { type: guessMime(meta.name) });
        const file = new File([blob], meta.name, { type: blob.type });
        const proj = await createDubbingProject(
          file, "vietnamese", undefined, "auto", true, true
        );
        return proj.id;
      } catch (e) {
        errors.push(`${meta.name}: ${e?.message || e}`);
        return null;
      }
    });
    const fileTasks = pendingFiles.map(async (f) => {
      try {
        const proj = await createDubbingProject(
          f, "vietnamese", undefined, "auto", true, true
        );
        return proj.id;
      } catch (e) {
        errors.push(`${f.name}: ${e?.message || e}`);
        return null;
      }
    });
    const results = await Promise.all([...libTasks, ...fileTasks]);
    const createdIds = results.filter(Boolean);

    setUploading(false);

    if (createdIds.length === 0) {
      toast.error("Không tạo được project. Kiểm tra VITE_API_URL. " + errors.join("; "));
      return;
    }

    if (errors.length > 0) {
      toast.warn("Một số file lỗi: " + errors.join("; "));
    }

    clearSelection();
    // Truyền cả batch xuống trang Dubbing — user chỉnh setting ở project đầu,
    // nút Bắt đầu sẽ apply cho toàn bộ.
    navigate(`/studio/${createdIds[0]}`, { state: { batchIds: createdIds } });
  };

  return (
    <Page>
      <PageHeader
        title={t("studio.brand")}
        subtitle={t("brand.tagline")}
      >
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "library", label: t("shell.titleLibrary"), icon: LibraryIcon },
            { value: "upload",  label: "Upload",                 icon: Upload },
          ]}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
      <div className="mx-auto px-8 py-6" style={{ maxWidth: 1000 }}>
        {/* Tab content */}
        <div
          className="rounded-lg p-4 mb-4"
          style={{
            background: "var(--n-1)",
            border: "1px solid var(--n-3)",
            minHeight: 320,
          }}
        >
          {tab === "library" ? (
            <LibraryList
              folder={libFolder}
              files={libFiles}
              loading={libLoading}
              selected={selectedLibPaths}
              onToggle={toggleLibFile}
              canAddMore={remaining > 0}
              onPickFolder={pickLibraryFolder}
              onBack={backToNoFolder}
            />
          ) : (
            <UploadTab
              dragOver={dragOver}
              setDragOver={setDragOver}
              onAddFiles={addFiles}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const files = e.dataTransfer?.files;
                if (files?.length) addFiles(files);
              }}
              fileRef={fileRef}
              pendingFiles={pendingFiles}
              onRemove={removePendingFile}
              remaining={remaining}
            />
          )}

          <div className="mt-4 text-center text-xs"
               style={{ color: "var(--accent)" }}>
            {t("studioHome.selectedCount", { n: selectedCount, max: MAX_BATCH })}
          </div>
        </div>

        {/* Strip video đã chọn */}
        {selectedCount > 0 && (
          <SelectedStrip
            libFiles={libFiles.filter((f) => selectedLibPaths.has(f.path))}
            files={pendingFiles}
            onRemoveLib={removeLibFile}
            onRemoveFile={removePendingFile}
            onAddMore={() => { setTab("upload"); fileRef.current?.click(); }}
            canAddMore={remaining > 0}
          />
        )}

        {/* Nút Chọn — mở video đã chọn trong trang lồng tiếng */}
        <button
          onClick={handleOpen}
          disabled={uploading || selectedCount === 0}
          className="w-full flex items-center justify-center gap-2 rounded-md py-2.5 text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed mb-4"
          style={{
            background: "linear-gradient(135deg, var(--accent), #8b5cf6)",
            color: "#fff",
          }}
        >
          {uploading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <ChevronRight size={14} />
          )}
          {uploading
            ? t("studioHome.uploading", { n: selectedCount })
            : selectedCount > 0
            ? t("studioHome.openInDub", { n: selectedCount })
            : t("studioHome.selectFirst")}
        </button>

        {/* Tiến trình / Lịch sử — nằm dưới cùng */}
        {queue.length > 0 && <QueuePanel queue={queue} />}
      </div>
      </div>
    </Page>
  );
}

// ── Tab button ───────────────────────────────────────────
function TabButton({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors"
      style={{
        background: active ? "rgba(108,92,231,0.12)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-secondary)",
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
      }}
    >
      {icon} {label}
    </button>
  );
}

// ── Library list (local folder) ──────────────────────────
function LibraryList({
  folder, files, loading, selected, onToggle, canAddMore, onPickFolder, onBack,
}) {
  const t = useT();
  // Chưa chọn folder → CTA chọn
  if (!folder) {
    return (
      <div className="text-center py-14">
        <Folder size={36} className="mx-auto mb-3"
                style={{ color: "var(--text-secondary)" }} />
        <p className="text-sm mb-3"
           style={{ color: "var(--text-primary)" }}>
          {t("studioHome.libraryEmpty")}
        </p>
        <button
          onClick={onPickFolder}
          className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium"
          style={{
            background: "rgba(108,92,231,0.15)",
            color: "var(--accent)",
            border: "1px solid rgba(108,92,231,0.3)",
          }}
        >
          <FolderOpen size={14} /> {t("studioHome.pickFolder")}
        </button>
      </div>
    );
  }
  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-3 text-xs">
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded px-2 py-1"
          style={{
            color: "var(--accent)",
            background: "rgba(108,92,231,0.1)",
          }}
        >
          <ChevronLeft size={12} />
          {folderBasename(folder)}
        </button>
        <button
          onClick={onPickFolder}
          className="text-[11px] underline"
          style={{ color: "var(--text-secondary)" }}
        >
          {t("studioHome.changeFolder")}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs py-6"
             style={{ color: "var(--text-secondary)" }}>
          <Loader2 size={12} className="animate-spin" /> {t("studioHome.reading")}
        </div>
      ) : files.length === 0 ? (
        <p className="text-xs py-6 text-center"
           style={{ color: "var(--text-secondary)" }}>
          {t("studioHome.noVideos")}
        </p>
      ) : (
        <div className="space-y-1.5">
          {files.map((f) => (
            <LibraryRow
              key={f.path}
              file={f}
              checked={selected.has(f.path)}
              disabled={!selected.has(f.path) && !canAddMore}
              onToggle={() => onToggle(f.path)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function folderBasename(full) {
  if (!full) return "";
  return full.split(/[\\/]/).filter(Boolean).pop() || full;
}

// Cache thumbnail đã generate để không render lại khi scroll / re-mount
const _thumbCache = new Map();

function LocalVideoThumb({ path, width, height }) {
  const [src, setSrc] = useState(() => _thumbCache.get(path) || null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  useEffect(() => {
    if (_thumbCache.has(path)) { setSrc(_thumbCache.get(path)); return; }
    let cancelled = false;
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    // webSecurity tắt ở Electron main → load file:// trực tiếp được
    v.src = "file://" + encodeURI(path).replace(/#/g, "%23");
    v.onerror = () => console.warn("[thumb] video error", path, v.error);
    const onLoaded = () => {
      // seek tới 1s (hoặc giữa video nếu ngắn hơn) rồi capture
      try { v.currentTime = Math.min(1, (v.duration || 2) * 0.1); } catch {}
    };
    const onSeeked = () => {
      if (cancelled) return;
      try {
        const c = document.createElement("canvas");
        const ratio = (v.videoWidth || 16) / (v.videoHeight || 9);
        c.width = 128;
        c.height = Math.round(128 / ratio);
        const ctx = c.getContext("2d");
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const dataUrl = c.toDataURL("image/jpeg", 0.7);
        _thumbCache.set(path, dataUrl);
        setSrc(dataUrl);
      } catch (e) {
        // ignore
      }
      v.src = "";
    };
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("error", (e) => {
      console.warn("[thumb] error event", path, e);
      v.src = "";
    });
    return () => {
      cancelled = true;
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("seeked", onSeeked);
      v.src = "";
    };
  }, [path]);

  return (
    <div
      className="flex-shrink-0 rounded overflow-hidden relative flex items-center justify-center"
      style={{
        width, height,
        background: "linear-gradient(135deg, rgba(30,30,50,0.8), rgba(10,10,25,0.95))",
      }}
    >
      {src ? (
        <img src={src} alt=""
             className="absolute inset-0 w-full h-full object-cover"
             ref={videoRef} />
      ) : (
        <Film size={14} style={{ color: "rgba(255,255,255,0.3)" }} />
      )}
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}

function LibraryRow({ file, checked, disabled, onToggle }) {
  return (
    <label
      className="flex items-center gap-3 rounded-md px-2 py-2 cursor-pointer transition-colors"
      style={{
        background: checked ? "rgba(108,92,231,0.1)" : "rgba(255,255,255,0.02)",
        border: `1px solid ${checked ? "rgba(108,92,231,0.4)" : "transparent"}`,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        className="w-4 h-4 rounded cursor-pointer"
        style={{ accentColor: "var(--accent)" }}
      />
      <LocalVideoThumb path={file.path} width={56} height={32} />
      <span className="flex-1 text-sm truncate"
            style={{ color: "var(--text-primary)" }}
            title={file.path}>
        {file.name}
      </span>
      <span className="text-xs font-mono"
            style={{ color: "var(--text-secondary)" }}>
        {formatSize(file.size)}
      </span>
    </label>
  );
}

function formatSize(bytes) {
  if (!bytes) return "";
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function guessMime(name) {
  const ext = name.toLowerCase().split(".").pop();
  return {
    mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska",
    avi: "video/x-msvideo", webm: "video/webm",
  }[ext] || "video/mp4";
}

// ── Upload tab ───────────────────────────────────────────
function UploadTab({
  dragOver, setDragOver, onAddFiles, onDrop, fileRef,
  pendingFiles, onRemove, remaining,
}) {
  return (
    <>
      <div
        onClick={() => remaining > 0 && fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className="rounded-xl p-12 text-center cursor-pointer transition-all"
        style={{
          border: `2px dashed ${dragOver ? "var(--accent)" : "rgba(127,127,160,0.3)"}`,
          background: dragOver ? "rgba(108,92,231,0.06)" : "rgba(255,255,255,0.02)",
          opacity: remaining === 0 ? 0.5 : 1,
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && onAddFiles(e.target.files)}
        />
        <Upload size={32} className="mx-auto mb-2"
                style={{ color: "var(--text-secondary)" }} />
        <p className="text-sm font-medium mb-1"
           style={{ color: "var(--text-primary)" }}>
          {remaining === 0 ? "Đã đạt tối đa 10 video" : "Kéo thả video vào đây"}
        </p>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Hoặc click để chọn · MP4 · MOV · MKV · AVI · còn {remaining} slot
        </p>
      </div>

      {pendingFiles.length > 0 && (
        <div className="mt-3 space-y-1">
          {pendingFiles.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-md px-3 py-2"
              style={{
                background: "rgba(108,92,231,0.08)",
                border: "1px solid rgba(108,92,231,0.25)",
              }}
            >
              <Film size={13} style={{ color: "var(--accent)" }} />
              <span className="flex-1 text-xs truncate"
                    style={{ color: "var(--text-primary)" }}>
                {f.name}
              </span>
              <span className="text-[10px]"
                    style={{ color: "var(--text-secondary)" }}>
                {(f.size / 1024 / 1024).toFixed(1)} MB
              </span>
              <button
                onClick={() => onRemove(i)}
                className="p-0.5 rounded"
                style={{ color: "var(--text-secondary)" }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Selected strip ───────────────────────────────────────
function SelectedStrip({
  libFiles, files, onRemoveLib, onRemoveFile, onAddMore, canAddMore,
}) {
  const total = libFiles.length + files.length;
  return (
    <div
      className="rounded-lg p-4 mb-4"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid rgba(127,127,160,0.15)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium"
              style={{ color: "var(--text-primary)" }}>
          Video đã chọn ({total}/{MAX_BATCH})
        </span>
        {canAddMore && (
          <button
            onClick={onAddMore}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs"
            style={{
              background: "rgba(255,255,255,0.04)",
              color: "var(--text-secondary)",
              border: "1px solid rgba(127,127,160,0.2)",
            }}
          >
            + Thêm video
          </button>
        )}
      </div>
      <div className="grid grid-cols-5 gap-2">
        {libFiles.map((f) => (
          <Thumb
            key={`lib-${f.path}`}
            label={f.name}
            path={f.path}
            onRemove={() => onRemoveLib(f.path)}
          />
        ))}
        {files.map((f, i) => (
          <Thumb
            key={`up-${i}`}
            label={f.name}
            file={f}
            onRemove={() => onRemoveFile(i)}
            isNew
          />
        ))}
      </div>
    </div>
  );
}

function Thumb({ label, onRemove, isNew, path, file }) {
  // Lib file → có path, load qua file://. Upload file → có File object, dùng
  // URL.createObjectURL.
  const [src, setSrc] = useState(() => path ? _thumbCache.get(path) : null);
  useEffect(() => {
    if (path && _thumbCache.has(path)) { setSrc(_thumbCache.get(path)); return; }
    if (!path && !file) return;
    let cancelled = false;
    let objUrl = null;
    const v = document.createElement("video");
    v.preload = "auto"; v.muted = true; v.playsInline = true;
    if (path) {
      v.src = "file://" + encodeURI(path).replace(/#/g, "%23");
    } else {
      objUrl = URL.createObjectURL(file);
      v.src = objUrl;
    }
    const onLoaded = () => {
      try { v.currentTime = Math.min(1, (v.duration || 2) * 0.1); } catch {}
    };
    const onSeeked = () => {
      if (cancelled) return;
      try {
        const c = document.createElement("canvas");
        const ratio = (v.videoWidth || 16) / (v.videoHeight || 9);
        c.width = 200; c.height = Math.round(200 / ratio);
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        const dataUrl = c.toDataURL("image/jpeg", 0.7);
        if (path) _thumbCache.set(path, dataUrl);
        setSrc(dataUrl);
      } catch {}
      if (objUrl) URL.revokeObjectURL(objUrl);
      v.src = "";
    };
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("seeked", onSeeked);
    return () => {
      cancelled = true;
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("seeked", onSeeked);
      if (objUrl) URL.revokeObjectURL(objUrl);
      v.src = "";
    };
  }, [path, file]);

  return (
    <div className="relative">
      <div
        className="rounded-md flex items-center justify-center overflow-hidden"
        style={{
          aspectRatio: "16/9",
          background: "rgba(0,0,0,0.4)",
          border: `1px solid ${isNew ? "rgba(108,92,231,0.4)" : "rgba(127,127,160,0.2)"}`,
        }}
      >
        {src ? (
          <img src={src} alt="" className="w-full h-full object-cover" />
        ) : (
          <Film size={18} style={{ color: "var(--accent)" }} />
        )}
      </div>
      <p className="text-[10px] truncate mt-1"
         style={{ color: "var(--text-secondary)" }}
         title={label}>
        {label}
      </p>
      <button
        onClick={onRemove}
        className="absolute -top-1 -right-1 rounded-full flex items-center justify-center"
        style={{
          width: 18, height: 18,
          background: "rgba(0,0,0,0.75)",
          color: "#fff",
          border: "1px solid rgba(127,127,160,0.3)",
        }}
      >
        <X size={10} />
      </button>
    </div>
  );
}

// ── Queue panel — grid cards kiểu Quick Magic reference ──
function QueuePanel({ queue }) {
  // Auto tick mỗi giây khi có running job để duration + ETA update
  const [, force] = useState(0);
  useEffect(() => {
    const hasRunning = queue.some((q) => q.status === "running");
    if (!hasRunning) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [queue]);

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold"
            style={{ color: "var(--text-primary)" }}>
          Lịch sử ({queue.length})
        </h2>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {queue.map((it) => (
          <QueueCard key={it.projectId} item={it} />
        ))}
      </div>
    </div>
  );
}

function QueueCard({ item }) {
  const { cancelItem, removeItem } = useBatch();
  const toast = useToast();
  const isRunning = item.status === "running";
  const isDone = item.status === "done";
  const isErr = item.status === "error";
  const isPending = item.status === "pending";
  const isCanceled = item.status === "canceled";
  const canCancel = isRunning || isPending;

  const handleCancel = (e) => {
    e.stopPropagation();
    if (canCancel) {
      if (confirm(`Huỷ xử lí "${item.filename || item.projectId}"?`)) {
        cancelItem(item.projectId);
      }
    } else {
      removeItem(item.projectId);
    }
  };

  const handleOpen = () => {
    if (!isDone || !item.outputPath) return;
    if (window.voxstudio?.openFileInApp) {
      window.voxstudio.openFileInApp(item.outputPath).catch((e) => {
        showError(toast, e, { context: "open file" });
      });
    } else {
      toast.info(`File đã lưu tại: ${item.outputPath}`);
    }
  };

  const handleReveal = (e) => {
    e.stopPropagation();
    if (!item.outputPath) return;
    window.voxstudio?.revealFileInFolder?.(item.outputPath);
  };

  // ETA dựa trên progress + thời gian đã trôi
  const eta = (() => {
    if (!isRunning || !item.startedAt || !item.progress) return null;
    const elapsed = (Date.now() - item.startedAt) / 1000;
    const remain = (elapsed / item.progress) * (100 - item.progress);
    if (!isFinite(remain) || remain > 3600) return null;
    const m = Math.floor(remain / 60);
    const s = Math.floor(remain % 60);
    return m > 0 ? `${m}m` : `${s}s`;
  })();

  const relTime = (() => {
    const t = item.finishedAt || item.startedAt;
    if (!t) return "vừa thêm";
    const secs = Math.floor((Date.now() - t) / 1000);
    if (secs < 60) return `${secs}s trước`;
    const m = Math.floor(secs / 60);
    if (m < 60) return `${m} phút trước`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} giờ trước`;
    const d = Math.floor(h / 24);
    return `${d} ngày trước`;
  })();

  const badge =
    isRunning ? { text: "Đang chạy", color: "var(--accent)", bg: "rgba(108,92,231,0.85)" }
    : isDone ? { text: "Hoàn thành", color: "#22c55e", bg: "rgba(34,197,94,0.85)" }
    : isErr ? { text: "Lỗi", color: "#ef4444", bg: "rgba(239,68,68,0.85)" }
    : isCanceled ? { text: "Đã huỷ", color: "#9ca3af", bg: "rgba(127,127,160,0.85)" }
    : { text: "Chờ", color: "#9ca3af", bg: "rgba(127,127,160,0.85)" };

  return (
    <div
      onClick={handleOpen}
      className="rounded-lg overflow-hidden flex flex-col transition-all"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid rgba(127,127,160,0.15)",
        cursor: isDone && item.outputPath ? "pointer" : "default",
      }}
      title={isDone && item.outputPath ? `Click để mở ${item.outputPath}` : undefined}
    >
      {/* Thumbnail area */}
      <div
        className="relative"
        style={{
          aspectRatio: "16/9",
          background: "linear-gradient(135deg, rgba(30,30,50,0.8), rgba(10,10,25,0.95))",
        }}
      >
        <img
          src={thumbnailURL(item.projectId)}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
        {/* Icon fallback nếu thumbnail lỗi */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
             style={{ zIndex: 0 }}>
          <Film size={38} style={{ color: "rgba(255,255,255,0.15)" }} />
        </div>

        {/* Badge top-left */}
        <div
          className="absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-medium"
          style={{
            background: badge.bg,
            color: "#fff",
            backdropFilter: "blur(4px)",
          }}
        >
          {badge.text}
        </div>

        {/* Cancel / close button top-right */}
        <button
          onClick={handleCancel}
          title={canCancel ? "Huỷ xử lí" : "Xoá khỏi lịch sử"}
          className="absolute top-2 right-2 rounded-full flex items-center justify-center transition-all hover:scale-110"
          style={{
            width: 22, height: 22,
            background: canCancel ? "rgba(239,68,68,0.9)" : "rgba(0,0,0,0.6)",
            color: "#fff",
            backdropFilter: "blur(4px)",
            border: "none",
            cursor: "pointer",
          }}
        >
          <X size={12} />
        </button>

        {/* Progress overlay — thanh ngang dưới đáy thumbnail, fill trái→phải
            từ 0% lên theo progress. Nền xám mờ, fill xanh.              */}
        {(isRunning || isPending) && (
          <div
            className="absolute bottom-0 left-0 right-0"
            style={{
              background: "linear-gradient(transparent, rgba(0,0,0,0.72))",
              padding: "10px 12px 8px",
            }}
          >
            {item.step && (
              <p className="text-[10px] truncate mb-1.5"
                 style={{ color: "rgba(255,255,255,0.9)" }}>
                {item.step}
              </p>
            )}
            {/* Bar container — xám nhạt, bar fill xanh bên trong */}
            <div
              className="relative rounded overflow-hidden"
              style={{
                height: 20,
                background: "rgba(255,255,255,0.15)",
                border: "1px solid rgba(255,255,255,0.2)",
              }}
            >
              {/* Fill — chiều rộng = progress */}
              <div
                className="absolute left-0 top-0 bottom-0"
                style={{
                  width: `${Math.max(0, Math.min(100, item.progress || 0))}%`,
                  background: "linear-gradient(90deg, #16a34a, #22c55e)",
                  transition: "width 600ms linear",
                }}
              />
              {/* Text overlay — luôn hiện, đè lên fill */}
              <div className="absolute inset-0 flex items-center gap-1.5 px-2">
                {isRunning ? (
                  <Loader2 size={10} className="animate-spin" color="#fff" />
                ) : (
                  <Hourglass size={10} color="#fff" />
                )}
                <span className="text-[10px] font-semibold"
                      style={{ color: "#fff",
                               textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                  {Math.round(item.progress || 0)}%
                </span>
                {eta && isRunning && (
                  <span className="text-[10px]"
                        style={{ color: "rgba(255,255,255,0.9)",
                                 textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                    · ETA {eta}
                  </span>
                )}
                {!isRunning && (
                  <span className="text-[10px]"
                        style={{ color: "rgba(255,255,255,0.9)" }}>
                    · Đang chờ
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Error message overlay */}
        {isErr && item.error && (
          <div
            className="absolute bottom-0 left-0 right-0 px-3 py-1.5 text-[10px] truncate"
            style={{
              background: "rgba(239,68,68,0.9)",
              color: "#fff",
            }}
            title={item.error}
          >
            {item.error}
          </div>
        )}
      </div>

      {/* Meta — filename + time */}
      <div className="p-2.5">
        <p className="text-xs font-medium truncate"
           style={{ color: "var(--text-primary)" }}
           title={item.filename}>
          {item.filename}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-[10px] flex-1"
             style={{ color: "var(--text-secondary)" }}>
            {relTime}
          </p>
          {isDone && item.outputPath && (
            <button
              onClick={handleReveal}
              className="text-[10px] underline"
              style={{ color: "var(--accent)" }}
              title="Hiện trong thư mục"
            >
              Mở thư mục
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

