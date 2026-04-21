import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  Link2, Clipboard, Download, Loader2, X, AlertTriangle,
  Globe, Sparkles, ExternalLink, Trash2,
} from "lucide-react";
import Button from "../ui/Button";
import Modal from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { useT } from "../../i18n/I18nContext";
import { ingestFromURL } from "../../services/api";
import { showError } from "../../services/errors";

const RECENT_KEY = "voxstudio:ingest:recent";
const AGREED_KEY = "voxstudio:ingest:disclaimerAgreed";
const MAX_RECENT = 8;

/**
 * IngestTab — Dán URL → tải video → tạo project → mở trang lồng tiếng.
 *
 * Flow:
 *   1. Disclaimer modal hiện lần đầu (lưu AGREED_KEY).
 *   2. User dán link + Download → SSE progress.
 *   3. Khi xong → navigate(/studio/{project_id}) để user config + dub.
 */
export default function IngestTab() {
  const t = useT();
  const toast = useToast();
  const nav = useNavigate();
  const [url, setUrl] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState(null);
  const [meta, setMeta] = useState(null);
  const [recent, setRecent] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); }
    catch { return []; }
  });
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const abortRef = useRef(null);
  const inputRef = useRef(null);

  const pushRecent = (u) => {
    setRecent((r) => {
      const next = [u, ...r.filter((x) => x !== u)].slice(0, MAX_RECENT);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const clearRecent = () => {
    setRecent([]);
    try { localStorage.removeItem(RECENT_KEY); } catch {}
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
        inputRef.current?.focus();
      }
    } catch {
      toast.warn("Không truy cập được clipboard.");
    }
  };

  const reset = () => {
    setDownloading(false);
    setProgress(0);
    setStep(null);
    setMeta(null);
    abortRef.current = null;
  };

  const cancel = () => {
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch {}
    }
    reset();
  };

  const start = () => {
    if (!url.trim()) return;
    const agreed = localStorage.getItem(AGREED_KEY) === "1";
    if (!agreed) {
      setDisclaimerOpen(true);
      return;
    }
    doDownload();
  };

  const doDownload = () => {
    setDownloading(true);
    setProgress(0);
    setStep("connecting");
    setMeta(null);
    const controller = new AbortController();
    abortRef.current = controller;

    ingestFromURL({
      url: url.trim(),
      signal: controller.signal,
      onProgress: (d) => {
        if (d.step === "meta") {
          setMeta({
            title: d.label,
            detail: d.detail,
            thumbnail: d.thumbnail,
          });
        }
        setStep(d.step);
        if (typeof d.progress === "number" && d.progress >= 0) {
          setProgress(d.progress);
        }
      },
      onDone: (d) => {
        if (d?.project_id) {
          pushRecent(url.trim());
          toast.success(`Tải xong: ${d.title || d.filename}`);
          nav(`/studio/${d.project_id}`);
        }
        reset();
      },
      onError: (err) => {
        if (err?.name !== "AbortError") {
          showError(toast, err, { context: "ingest" }, t);
        }
        reset();
      },
    }).catch((err) => {
      if (err?.name !== "AbortError") {
        showError(toast, err, { context: "ingest" }, t);
      }
      reset();
    });
  };

  return (
    <div>
      {/* Header section */}
      <div
        style={{
          padding: "32px 28px 24px",
          borderRadius: 10,
          background: "linear-gradient(135deg, rgba(94,106,210,0.12), rgba(139,92,246,0.06))",
          border: "1px solid var(--n-3)",
          marginBottom: 20,
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={14} style={{ color: "var(--accent)" }} />
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
                         textTransform: "uppercase", color: "var(--accent)" }}>
            {t("ingest.tab")}
          </span>
        </div>
        <h2 style={{
          fontSize: 22, fontWeight: 600, color: "var(--n-10)",
          margin: 0, letterSpacing: "var(--tr-tight)",
        }}>
          {t("ingest.title")}
        </h2>
        <p style={{ fontSize: 12, color: "var(--n-8)", marginTop: 6 }}>
          {t("ingest.subtitle")}
        </p>

        {/* URL input */}
        <div
          className="flex items-center gap-2 mt-5"
          style={{
            background: "var(--n-1)",
            border: `1px solid ${downloading ? "var(--accent)" : "var(--n-3)"}`,
            borderRadius: 8,
            padding: 4,
            transition: "border-color var(--dur-fast) var(--ease)",
          }}
        >
          <Link2 size={14} style={{ color: "var(--n-8)", marginLeft: 8, flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("ingest.inputPlaceholder")}
            disabled={downloading}
            onKeyDown={(e) => { if (e.key === "Enter" && !downloading) start(); }}
            spellCheck={false}
            style={{
              flex: 1, minWidth: 0,
              background: "transparent", border: "none", outline: "none",
              padding: "8px 4px",
              fontSize: 13, color: "var(--n-10)",
              fontFamily: "var(--font-mono)",
            }}
          />
          {!downloading && url && (
            <button
              onClick={() => setUrl("")}
              title="Xoá"
              style={{
                width: 24, height: 24, border: "none", background: "transparent",
                color: "var(--n-6)", cursor: "pointer", borderRadius: 4,
              }}
            >
              <X size={12} />
            </button>
          )}
          {!downloading && (
            <Button size="sm" variant="ghost" icon={Clipboard} onClick={handlePaste}>
              {t("ingest.paste")}
            </Button>
          )}
          {downloading ? (
            <Button size="sm" variant="secondary" icon={X} onClick={cancel}>
              {t("ingest.canceled")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              icon={Download}
              onClick={start}
              disabled={!url.trim()}
            >
              {t("ingest.download")}
            </Button>
          )}
        </div>

        {/* Progress */}
        <AnimatePresence>
          {downloading && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: "auto", marginTop: 16 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ overflow: "hidden" }}
            >
              {meta && (
                <div className="flex items-center gap-3 mb-2">
                  {meta.thumbnail && (
                    <img
                      src={meta.thumbnail}
                      alt=""
                      style={{
                        width: 48, height: 28, objectFit: "cover",
                        borderRadius: 4, flexShrink: 0,
                      }}
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      title={meta.title}
                      style={{
                        fontSize: 12, fontWeight: 500, color: "var(--n-10)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      {meta.title}
                    </div>
                    {meta.detail && (
                      <div style={{ fontSize: 10, color: "var(--n-8)" }}>
                        {meta.detail}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div style={{
                height: 6, background: "var(--n-2)",
                borderRadius: 3, overflow: "hidden",
              }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(0, Math.min(100, progress))}%`,
                    background: "linear-gradient(90deg, var(--accent), #8b5cf6)",
                    transition: "width 400ms linear",
                  }}
                />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Loader2 size={11} className="animate-spin"
                         style={{ color: "var(--accent)" }} />
                <span style={{ fontSize: 11, color: "var(--n-8)" }}>
                  {step === "downloading" ? t("ingest.downloading")
                   : step === "processing" ? "Đang xử lý…"
                   : step === "meta" ? "Đang phân tích…"
                   : "Kết nối…"}
                </span>
                <span className="font-mono"
                      style={{ fontSize: 11, color: "var(--n-6)", marginLeft: "auto" }}>
                  {Math.round(progress)}%
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Supported sources */}
      <div
        style={{
          fontSize: 11, color: "var(--n-8)",
          padding: "10px 14px",
          background: "var(--n-1)",
          border: "1px solid var(--n-3)",
          borderRadius: 8,
          marginBottom: 20,
          display: "flex", alignItems: "center", gap: 8,
        }}
      >
        <Globe size={12} style={{ color: "var(--n-6)", flexShrink: 0 }} />
        <span>{t("ingest.supported")}</span>
      </div>

      {/* Recent links */}
      {recent.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span style={{
              fontSize: 10, fontWeight: 600, textTransform: "uppercase",
              letterSpacing: "0.05em", color: "var(--n-6)",
            }}>
              {t("ingest.recent")}
            </span>
            <button
              onClick={clearRecent}
              style={{
                fontSize: 11, color: "var(--n-8)",
                background: "transparent", border: "none", cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 4,
              }}
            >
              <Trash2 size={10} /> {t("ingest.clear")}
            </button>
          </div>
          <div className="space-y-1">
            {recent.map((u) => (
              <button
                key={u}
                onClick={() => setUrl(u)}
                className="w-full text-left flex items-center gap-2 px-3 transition-colors"
                style={{
                  height: 32,
                  background: "var(--n-1)",
                  border: "1px solid var(--n-3)",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--n-2)";
                  e.currentTarget.style.borderColor = "var(--n-4)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--n-1)";
                  e.currentTarget.style.borderColor = "var(--n-3)";
                }}
              >
                <ExternalLink size={11} style={{ color: "var(--n-6)", flexShrink: 0 }} />
                <span
                  className="font-mono"
                  title={u}
                  style={{
                    flex: 1, minWidth: 0,
                    fontSize: 11, color: "var(--n-9)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {u}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div
          style={{
            padding: "40px 20px", textAlign: "center",
            color: "var(--n-8)", fontSize: 12,
            border: "1px dashed var(--n-3)",
            borderRadius: 10,
          }}
        >
          {t("ingest.emptyHint")}
        </div>
      )}

      {/* Disclaimer modal */}
      <Modal
        open={disclaimerOpen}
        onClose={() => setDisclaimerOpen(false)}
        title={t("ingest.disclaimerTitle")}
        width={460}
        actions={
          <>
            <Button variant="ghost" size="md"
                    onClick={() => setDisclaimerOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                localStorage.setItem(AGREED_KEY, "1");
                setDisclaimerOpen(false);
                doDownload();
              }}
            >
              {t("ingest.agreeOnce")}
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <div
            style={{
              width: 36, height: 36, borderRadius: 8,
              background: "rgba(210,153,34,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <AlertTriangle size={16} style={{ color: "var(--warn)" }} />
          </div>
          <div>
            <p style={{ lineHeight: 1.55, color: "var(--n-9)" }}>
              {t("ingest.disclaimer")}
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
