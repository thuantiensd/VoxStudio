import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Play, Pause, RefreshCcw, Check, Loader2, AlertTriangle,
  Edit2, Save, X, Volume2,
} from "lucide-react";
import { updateSegment, generateSegment, segmentAudioURL } from "../../services/api";
import { useToast } from "../ui/Toast";
import { showError } from "../../services/errors";

/**
 * SegmentEditor — chuyên nghiệp, chuyên biệt cho pro user edit phụ đề/giọng
 * từng câu. Hiển thị dạng list scroll, click row = seek video, nút nghe +
 * sửa text + tạo lại giọng riêng từng câu.
 *
 * Props:
 *   project — { id, segments, ... }
 *   currentTime — thời gian video hiện tại (giây), để highlight segment
 *                  đang phát
 *   onSeek — function(seconds) seek video tới vị trí
 *   onUpdateSegment — callback sau khi sửa 1 segment, để parent refresh
 */
export default function SegmentEditor({ project, currentTime, onSeek, onSegmentChange }) {
  const segments = project?.segments || [];

  if (!segments.length) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--n-7)" }}>
        <div style={{ fontSize: 14, marginBottom: 6 }}>Chưa có phụ đề</div>
        <div style={{ fontSize: 12, color: "var(--n-7)" }}>
          Chạy pipeline lồng tiếng để tạo phụ đề từ video.
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100%", minHeight: 0,
    }}>
      <Header count={segments.length} />
      <div style={{
        flex: 1, minHeight: 0, overflowY: "auto",
        padding: "4px 8px 16px",
      }}>
        {segments.map((seg, idx) => (
          <SegmentRow
            key={seg.id}
            segment={seg}
            index={idx}
            projectId={project.id}
            active={
              currentTime != null &&
              currentTime >= (seg.start ?? 0) &&
              currentTime < (seg.end ?? 0)
            }
            onSeek={onSeek}
            onChange={onSegmentChange}
          />
        ))}
      </div>
    </div>
  );
}

function Header({ count }) {
  return (
    <div
      style={{
        flexShrink: 0,
        padding: "10px 16px",
        borderBottom: "1px solid var(--n-3)",
        display: "flex", alignItems: "center", gap: 10,
      }}
    >
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
        textTransform: "uppercase", color: "var(--n-7)",
      }}>
        Phụ đề · {count} câu
      </div>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 10.5, color: "var(--n-7)" }}>
        Click câu để phát · Sửa text để chỉnh bản dịch
      </span>
    </div>
  );
}


