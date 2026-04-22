import { useEffect, useState } from "react";
import { FolderOpen, Save, FileVideo } from "lucide-react";
import Modal from "./Modal";
import Button from "./Button";
import { useT } from "../../i18n/I18nContext";

/**
 * SaveAsModal — dialog đặt tên file + chọn folder trước khi lưu.
 *
 * Props:
 *   open: bool
 *   onClose()
 *   defaultName: string (không ext)
 *   defaultFolder: string | null
 *   ext: string (".mp4" default)
 *   onSave({ folder, filename, overwrite }) — async, resolve khi done
 *
 * Tính năng:
 * - Pick folder bằng window.voxstudio.pickFolder
 * - Preview tên unique thực tế (getUniqueFilename) — update live khi đổi
 * - Toggle "Ghi đè nếu trùng"
 */
export default function SaveAsModal({
  open, onClose,
  defaultName = "video", defaultFolder = null, ext = ".mp4",
  onSave,
}) {
  const t = useT();
  const [folder, setFolder] = useState(defaultFolder || "");
  const [name, setName] = useState(defaultName);
  const [overwrite, setOverwrite] = useState(false);
  const [resolvedPath, setResolvedPath] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setFolder(defaultFolder || "");
      setOverwrite(false);
      setSaving(false);
    }
  }, [open, defaultName, defaultFolder]);

  // Live preview tên thực (auto-increment nếu trùng)
  useEffect(() => {
    if (!open || !folder || !name) {
      setResolvedPath("");
      return;
    }
    const filename = cleanName(name) + ext;
    if (overwrite) {
      setResolvedPath(`${folder}/${filename}`);
      return;
    }
    let cancelled = false;
    window.voxstudio?.getUniqueFilename?.({ folder, filename })
      .then((p) => { if (!cancelled) setResolvedPath(p); })
      .catch(() => { if (!cancelled) setResolvedPath(""); });
    return () => { cancelled = true; };
  }, [folder, name, ext, overwrite, open]);

  const pickFolder = async () => {
    const f = await window.voxstudio?.pickFolder?.();
    if (f) setFolder(f);
  };

  const canSave = !!folder && !!name.trim() && !saving;
  const willCollide = resolvedPath && !overwrite
    && !resolvedPath.endsWith(cleanName(name) + ext);

  const doSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({
        folder,
        filename: cleanName(name) + ext,
        overwrite,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("save.title") || "Lưu file"}
      width={520}
      actions={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary" size="md" icon={Save}
            onClick={doSave} loading={saving} disabled={!canSave}
          >
            {saving ? t("common.saving") : (t("save.action") || "Lưu")}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Folder picker */}
        <div>
          <label style={fieldLabel}>
            {t("save.folder") || "Thư mục lưu"}
          </label>
          <div
            style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "var(--n-0)",
              border: `1px solid ${folder ? "var(--n-3)" : "var(--err)"}`,
              borderRadius: 6, padding: "6px 8px 6px 10px",
            }}
          >
            <FolderOpen size={14} style={{ color: "var(--n-8)", flexShrink: 0 }} />
            <div
              title={folder || "—"}
              className="font-mono"
              style={{
                flex: 1, minWidth: 0, fontSize: 11,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                color: folder ? "var(--n-9)" : "var(--n-6)",
              }}
            >
              {folder || "(chưa chọn)"}
            </div>
            <Button size="sm" variant="secondary" onClick={pickFolder}>
              {folder ? "Đổi" : "Chọn"}
            </Button>
          </div>
        </div>

        {/* Name input */}
        <div>
          <label style={fieldLabel}>
            {t("save.filename") || "Tên file"}
          </label>
          <div
            style={{
              display: "flex", alignItems: "center",
              background: "var(--n-0)",
              border: "1px solid var(--n-3)",
              borderRadius: 6,
            }}
          >
            <FileVideo size={14} style={{ color: "var(--n-8)", margin: "0 8px" }} />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
              autoFocus
              style={{
                flex: 1, padding: "8px 4px",
                background: "transparent", border: "none", outline: "none",
                fontSize: 13, color: "var(--n-10)",
              }}
            />
            <span
              style={{
                color: "var(--n-6)", fontFamily: "var(--font-mono)",
                fontSize: 12, padding: "0 10px",
              }}
            >
              {ext}
            </span>
          </div>
        </div>

        {/* Preview + overwrite */}
        {resolvedPath && (
          <div
            style={{
              padding: 10, borderRadius: 6,
              background: willCollide ? "rgba(210,153,34,0.08)" : "var(--n-2)",
              border: `1px solid ${willCollide ? "rgba(210,153,34,0.3)" : "var(--n-3)"}`,
              fontSize: 11, color: "var(--n-8)",
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                          letterSpacing: "0.05em", color: "var(--n-6)", marginBottom: 4 }}>
              {willCollide
                ? "Trùng tên → sẽ lưu thành"
                : "Sẽ lưu tại"}
            </div>
            <div
              title={resolvedPath}
              className="font-mono"
              style={{
                fontSize: 11, color: "var(--n-10)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {resolvedPath}
            </div>
          </div>
        )}

        <label
          className="flex items-center gap-2"
          style={{ fontSize: 12, color: "var(--n-8)", cursor: "pointer" }}
        >
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
            style={{ accentColor: "var(--accent)" }}
          />
          <span>{t("save.overwrite") || "Ghi đè nếu trùng tên"}</span>
        </label>
      </div>
    </Modal>
  );
}

const fieldLabel = {
  display: "block",
  fontSize: 11, fontWeight: 500,
  color: "var(--n-8)",
  marginBottom: 6,
};

// Strip disallowed chars + trim whitespace
export function cleanName(name) {
  return (name || "")
    .replace(/[/\\?%*:|"<>]/g, "_")
    .trim()
    .slice(0, 120) || "video";
}
