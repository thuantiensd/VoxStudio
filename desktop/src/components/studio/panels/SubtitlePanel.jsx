import { useState } from "react";
import { Subtitles, Scissors, Loader2 } from "lucide-react";
import SubtitleEditor from "../../dubbing/SubtitleEditor";
import { Section } from "./LanguageVoicePanel";
import { useT } from "../../../i18n/I18nContext";
import {
  splitSegment, updateSegment, getDubbingProject,
} from "../../../services/api";

const DEFAULT_STYLE = {
  font_family: "Arial", font_size: 24, font_color: "#FFFFFF",
  font_bold: false, font_italic: false,
  bg_color: "#000000", bg_opacity: 0.6,
  outline_color: "#000000", outline_width: 2, shadow_offset: 0,
  position: "bottom", margin_v: 30,
};

/**
 * SubtitlePanel — toggle phụ đề + editor style. Mọi thay đổi style
 * gửi qua onUpdateStyle và cập nhật live SubtitleOverlay trên video.
 */
export default function SubtitlePanel({
  project, onToggle, onUpdateStyle, onProjectUpdated,
}) {
  const t = useT();
  const [splitting, setSplitting] = useState(false);
  const [splitMsg, setSplitMsg] = useState(null);
  const enabled = project.enable_subtitle ?? true;
  const style = project.subtitle_style || DEFAULT_STYLE;

  // Tách các segment dài thành các sub-segment theo câu, đồng bộ backend
  // để export dùng cấu trúc mới — preview khớp export.
  const handleAutoSplit = async () => {
    if (!project?.id || splitting) return;
    setSplitting(true);
    setSplitMsg(null);
    try {
      let p = await getDubbingProject(project.id);
      const originals = [...(p.segments || [])];
      let splitCount = 0;

      for (const seg of originals) {
        const text = (seg.translated_text || "").trim();
        if (!text) continue;
        const chunks = chunkSentences(text);
        if (chunks.length <= 1) continue;

        const total = chunks.reduce((s, c) => s + c.length, 0);
        const dur = Math.max(0.1, seg.end - seg.start);
        let elapsedChars = 0;
        let currentSegId = seg.id;

        for (let i = 0; i < chunks.length - 1; i++) {
          elapsedChars += chunks[i].length;
          const splitT = seg.start + (elapsedChars / total) * dur;
          try {
            p = await splitSegment(p.id, currentSegId, splitT);
            splitCount++;
            // Sau split: left giữ id cũ, right là segment mới tại splitT.
            // Cập nhật text 2 nửa cho đúng.
            const left = p.segments.find((s) => s.id === currentSegId);
            const right = p.segments.find(
              (s) => Math.abs(s.start - splitT) < 0.15 && s.id !== currentSegId
            );
            if (left) {
              await updateSegment(p.id, left.id, { translated_text: chunks[i] });
            }
            if (right) {
              currentSegId = right.id;
              // Cập nhật text còn lại của right (nối các chunks sau)
              const restText = chunks.slice(i + 1).join(" ");
              await updateSegment(p.id, right.id, { translated_text: restText });
            }
          } catch (e) {
            console.warn("splitSegment failed:", e);
            break;
          }
        }
      }

      p = await getDubbingProject(project.id);
      onProjectUpdated?.(p);
      setSplitMsg(
        splitCount > 0
          ? `Đã tách ${splitCount} vị trí thành câu riêng.`
          : "Không có segment nào cần tách."
      );
    } catch (e) {
      setSplitMsg("Lỗi: " + e.message);
    }
    setSplitting(false);
    setTimeout(() => setSplitMsg(null), 4000);
  };

  return (
    <Section icon={<Subtitles size={13} />} title={t("studio.panels.subtitle")}>
      {/* Toggle row */}
      <label
        className="flex items-center justify-between cursor-pointer select-none"
        style={{ color: "var(--text-primary)" }}
      >
        <span className="text-sm">{t("studio.panels.subtitleEnable")}</span>
        <Switch checked={enabled} onChange={onToggle} />
      </label>

      {enabled && (
        <div className="mt-2 -mx-3 -mb-3"
             style={{ borderTop: "1px solid rgba(127,127,160,0.12)" }}>
          <div className="p-3">
            <p className="text-[11px] mb-2"
               style={{ color: "var(--text-secondary)" }}>
              {t("studio.panels.subtitleHint")}
            </p>
            {/* Reuse SubtitleEditor. Wrapper trong SubtitleEditor đã có card
                riêng, nên mình cho expanded-only bằng cách bỏ nút collapse. */}
            <SubtitleEditor style={style} onChange={onUpdateStyle} />

            {/* Tách câu tự động — đồng bộ backend để export khớp preview */}
            {(project.segments || []).some(
              (s) => s.translated_text?.trim()
            ) && (
              <div className="mt-3 pt-3"
                   style={{ borderTop: "1px solid rgba(127,127,160,0.12)" }}>
                <button
                  onClick={handleAutoSplit}
                  disabled={splitting}
                  className="w-full flex items-center justify-center gap-2 rounded-md py-2 text-xs font-medium transition-all disabled:opacity-60"
                  style={{
                    background: "rgba(108,92,231,0.15)",
                    border: "1px solid rgba(108,92,231,0.4)",
                    color: "var(--accent)",
                  }}
                >
                  {splitting ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Scissors size={12} />
                  )}
                  {splitting ? "Đang tách…" : "Tách câu tự động"}
                </button>
                <p className="text-[11px] mt-1.5"
                   style={{ color: "var(--text-secondary)" }}>
                  Tách các segment dài thành từng câu riêng để export khớp với
                  preview.
                </p>
                {splitMsg && (
                  <p className="text-[11px] mt-1.5"
                     style={{ color: "var(--accent)" }}>
                    {splitMsg}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

// Sao chép logic chia câu như SubtitleOverlay.pickSentenceAtTime để
// backend-sync nhất quán với preview.
function chunkSentences(text) {
  const CHUNK_CHAR_LIMIT = 45;
  const WORDS_PER_CHUNK = 7;
  let chunks = text
    .split(/(?<=[.!?。！？…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  chunks = chunks.flatMap((s) =>
    s.length > CHUNK_CHAR_LIMIT
      ? s.split(/(?<=[,;:—–])\s+/).map((x) => x.trim()).filter(Boolean)
      : [s]
  );
  chunks = chunks.flatMap((s) => {
    if (s.length <= CHUNK_CHAR_LIMIT) return [s];
    const hasSpaces = /\s/.test(s);
    if (hasSpaces) {
      const words = s.split(/\s+/);
      const out = [];
      for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
        out.push(words.slice(i, i + WORDS_PER_CHUNK).join(" "));
      }
      return out;
    }
    const CHAR_CHUNK = 20;
    const out = [];
    for (let i = 0; i < s.length; i += CHAR_CHUNK) {
      out.push(s.slice(i, i + CHAR_CHUNK));
    }
    return out;
  });
  return chunks;
}

function Switch({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="relative rounded-full transition-colors"
      style={{
        width: 32, height: 18,
        background: checked ? "var(--accent)" : "rgba(127,127,160,0.3)",
      }}
    >
      <span
        className="absolute top-0.5 rounded-full bg-white transition-all"
        style={{
          width: 14, height: 14,
          left: checked ? 16 : 2,
        }}
      />
    </button>
  );
}