function SegmentRow({ segment, index, projectId, active, onSeek, onChange }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(
    segment.translated_text || segment.text || "",
  );
  const [saving, setSaving] = useState(false);
  const [regen, setRegen] = useState(false);
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const rowRef = useRef(null);

  useEffect(() => {
    setText(segment.translated_text || segment.text || "");
  }, [segment.translated_text, segment.text]);

  // Scroll row active vào view khi video phát tới
  useEffect(() => {
    if (active && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [active]);

  const hasVoice = segment.status === "done" || segment.status === "ready";
  const isGenerating = segment.status === "generating" || regen;
  const isError = segment.status === "error";

  async function saveText() {
    if (text === (segment.translated_text || segment.text)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await updateSegment(projectId, segment.id, {
        translated_text: text,
      });
      onChange?.(res.segment || { ...segment, translated_text: text });
      setEditing(false);
    } catch (e) {
      showError(toast, e, { context: "save segment" });
    } finally {
      setSaving(false);
    }
  }

  async function regenerate() {
    setRegen(true);
    try {
      const res = await generateSegment(projectId, segment.id);
      onChange?.(res.segment || { ...segment, status: "done" });
      toast.success("Đã tạo lại giọng cho câu này");
    } catch (e) {
      showError(toast, e, { context: "regenerate segment" });
    } finally {
      setRegen(false);
    }
  }

  async function toggleAudio() {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    const a = audioRef.current;
    if (!a) return;
    try {
      await a.play();
      setPlaying(true);
    } catch {}
  }

  return (
    <motion.div
      ref={rowRef}
      layout
      style={{
        display: "flex", gap: 10,
        padding: "10px 10px",
        marginBottom: 6,
        borderRadius: 8,
        background: active ? "var(--accent-soft)" : "transparent",
        border: active
          ? "1px solid var(--accent)"
          : "1px solid transparent",
        transition: "background 0.1s, border-color 0.1s",
        cursor: "pointer",
      }}
      onClick={(e) => {
        if (e.target.closest("[data-no-seek]")) return;
        onSeek?.(segment.start);
      }}
    >
      {/* Index + time column */}
      <div
        data-no-seek
        style={{
          flexShrink: 0, width: 58,
          display: "flex", flexDirection: "column",
          alignItems: "center", gap: 4,
          paddingTop: 2,
        }}
      >
        <div style={{
          fontSize: 10, fontWeight: 700, color: "var(--n-7)",
          letterSpacing: "0.04em",
        }}>
          #{String(index + 1).padStart(2, "0")}
        </div>
        <div style={{
          fontSize: 9.5, color: active ? "var(--accent)" : "var(--n-7)",
          fontFamily: "var(--font-mono, monospace)", lineHeight: 1.4,
          textAlign: "center",
        }}>
          {fmtTime(segment.start)}<br />
          <span style={{ opacity: 0.5 }}>↓</span><br />
          {fmtTime(segment.end)}
        </div>
        <StatusDot status={segment.status} isGenerating={isGenerating}
                    hasVoice={hasVoice} isError={isError} />
      </div>

      {/* Content column */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {segment.original_text && segment.original_text !== text && (
          <div style={{
            fontSize: 11, color: "var(--n-7)",
            marginBottom: 4, fontStyle: "italic",
          }}>
            {segment.original_text}
          </div>
        )}
        {editing ? (
          <div data-no-seek>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
              rows={2}
              style={{
                width: "100%", padding: 8, borderRadius: 6,
                background: "var(--n-0)", border: "1px solid var(--accent)",
                color: "var(--n-10)", fontSize: 13, lineHeight: 1.5,
                resize: "vertical", outline: "none",
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setEditing(false); setText(segment.translated_text || ""); }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveText();
              }}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button
                onClick={saveText} disabled={saving}
                style={primaryBtn}
              >
                {saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                Lưu
              </button>
              <button
                onClick={() => { setEditing(false); setText(segment.translated_text || ""); }}
                style={ghostBtn}
              >
                <X size={10} /> Huỷ
              </button>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 10, color: "var(--n-7)" }}>
                ⌘Enter để lưu · Esc để huỷ
              </span>
            </div>
          </div>
        ) : (
          <div
            style={{
              fontSize: 13, color: "var(--n-10)", lineHeight: 1.5,
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}
          >
            {text || <span style={{ color: "var(--n-7)", fontStyle: "italic" }}>(trống)</span>}
          </div>
        )}
      </div>

      {/* Actions column */}
      {!editing && (
        <div
          data-no-seek
          style={{
            flexShrink: 0,
            display: "flex", gap: 3,
            alignSelf: "flex-start",
            paddingTop: 2,
          }}
        >
          {hasVoice && (
            <IconButton
              icon={playing ? Pause : Volume2}
              onClick={toggleAudio}
              title={playing ? "Dừng" : "Nghe giọng"}
            />
          )}
          <IconButton
            icon={Edit2}
            onClick={() => setEditing(true)}
            title="Sửa bản dịch"
          />
          <IconButton
            icon={RefreshCcw}
            onClick={regenerate}
            disabled={isGenerating}
            title="Tạo lại giọng"
            spin={isGenerating}
          />
          <audio
            ref={audioRef}
            src={segmentAudioURL(projectId, segment.id)}
            onEnded={() => setPlaying(false)}
            style={{ display: "none" }}
          />
        </div>
      )}
    </motion.div>
  );
}


function StatusDot({ status, isGenerating, hasVoice, isError }) {
  let color = "var(--n-6)", title = "Chờ";
  if (isError) { color = "var(--err)"; title = "Lỗi"; }
  else if (isGenerating) { color = "var(--accent)"; title = "Đang tạo giọng"; }
  else if (hasVoice) { color = "#22c55e"; title = "Đã có giọng"; }
  return (
    <div
      style={{
        width: 8, height: 8, borderRadius: "50%",
        background: color,
        animation: isGenerating ? "pulse 1.5s ease-in-out infinite" : undefined,
      }}
      title={title}
    />
  );
}


function IconButton({ icon: Icon, onClick, title, disabled, spin }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      disabled={disabled}
      title={title}
      style={{
        width: 26, height: 26,
        borderRadius: 5,
        background: "transparent", border: "none",
        color: disabled ? "var(--n-6)" : "var(--n-8)",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = "var(--n-2)";
          e.currentTarget.style.color = "var(--n-10)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = disabled ? "var(--n-6)" : "var(--n-8)";
      }}
    >
      <Icon size={12} className={spin ? "animate-spin" : ""} />
    </button>
  );
}


function fmtTime(s) {
  const sec = Math.max(0, Math.round(s || 0));
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

const primaryBtn = {
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "4px 10px", borderRadius: 5,
  background: "var(--accent)", color: "#fff",
  border: "none", fontSize: 11, fontWeight: 500,
  cursor: "pointer",
};
const ghostBtn = {
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "4px 10px", borderRadius: 5,
  background: "transparent", color: "var(--n-8)",
  border: "1px solid var(--n-3)", fontSize: 11,
  cursor: "pointer",
};
