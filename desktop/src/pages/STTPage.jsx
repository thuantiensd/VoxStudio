import { useCallback, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  FileAudio, FileVideo, FolderOpen, UploadCloud, Play, X,
  Loader2, Check, AlertTriangle, FileText, Trash2,
  Folder, Languages,
} from "lucide-react";
import PageHeader, { Page, PageContent } from "../components/ui/PageHeader";
import Button from "../components/ui/Button";
import { useToast } from "../components/ui/Toast";
import { transcribe, translateTexts } from "../services/api";
import { showError } from "../services/errors";
import { getKey } from "../services/keyvault";

/* ─────────────────────────────────────────────────────────
   Speech-to-Text page
   • Drag & drop / click / folder batch
   • Language hint (auto + 20+ whisper codes)
   • Export formats: SRT · VTT · TXT · JSON · CSV (multi-select)
   • Output folder (Electron). Web fallback: download file qua browser.
   • Sequential pipeline — 1 job chạy 1 lúc (Whisper GPU-bound).
   ───────────────────────────────────────────────────────── */

const MEDIA_EXTS = [
  "mp3", "wav", "m4a", "flac", "ogg", "aac", "opus", "wma",
  "mp4", "mov", "mkv", "avi", "webm",
];
const MEDIA_RE = new RegExp(`\\.(${MEDIA_EXTS.join("|")})$`, "i");

const LANGUAGES = [
  { code: "auto", label: "Tự động nhận diện" },
  { code: "vi",   label: "Tiếng Việt" },
  { code: "en",   label: "English" },
  { code: "zh",   label: "中文 (Chinese)" },
  { code: "ja",   label: "日本語 (Japanese)" },
  { code: "ko",   label: "한국어 (Korean)" },
  { code: "fr",   label: "Français" },
  { code: "es",   label: "Español" },
  { code: "de",   label: "Deutsch" },
  { code: "pt",   label: "Português" },
  { code: "ru",   label: "Русский" },
  { code: "th",   label: "ไทย" },
  { code: "id",   label: "Bahasa Indonesia" },
  { code: "ms",   label: "Bahasa Melayu" },
  { code: "tr",   label: "Türkçe" },
  { code: "it",   label: "Italiano" },
  { code: "nl",   label: "Nederlands" },
  { code: "pl",   label: "Polski" },
  { code: "ar",   label: "العربية" },
  { code: "hi",   label: "हिन्दी" },
  { code: "uk",   label: "Українська" },
];

const FORMATS = [
  { key: "srt",  ext: "srt",  label: "SRT",  hint: "Subtitle chuẩn cho player" },
  { key: "vtt",  ext: "vtt",  label: "VTT",  hint: "WebVTT cho <video> HTML5" },
  { key: "txt",  ext: "txt",  label: "TXT",  hint: "Văn bản thuần" },
  { key: "json", ext: "json", label: "JSON", hint: "Segments + timestamps raw" },
  { key: "csv",  ext: "csv",  label: "CSV",  hint: "Bảng tính: start,end,text" },
];

const LS_LANG   = "voxstudio:stt:language";
const LS_FMTS   = "voxstudio:stt:formats";
const LS_FOLDER = "voxstudio:stt:outputFolder";
const LS_TR_ON  = "voxstudio:stt:translateOn";
const LS_TR_TGT = "voxstudio:stt:translateTarget";
const LS_TR_ENG = "voxstudio:stt:translateEngine";

const TRANSLATE_ENGINES = [
  { id: "google_free",  label: "Google (miễn phí)",   needsKey: false },
  { id: "google_cloud", label: "Google Cloud",         needsKey: true  },
  { id: "deepl",        label: "DeepL",                needsKey: true  },
  { id: "gemini",       label: "Gemini",               needsKey: true  },
  { id: "openai",       label: "OpenAI (GPT)",         needsKey: true  },
  { id: "claude",       label: "Claude",               needsKey: true  },
];

