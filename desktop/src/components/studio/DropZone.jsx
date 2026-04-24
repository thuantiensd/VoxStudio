import { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Upload, FolderOpen, Settings, Check, Film } from "lucide-react";
import { useToast } from "../ui/Toast";
import { getActivePreset, setActivePreset, listPresets } from "../../services/preset";

/**
 * DropZone — drag-drop video + preset bar.
 *
 * UX: user drop video → auto xử lý ngay với preset đang active. Không bắt
 * chọn ngôn ngữ/giọng sau khi upload. Preset bar hiện nhỏ gọn trên dropzone
 * để user biết cấu hình sẽ áp dụng.
 */
const VIDEO_RE = /\.(mp4|mov|mkv|avi|webm)$/i;
const MAX_BATCH = 10;

export default function DropZone({ onFilesAccepted }) {
  const toast = useToast();
  const fileInputRef = useRef(null);
  const [over, setOver] = useState(false);
  const [preset, setPresetState] = useState(() => getActivePreset());
  const [pickerOpen, setPickerOpen] = useState(false);

  // Global drop listener — user kéo file từ Finder bất cứ đâu đều nhận.
  // Không cần đúng vị trí dropzone.
  useEffect(() => {
    const onDragOver = (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      setOver(true);
    };
    const onDragLeave = (e) => {
      if (e.relatedTarget === null) setOver(false);
    };
    const onDrop = (e) => {
      e.preventDefault();
      setOver(false);
      const files = Array.from(e.dataTransfer?.files || [])
        .filter((f) => VIDEO_RE.test(f.name));
      if (files.length) handleAccept(files);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [preset]);

  function handleAccept(files) {
    if (!files.length) {
      toast.warn("Chỉ nhận video (MP4, MOV, MKV, AVI, WEBM).");
      return;
    }
    const take = files.slice(0, MAX_BATCH);
    if (files.length > MAX_BATCH) {
      toast.warn(`Giới hạn ${MAX_BATCH} video/lần. Chỉ nhận ${MAX_BATCH} file đầu tiên.`);
    }
    onFilesAccepted?.(take, preset);
  }

  function onFileInput(e) {
    const files = Array.from(e.target.files || []).filter((f) => VIDEO_RE.test(f.name));
    handleAccept(files);
    e.target.value = "";
  }

  async function pickFolder() {
    if (!window.voxstudio?.pickFolder) {
      toast.warn("Quét thư mục chỉ khả dụng trong app desktop.");
      return;
    }
    const folder = await window.voxstudio.pickFolder();
    if (!folder) return;
    if (!window.voxstudio.listVideosInFolder) {
      toast.error("Ứng dụng chưa sẵn sàng.");
      return;
    }
    try {
      const list = await window.voxstudio.listVideosInFolder(folder);
      if (!list?.length) {
        toast.warn("Thư mục không có video hỗ trợ.");
        return;
      }
      // Convert {name, path, size} → File-like objects cho ProjectGrid
      // (sẽ đọc buffer qua IPC khi tạo project)
      const fileDescriptors = list.slice(0, MAX_BATCH).map((f) => ({
        name: f.name, path: f.path, size: f.size,
        isLocalPath: true,
      }));
      onFilesAccepted?.(fileDescriptors, preset);
    } catch {
      toast.error("Không đọc được thư mục.");
    }
  }

  function changePreset(newPreset) {
    setActivePreset(newPreset.id);
    setPresetState(newPreset);
    setPickerOpen(false);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="relative"
      style={{
        padding: 36,
        borderRadius: 16,
        background: over
          ? "linear-gradient(135deg, var(--accent-soft), rgba(139,92,246,0.12))"
          : "linear-gradient(135deg, rgba(94,106,210,0.08), rgba(139,92,246,0.04))",
        border: `2px dashed ${over ? "var(--accent)" : "var(--n-3)"}`,
        cursor: "pointer",
        transition: "all 0.15s ease",
      }}
      onClick={(e) => {
        // Không trigger khi click vào preset bar hoặc nút
        if (e.target.closest('[data-no-trigger]')) return;
        fileInputRef.current?.click();
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        multiple
        onChange={onFileInput}
        style={{ display: "none" }}
      />

      {/* Icon */}
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <motion.div
          animate={{ scale: over ? 1.1 : 1 }}
          transition={{ duration: 0.15 }}
          style={{
            width: 72, height: 72,
            margin: "0 auto",
            borderRadius: "50%",
            background: over ? "var(--accent)" : "var(--n-2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <Upload size={28} color={over ? "#fff" : "var(--n-8)"} />
        </motion.div>
      </div>

      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: "var(--n-10)",
                       marginBottom: 6, letterSpacing: "-0.01em" }}>
          {over ? "Thả vào đây" : "Thả video vào đây"}
        </div>
        <div style={{ fontSize: 13, color: "var(--n-8)" }}>
          hoặc click để chọn file · tối đa {MAX_BATCH} video
        </div>
        <div style={{ fontSize: 11, color: "var(--n-7)", marginTop: 4 }}>
          MP4 · MOV · MKV · AVI · WEBM
        </div>
      </div>

      {/* Action buttons row */}
      <div
        data-no-trigger
        style={{
          display: "flex", justifyContent: "center", gap: 8,
          marginTop: 18,
        }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
          style={actionBtn}
        >
          <Film size={13} /> Chọn file
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); pickFolder(); }}
          style={{ ...actionBtn, background: "transparent",
                    border: "1px solid var(--n-3)" }}
        >
          <FolderOpen size={13} /> Quét thư mục
        </button>
      </div>

      {/* Preset bar — hiện preset active, click đổi */}
      <div
        data-no-trigger
        style={{
          marginTop: 22,
          display: "flex", alignItems: "center", justifyContent: "center",
          gap: 10, fontSize: 12.5,
          color: "var(--n-8)",
        }}
      >
        <span>⚡ Cấu hình sẽ áp dụng:</span>
        <div style={{ position: "relative" }}>
          <button
            onClick={(e) => { e.stopPropagation(); setPickerOpen((v) => !v); }}
            style={{
              padding: "6px 12px", borderRadius: 8,
              background: "var(--n-1)", border: "1px solid var(--n-3)",
              color: "var(--n-10)", fontWeight: 600, fontSize: 12.5,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {preset.label}
            <Settings size={11} style={{ color: "var(--n-7)" }} />
          </button>

          <AnimatePresence>
            {pickerOpen && (
              <>
                <div
                  data-no-trigger
                  onClick={(e) => { e.stopPropagation(); setPickerOpen(false); }}
                  style={{ position: "fixed", inset: 0, zIndex: 40 }}
                />
                <motion.div
                  data-no-trigger
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  style={{
                    position: "absolute", top: "100%", right: 0,
                    marginTop: 6, minWidth: 280, zIndex: 50,
                    background: "var(--n-1)",
                    border: "1px solid var(--n-3)",
                    borderRadius: 10,
                    boxShadow: "var(--shadow-pop)",
                    padding: 6,
                  }}
                >
                  {listPresets().map((p) => (
                    <button
                      key={p.id}
                      data-no-trigger
                      onClick={(e) => { e.stopPropagation(); changePreset(p); }}
                      style={{
                        width: "100%", textAlign: "left",
                        padding: "10px 12px", borderRadius: 6,
                        background: p.id === preset.id ? "var(--accent-soft)" : "transparent",
                        border: "none", cursor: "pointer",
                        display: "flex", alignItems: "flex-start", gap: 8,
                      }}
                      onMouseEnter={(e) => {
                        if (p.id !== preset.id)
                          e.currentTarget.style.background = "var(--n-2)";
                      }}
                      onMouseLeave={(e) => {
                        if (p.id !== preset.id)
                          e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <div style={{ flexShrink: 0, width: 16, marginTop: 2 }}>
                        {p.id === preset.id && <Check size={13} color="var(--accent)" />}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--n-10)" }}>
                          {p.label}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--n-7)", marginTop: 2 }}>
                          {p.description}
                        </div>
                      </div>
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

const actionBtn = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "7px 14px", borderRadius: 8,
  background: "var(--accent)",
  color: "#fff",
  border: "none", fontSize: 12.5, fontWeight: 500,
  cursor: "pointer",
};