/* ─── Format serializers ──────────────────────────────── */

function padTime(sec, sep = ",") {
  const s = Math.max(0, sec || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}${sep}${String(ms).padStart(3, "0")}`;
}

function toSRT(segments) {
  return segments.map((seg, i) =>
    `${i + 1}\n${padTime(seg.start, ",")} --> ${padTime(seg.end, ",")}\n${(seg.text || "").trim()}\n`
  ).join("\n");
}
function toVTT(segments) {
  const body = segments.map((seg) =>
    `${padTime(seg.start, ".")} --> ${padTime(seg.end, ".")}\n${(seg.text || "").trim()}\n`
  ).join("\n");
  return `WEBVTT\n\n${body}`;
}
function toTXT(segments) {
  return segments.map((s) => (s.text || "").trim()).filter(Boolean).join("\n");
}
function toJSON(segments, meta) {
  return JSON.stringify({ ...meta, segments }, null, 2);
}
function toCSV(segments) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = "start,end,text";
  const rows = segments.map((s) =>
    [s.start ?? 0, s.end ?? 0, esc((s.text || "").trim())].join(","),
  );
  return [head, ...rows].join("\n");
}

const SERIALIZERS = { srt: toSRT, vtt: toVTT, txt: toTXT,
                       json: (segs, meta) => toJSON(segs, meta), csv: toCSV };

function stripExt(name) { return name.replace(/\.[^.]+$/, ""); }

const selectStyle = {
  width: "100%", height: 32,
  background: "var(--n-1)", color: "var(--n-10)",
  border: "1px solid var(--n-3)", borderRadius: 6,
  padding: "0 8px", fontSize: 13,
};

/* ─── File reading helpers ────────────────────────────── */

async function pathToFile(filepath) {
  // Electron: read path → Uint8Array → wrap as File (keeps original name).
  const name = filepath.split(/[\\/]/).pop();
  const buf = await window.voxstudio.readFileAsBuffer(filepath);
  // main returns a Buffer (Uint8Array-compatible) via IPC serialization
  return new File([buf], name);
}

function browserDownload(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ─── Main component ──────────────────────────────────── */

export default function STTPage() {
  const toast = useToast();
  const isElectron = !!window.voxstudio?.isElectron;
  const fileInputRef = useRef(null);

  const [items, setItems] = useState([]); // {id, name, path?, file?, size, status, progress?, error?, segments?, lang?}
  const [running, setRunning] = useState(false);
  const abortRef = useRef(false);

  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem(LS_LANG) || "auto"; }
    catch { return "auto"; }
  });
  const setLangPersist = (v) => {
    setLang(v);
    try { localStorage.setItem(LS_LANG, v); } catch {}
  };

  const [formats, setFormats] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_FMTS);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) return arr;
      }
    } catch {}
    return ["srt", "txt"];
  });
  const toggleFormat = (k) => {
    setFormats((prev) => {
      const next = prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k];
      const final = next.length ? next : [k];
      try { localStorage.setItem(LS_FMTS, JSON.stringify(final)); } catch {}
      return final;
    });
  };

  const [trOn, setTrOn] = useState(() => {
    try { return localStorage.getItem(LS_TR_ON) === "1"; }
    catch { return false; }
  });
  const setTrOnPersist = (v) => {
    setTrOn(v);
    try { localStorage.setItem(LS_TR_ON, v ? "1" : "0"); } catch {}
  };
  const [trTarget, setTrTarget] = useState(() => {
    try { return localStorage.getItem(LS_TR_TGT) || "vi"; }
    catch { return "vi"; }
  });
  const setTrTargetPersist = (v) => {
    setTrTarget(v);
    try { localStorage.setItem(LS_TR_TGT, v); } catch {}
  };
  const [trEngine, setTrEngine] = useState(() => {
    try { return localStorage.getItem(LS_TR_ENG) || "google_free"; }
    catch { return "google_free"; }
  });
  const setTrEnginePersist = (v) => {
    setTrEngine(v);
    try { localStorage.setItem(LS_TR_ENG, v); } catch {}
  };

  const [outputFolder, setOutputFolder] = useState(() => {
    try { return localStorage.getItem(LS_FOLDER) || ""; }
    catch { return ""; }
  });
  const setOutputFolderPersist = (v) => {
    setOutputFolder(v);
    try {
      if (v) localStorage.setItem(LS_FOLDER, v);
      else localStorage.removeItem(LS_FOLDER);
    } catch {}
  };

  const pickFolder = async () => {
    if (!isElectron) {
      toast?.show({
        title: "Chế độ web",
        message: "Chọn thư mục chỉ có trong app desktop. Kết quả sẽ tải về qua trình duyệt.",
        kind: "info",
      });
      return;
    }
    const folder = await window.voxstudio.pickFolder();
    if (folder) setOutputFolderPersist(folder);
  };

  /* ── Add files from drag / picker / folder ── */
  const addFiles = useCallback((arr) => {
    setItems((prev) => {
      const existing = new Set(prev.map((x) => x.path || x.name + "_" + x.size));
      const next = [...prev];
      for (const it of arr) {
        const key = it.path || it.name + "_" + it.size;
        if (existing.has(key)) continue;
        existing.add(key);
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: it.name, size: it.size || 0,
          path: it.path || null, file: it.file || null,
          status: "pending",
        });
      }
      return next;
    });
  }, []);

  const pickFiles = () => {
    // HTML input handles multi-select in both web and Electron renderer.
    fileInputRef.current?.click();
  };

  const pickFolderForBatch = async () => {
    if (!isElectron) {
      toast?.show({
        title: "Không khả dụng",
        message: "Quét thư mục chỉ có trong app desktop.",
        kind: "warn",
      });
      return;
    }
    const folder = await window.voxstudio.pickFolder();
    if (!folder) return;
    const list = await window.voxstudio.listMediaInFolder(folder);
    if (!list?.length) {
      toast?.show({ title: "Không có media", message: "Thư mục không chứa audio/video hỗ trợ.", kind: "warn" });
      return;
    }
    addFiles(list.map((f) => ({ name: f.name, path: f.path, size: f.size })));
    toast?.show({ title: "Đã thêm", message: `${list.length} file từ ${folder}`, kind: "ok" });
  };

  const onDrop = (e) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files || []);
    const filtered = dropped.filter((f) => MEDIA_RE.test(f.name));
    if (!filtered.length) {
      toast?.show({ title: "File không hỗ trợ", message: "Chỉ nhận audio/video.", kind: "warn" });
      return;
    }
    addFiles(filtered.map((f) => ({
      name: f.name, size: f.size, file: f, path: f.path || null,
    })));
  };

  const onFileInput = (e) => {
    const list = Array.from(e.target.files || []);
    if (!list.length) return;
    addFiles(list.map((f) => ({
      name: f.name, size: f.size, file: f, path: f.path || null,
    })));
    e.target.value = "";
  };

  const removeItem = (id) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  };
  const clearAll = () => {
    if (running) return;
    setItems([]);
  };
  const clearDone = () => {
    setItems((prev) => prev.filter((x) => x.status !== "done"));
  };

  /* ── Export results for one item ── */
  async function exportResult(item) {
    const { name, segments, lang: detected, translated } = item;
    const base = stripExt(name);
    const meta = { file: name, language: detected || null,
                   count: segments?.length || 0,
                   created_at: new Date().toISOString() };

    const writeOne = async (outName, content) => {
      if (isElectron && outputFolder) {
        await window.voxstudio.writeText({ folder: outputFolder,
                                            filename: outName, content });
      } else {
        browserDownload(outName, content);
      }
    };

    for (const k of formats) {
      const ser = SERIALIZERS[k];
      if (!ser) continue;
      const content = ser(segments || [], meta);
      const outName = `${base}.${FORMATS.find((f) => f.key === k).ext}`;
      await writeOne(outName, content);
    }

    // Bilingual / translated outputs (chỉ khi bật translate)
    if (translated && segments?.length) {
      const bilingual = segments.map((s, i) => ({
        start: s.start, end: s.end,
        text: ((s.text || "").trim()
          + (translated[i] ? `\n${translated[i].trim()}` : "")).trim(),
      }));
      const transOnly = segments.map((s, i) => ({
        start: s.start, end: s.end,
        text: (translated[i] || "").trim(),
      }));
      for (const k of formats) {
        const ser = SERIALIZERS[k];
        if (!ser) continue;
        const ext = FORMATS.find((f) => f.key === k).ext;
        // translated-only (.${trTarget}.ext)
        await writeOne(`${base}.${trTarget}.${ext}`,
                        ser(transOnly, { ...meta, translated_to: trTarget }));
        // bilingual (.bilingual.ext) — SRT/VTT/TXT hợp lý, JSON/CSV bỏ qua
        if (["srt", "vtt", "txt"].includes(k)) {
          await writeOne(`${base}.bilingual.${ext}`, ser(bilingual, meta));
        }
      }
    }
  }

  /* ── Run pipeline sequentially ── */
  async function runAll() {
    if (running) return;
    const pending = items.filter((x) => x.status !== "done");
    if (!pending.length) {
      toast?.show({ title: "Không có file", message: "Thêm file rồi bấm chạy.", kind: "warn" });
      return;
    }
    if (!formats.length) {
      toast?.show({ title: "Chọn định dạng", message: "Tick ít nhất 1 format đầu ra.", kind: "warn" });
      return;
    }
    if (isElectron && !outputFolder) {
      toast?.show({
        title: "Chọn thư mục lưu",
        message: "Chưa có output folder — file sẽ tải về qua Downloads của trình duyệt.",
        kind: "info",
      });
    }
    setRunning(true);
    abortRef.current = false;
    try {
      for (const it of pending) {
        if (abortRef.current) break;
        setItems((prev) => prev.map((x) =>
          x.id === it.id ? { ...x, status: "running", error: null } : x));
        try {
          let file = it.file;
          if (!file && it.path) file = await pathToFile(it.path);
          if (!file) throw new Error("Không đọc được file");
          const r = await transcribe(file, { language: lang });
          const segments = r?.segments || [];
          const patch = {
            status: "done",
            segments,
            lang: r?.language || null,
            text: r?.text || "",
            translated: null,
          };

          // Optional translation step
          if (trOn && segments.length) {
            const engineMeta = TRANSLATE_ENGINES.find((e) => e.id === trEngine);
            const apiKey = engineMeta?.needsKey ? await getKey(trEngine) : null;
            if (engineMeta?.needsKey && !apiKey) {
              throw new Error(`Thiếu API key cho ${engineMeta.label}. Vào Cài đặt → AI & API keys để thêm.`);
            }
            const texts = segments.map((s) => (s.text || "").trim());
            const tr = await translateTexts({
              texts, target: trTarget, source: r?.language || "auto",
              engine: trEngine, apiKey,
            });
            patch.translated = tr?.translations || [];
          }

          // export before marking state so errors surface
          await exportResult({ ...it, ...patch });
          setItems((prev) => prev.map((x) =>
            x.id === it.id ? { ...x, ...patch } : x));
        } catch (e) {
          const msg = e?.message || String(e);
          setItems((prev) => prev.map((x) =>
            x.id === it.id ? { ...x, status: "error", error: msg } : x));
          showError(toast, e, "Lỗi STT");
        }
      }
    } finally {
      setRunning(false);
    }
  }

  const cancel = () => { abortRef.current = true; };

  /* ── Derived counts ── */
  const counts = useMemo(() => {
    const by = { pending: 0, running: 0, done: 0, error: 0 };
    for (const x of items) by[x.status] = (by[x.status] || 0) + 1;
    return by;
  }, [items]);

  return (
    <Page>
      <PageHeader
        title="Phụ đề (STT)"
        subtitle="Trích xuất phụ đề từ audio/video · batch theo thư mục · xuất SRT · VTT · TXT · JSON · CSV"
      >
        {items.length > 0 && !running && (
          <Button size="sm" variant="ghost" icon={Trash2} onClick={clearAll}>
            Xoá tất cả
          </Button>
        )}
        {running ? (
          <Button size="md" variant="danger" icon={X} onClick={cancel}>
            Huỷ
          </Button>
        ) : (
          <Button size="md" variant="primary" icon={Play}
                  onClick={runAll}
                  disabled={!items.length || !formats.length}>
            Bắt đầu {items.filter((x) => x.status !== "done").length > 0
              ? `(${items.filter((x) => x.status !== "done").length})` : ""}
          </Button>
        )}
      </PageHeader>

      <PageContent maxWidth={1080}>
        <div style={{ display: "grid",
                       gridTemplateColumns: "minmax(0, 1fr) 300px",
                       gap: 20 }}>
          {/* ── Left: dropzone + items ── */}
          <div style={{ minWidth: 0 }}>
            <DropZone onDrop={onDrop} onPickFiles={pickFiles}
                       onPickFolder={pickFolderForBatch} />

            <input
              ref={fileInputRef}
              type="file"
              accept={MEDIA_EXTS.map((e) => "." + e).join(",")}
              multiple
              onChange={onFileInput}
              style={{ display: "none" }}
            />

            {items.length > 0 && (
              <div style={{ marginTop: 16,
                            display: "flex", alignItems: "center", gap: 12,
                            fontSize: 12, color: "var(--n-8)" }}>
                <span>{items.length} file</span>
                {counts.done > 0 && <span>· {counts.done} xong</span>}
                {counts.error > 0 && <span style={{ color: "var(--err)" }}>
                  · {counts.error} lỗi
                </span>}
                {counts.done > 0 && !running && (
                  <button
                    onClick={clearDone}
                    style={{
                      marginLeft: "auto",
                      background: "transparent", border: "none",
                      color: "var(--accent)", cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    Xoá các mục đã xong
                  </button>
                )}
              </div>
            )}

            <AnimatePresence initial={false}>
              {items.map((it) => (
                <ItemRow key={it.id} item={it}
                          onRemove={() => removeItem(it.id)}
                          disabled={running} />
              ))}
            </AnimatePresence>
          </div>

          {/* ── Right: config sidebar ── */}
          <aside style={{ display: "flex", flexDirection: "column", gap: 16,
                          position: "sticky", top: 0, alignSelf: "start" }}>
            <ConfigCard title="Ngôn ngữ nguồn" icon={Languages}>
              <select
                value={lang}
                onChange={(e) => setLangPersist(e.target.value)}
                style={selectStyle}
              >
                {LANGUAGES.map((L) => (
                  <option key={L.code} value={L.code}>{L.label}</option>
                ))}
              </select>
              <p style={{ marginTop: 6, fontSize: 11, color: "var(--n-7)" }}>
                Whisper tự nhận diện khá chính xác — chỉ chọn tay khi auto sai.
              </p>
            </ConfigCard>

            <ConfigCard title="Định dạng xuất" icon={FileText}>
              <div style={{ display: "grid", gap: 6 }}>
                {FORMATS.map((f) => {
                  const on = formats.includes(f.key);
                  return (
                    <button
                      key={f.key}
                      onClick={() => toggleFormat(f.key)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "8px 10px", borderRadius: 6,
                        background: on ? "var(--accent-soft)" : "var(--n-1)",
                        border: `1px solid ${on ? "var(--accent)" : "var(--n-3)"}`,
                        color: "var(--n-10)", cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{
                        width: 14, height: 14, borderRadius: 3,
                        border: `1.5px solid ${on ? "var(--accent)" : "var(--n-5)"}`,
                        background: on ? "var(--accent)" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                      }}>
                        {on && <Check size={10} color="#fff" strokeWidth={3} />}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: 12.5,
                                      width: 42 }}>{f.label}</span>
                      <span style={{ fontSize: 11, color: "var(--n-7)" }}>
                        {f.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
            </ConfigCard>

            <ConfigCard title="Dịch phụ đề" icon={Languages}>
              <label style={{ display: "flex", alignItems: "center", gap: 8,
                               cursor: "pointer", marginBottom: trOn ? 10 : 0 }}>
                <input
                  type="checkbox"
                  checked={trOn}
                  onChange={(e) => setTrOnPersist(e.target.checked)}
                  style={{ accentColor: "var(--accent)" }}
                />
                <span style={{ fontSize: 12.5, color: "var(--n-10)" }}>
                  Tự động dịch sau khi STT
                </span>
              </label>
              {trOn && (
                <>
                  <div style={{ fontSize: 11, color: "var(--n-7)", marginBottom: 4,
                                 marginTop: 6 }}>
                    Dịch sang
                  </div>
                  <select
                    value={trTarget}
                    onChange={(e) => setTrTargetPersist(e.target.value)}
                    style={selectStyle}
                  >
                    {LANGUAGES.filter((L) => L.code !== "auto").map((L) => (
                      <option key={L.code} value={L.code}>{L.label}</option>
                    ))}
                  </select>

                  <div style={{ fontSize: 11, color: "var(--n-7)", marginBottom: 4,
                                 marginTop: 10 }}>
                    Engine
                  </div>
                  <select
                    value={trEngine}
                    onChange={(e) => setTrEnginePersist(e.target.value)}
                    style={selectStyle}
                  >
                    {TRANSLATE_ENGINES.map((E) => (
                      <option key={E.id} value={E.id}>
                        {E.label}{E.needsKey ? " (cần key)" : ""}
                      </option>
                    ))}
                  </select>

                  <p style={{ marginTop: 8, fontSize: 11, color: "var(--n-7)",
                               lineHeight: 1.5 }}>
                    Xuất thêm 2 bộ file: <code>.{trTarget}.srt</code> (bản dịch) và{" "}
                    <code>.bilingual.srt</code> (gốc + dịch chồng).
                  </p>
                </>
              )}
            </ConfigCard>

            <ConfigCard title="Thư mục lưu" icon={Folder}>
              {isElectron ? (
                <>
                  <button
                    onClick={pickFolder}
                    style={{
                      width: "100%", padding: "8px 10px", borderRadius: 6,
                      background: "var(--n-1)",
                      border: "1px solid var(--n-3)",
                      color: "var(--n-10)", cursor: "pointer",
                      fontSize: 12, textAlign: "left",
                      overflow: "hidden", textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={outputFolder || "Chọn thư mục…"}
                  >
                    <FolderOpen size={11} style={{ display: "inline", marginRight: 6,
                                                    verticalAlign: "-1px" }} />
                    {outputFolder || "Chọn thư mục…"}
                  </button>
                  {outputFolder && (
                    <button
                      onClick={() => setOutputFolderPersist("")}
                      style={{
                        marginTop: 6,
                        background: "transparent", border: "none",
                        color: "var(--n-7)", fontSize: 11, cursor: "pointer",
                      }}
                    >
                      Xoá chọn (tải về Downloads)
                    </button>
                  )}
                </>
              ) : (
                <p style={{ fontSize: 11, color: "var(--n-7)" }}>
                  Ở web, file xuất sẽ tải về thư mục Downloads của trình duyệt.
                </p>
              )}
            </ConfigCard>
          </aside>
        </div>
      </PageContent>
    </Page>
  );
}

/* ─── DropZone ─── */

function DropZone({ onDrop, onPickFiles, onPickFolder }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); onDrop(e); }}
      style={{
        border: `2px dashed ${over ? "var(--accent)" : "var(--n-3)"}`,
        background: over ? "var(--accent-soft)" : "var(--n-1)",
        borderRadius: 12,
        padding: "40px 24px",
        textAlign: "center",
        transition: "all 0.12s ease",
      }}
    >
      <UploadCloud size={36} style={{ color: "var(--n-7)", margin: "0 auto 12px" }} />
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--n-10)" }}>
        Kéo thả audio / video vào đây
      </div>
      <div style={{ fontSize: 12, color: "var(--n-7)", marginTop: 4 }}>
        MP3 · WAV · M4A · MP4 · MOV · MKV · WEBM … (nhiều file cùng lúc)
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
        <Button size="sm" variant="secondary" icon={FileAudio} onClick={onPickFiles}>
          Chọn file
        </Button>
        <Button size="sm" variant="ghost" icon={FolderOpen} onClick={onPickFolder}>
          Quét thư mục
        </Button>
      </div>
    </div>
  );
}

/* ─── ItemRow ─── */

function ItemRow({ item, onRemove, disabled }) {
  const { name, size, status, error, segments, lang: detected } = item;
  const isVideo = /\.(mp4|mov|mkv|avi|webm)$/i.test(name);
  const Icon = isVideo ? FileVideo : FileAudio;

  const badge = {
    pending: { label: "Chờ",     color: "var(--n-7)",  bg: "var(--n-2)" },
    running: { label: "Đang xử lý", color: "var(--accent)", bg: "var(--accent-soft)" },
    done:    { label: "Xong",     color: "var(--ok)",   bg: "rgba(34,197,94,0.12)" },
    error:   { label: "Lỗi",      color: "var(--err)",  bg: "rgba(239,68,68,0.12)" },
  }[status];

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.15 }}
      style={{
        marginTop: 10,
        padding: "10px 12px",
        background: "var(--n-1)",
        border: "1px solid var(--n-3)",
        borderRadius: 8,
        display: "flex", alignItems: "center", gap: 12,
      }}
    >
      <Icon size={16} style={{ color: "var(--n-7)", flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--n-10)",
                       overflow: "hidden", textOverflow: "ellipsis",
                       whiteSpace: "nowrap" }}>
          {name}
        </div>
        <div style={{ fontSize: 11, color: "var(--n-7)", marginTop: 2 }}>
          {size ? `${(size / (1024 * 1024)).toFixed(1)} MB` : ""}
          {status === "done" && segments && (
            <> · {segments.length} segments
              {detected ? ` · ${detected.toUpperCase()}` : ""}</>
          )}
          {status === "error" && error && (
            <span style={{ color: "var(--err)" }}> · {error}</span>
          )}
        </div>
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "3px 8px", borderRadius: 4,
        background: badge.bg, color: badge.color,
        fontSize: 11, fontWeight: 500,
        flexShrink: 0,
      }}>
        {status === "running" && <Loader2 size={10} className="animate-spin" />}
        {status === "done"    && <Check size={10} />}
        {status === "error"   && <AlertTriangle size={10} />}
        {badge.label}
      </div>

      {!disabled && status !== "running" && (
        <button
          onClick={onRemove}
          title="Xoá khỏi danh sách"
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: "var(--n-7)", padding: 4, display: "flex",
            borderRadius: 4,
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--n-2)"}
          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        >
          <X size={12} />
        </button>
      )}
    </motion.div>
  );
}

/* ─── ConfigCard ─── */

function ConfigCard({ title, icon: Icon, children }) {
  return (
    <div style={{
      padding: 14,
      background: "var(--n-1)",
      border: "1px solid var(--n-3)",
      borderRadius: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6,
                    marginBottom: 10, fontSize: 12, fontWeight: 600,
                    color: "var(--n-9)",
                    textTransform: "uppercase", letterSpacing: 0.6 }}>
        <Icon size={12} />
        {title}
      </div>
      {children}
    </div>
  );
}
