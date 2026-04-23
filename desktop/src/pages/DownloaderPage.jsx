import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  Link2, Clipboard, Loader2, Download, Film, Sparkles,
  Globe, AlertTriangle, ExternalLink, Trash2, X, Clock,
  FileVideo, Wand2, Check, Image as ImageIcon,
} from "lucide-react";
import PageHeader, { Page, PageContent } from "../components/ui/PageHeader";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import StatusDot from "../components/ui/StatusDot";
import Segmented from "../components/ui/Segmented";
import { Table, THead, TBody, Th, Tr, Td } from "../components/ui/Table";
import SaveAsModal, { cleanName } from "../components/ui/SaveAsModal";
import { Globe as Chrome } from "lucide-react";
import { useToast } from "../components/ui/Toast";
import { useT } from "../i18n/I18nContext";
import {
  downloadFetchInfo, downloadToProject,
  dubbingVideoURL, deleteDubbingProject, SERVER_URL,
} from "../services/api";
import { showError } from "../services/errors";

const HISTORY_KEY = "voxstudio:download:history";
const AGREED_KEY = "voxstudio:download:disclaimerAgreed";
const ENGINE_KEY = "voxstudio:download:engine";
const RES_KEY = "voxstudio:download:maxHeight";
const MAX_HISTORY = 20;

const PLATFORM_COLORS = {
  tiktok:    "#000000",
  douyin:    "#fe2c55",
  youtube:   "#ff0033",
  facebook:  "#1877f2",
  instagram: "#c13584",
  bilibili:  "#00a1d6",
  twitter:   "#1da1f2",
  generic:   "#6c6c80",
};

/**
 * DownloaderPage — trang riêng tải video từ mạng xã hội.
 *
 * Flow:
 *   1. User dán URL → blur/enter → tự fetch info để preview
 *   2. Card preview hiện thumbnail/title/author/duration/platform
 *   3. 2 action: Tải + Lồng tiếng  /  Tải về máy (thư mục)
 *   4. Progress bar khi đang tải
 *   5. Lịch sử phía dưới (localStorage)
 */
export default function DownloaderPage() {
  const t = useT();
  const toast = useToast();
  const nav = useNavigate();

  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [info, setInfo] = useState(null);
  const [preferNoWM, setPreferNoWM] = useState(true);
  const [engine, setEngine] = useState(() => {
    try { return localStorage.getItem(ENGINE_KEY) || "auto"; }
    catch { return "auto"; }
  });
  const setEnginePersist = (v) => {
    setEngine(v);
    try { localStorage.setItem(ENGINE_KEY, v); } catch {}
    setInfo(null);  // clear preview khi đổi engine
  };
  const [maxHeight, setMaxHeight] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem(RES_KEY) || "", 10);
      return Number.isFinite(v) ? v : 1080;
    } catch { return 1080; }
  });
  const setMaxHeightPersist = (v) => {
    setMaxHeight(v);
    try { localStorage.setItem(RES_KEY, String(v)); } catch {}
  };

  const [downloading, setDownloading] = useState(false);
  const [progress, _setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [progressDetail, setProgressDetail] = useState("");
  // Monotonic progress — chỉ tiến, không bao giờ lùi. Reset về 0 khi
  // bắt đầu job mới (gọi setProgress(0)).
  const progressMaxRef = useRef(0);
  const setProgress = (v) => {
    const n = Number.isFinite(v) ? v : 0;
    if (n === 0) {
      progressMaxRef.current = 0;
      _setProgress(0);
      return;
    }
    const next = Math.max(progressMaxRef.current, n);
    progressMaxRef.current = next;
    _setProgress(next);
  };

  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
    catch { return []; }
  });
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [loginNeeded, setLoginNeeded] = useState(null);  // { platform, url }
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const pendingActionRef = useRef(null);
  const abortRef = useRef(null);
  const inputRef = useRef(null);

  // Fetch info when URL becomes a valid http(s) URL (debounce simple)
  const validUrl = /^https?:\/\/\S+$/i.test(url.trim());

  useEffect(() => {
    setInfo(null);
    setLoginNeeded(null);
  }, [url]);

  const doFetchInfo = async () => {
    if (!validUrl || fetching || downloading) return;
    setFetching(true);
    setLoginNeeded(null);
    try {
      const data = await downloadFetchInfo(url.trim(), { engine });
      setInfo(data);
    } catch (e) {
      // Detect "login needed" type errors → show helper card thay vì toast lỗi
      const msg = String(e?.message || "");
      if (/ĐĂNG NHẬP|cần login|login|sign in|cookies.*needed/i.test(msg)) {
        setLoginNeeded({ url: url.trim(), message: msg });
      } else {
        showError(toast, e, { context: "fetch info" }, t);
      }
    }
    setFetching(false);
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
    setProgressLabel("");
    setProgressDetail("");
    abortRef.current = null;
  };

  const cancel = () => {
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch {}
    }
    reset();
  };

  const pushHistory = (entry) => {
    setHistory((h) => {
      const next = [entry, ...h.filter((x) => x.url !== entry.url)]
        .slice(0, MAX_HISTORY);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
  };

  const withDisclaimer = (run) => {
    const agreed = localStorage.getItem(AGREED_KEY) === "1";
    if (agreed) run();
    else {
      pendingActionRef.current = run;
      setDisclaimerOpen(true);
    }
  };

  const handleToDub = () => withDisclaimer(doDownloadToDub);

  const doDownloadToDub = () => {
    if (!validUrl) return;
    setDownloading(true);
    setProgress(0);
    setProgressLabel(t("downloader.analyzing"));
    setProgressDetail("");

    const controller = new AbortController();
    abortRef.current = controller;

    downloadToProject({
      url: url.trim(),
      useWatermark: !preferNoWM,
      engine,
      maxHeight,
      signal: controller.signal,
      onProgress: (d) => {
        if (d.label) setProgressLabel(d.label);
        if (d.detail) setProgressDetail(d.detail);
        if (typeof d.progress === "number" && d.progress >= 0) {
          setProgress(d.progress);
        }
        if (d.step === "meta" && d.thumbnail) {
          setInfo((cur) => cur || {
            title: d.label, author: null, thumbnail: d.thumbnail,
            platform: null,
          });
        }
      },
      onDone: (d) => {
        if (d?.project_id) {
          pushHistory({
            url: url.trim(),
            project_id: d.project_id,
            title: d.title || d.filename,
            thumbnail: d.thumbnail || info?.thumbnail,
            platform: d.platform || info?.platform,
            duration: d.duration || info?.duration,
            at: Date.now(),
            kind: "project",
          });
          toast.success(`Đã tải: ${d.title || d.filename}`);
          nav(`/studio/dubbing/${d.project_id}`);
        }
        reset();
      },
      onError: (err) => {
        if (err?.name !== "AbortError") {
          showError(toast, err, { context: "download" }, t);
        }
        reset();
      },
    }).catch((err) => {
      if (err?.name !== "AbortError") {
        showError(toast, err, { context: "download" }, t);
      }
      reset();
    });
  };


  const handleToFolder = () => withDisclaimer(() => {
    if (!info?.video_url) {
      toast.warn("Hãy phân tích link trước.");
      return;
    }
    if (!window.voxstudio?.saveRemoteFileToFolder) {
      toast.warn("Chức năng tải về thư mục cần chạy trong desktop app.");
      return;
    }
    setSaveAsOpen(true);
  });

  // "Tải về máy" = chạy FULL pipeline backend (yt-dlp download + merge
  // audio + transcode AV1→H.264) thành 1 project tạm, rồi copy file
  // original.mp4 sang folder user chọn, cuối cùng xoá project để không
  // lẫn vào Studio.
  const doDownloadToFolder = async ({ folder, filename, overwrite }) => {
    setSaveAsOpen(false);
    setDownloading(true);
    setProgress(0);
    setProgressLabel("Đang chuẩn bị…");
    setProgressDetail("");
    const controller = new AbortController();
    abortRef.current = controller;

    let createdProjectId = null;
    try {
      // 1. Chạy pipeline download → project (có transcode)
      await new Promise((resolve, reject) => {
        let settled = false;
        const settle = (fn) => (v) => { if (!settled) { settled = true; fn(v); } };
        const safeResolve = settle(resolve);
        const safeReject = settle(reject);
        downloadToProject({
          url: url.trim(),
          useWatermark: !preferNoWM,
          engine,
          maxHeight,
          signal: controller.signal,
          onProgress: (d) => {
            if (d.label) setProgressLabel(d.label);
            if (d.detail) setProgressDetail(d.detail);
            if (typeof d.progress === "number" && d.progress >= 0) {
              // 0-92% = download+transcode, 92-100% = save to folder
              setProgress(Math.min(92, d.progress * 0.92));
            }
          },
          onDone: (d) => {
            if (d?.project_id) {
              createdProjectId = d.project_id;
              safeResolve(d);
            }
          },
          onError: safeReject,
        }).catch(safeReject);
      });

      if (!createdProjectId) throw new Error("Pipeline không trả project_id.");

      // 2. Copy file original.mp4 từ backend sang folder user
      setProgressLabel("Đang lưu file…");
      setProgress(94);
      const path = await window.voxstudio.saveRemoteFileToFolder({
        url: dubbingVideoURL(createdProjectId),
        folder, filename, overwrite,
      });
      setProgress(100);

      // 3. Xoá project tạm (không block UX nếu fail)
      deleteDubbingProject(createdProjectId).catch(() => {});

      pushHistory({
        url: url.trim(),
        path,
        title: info?.title,
        thumbnail: info?.thumbnail,
        platform: info?.platform,
        duration: info?.duration,
        at: Date.now(),
        kind: "folder",
      });
      toast.success(`Đã lưu: ${path}`, { duration: 6000 });
    } catch (e) {
      if (e?.name !== "AbortError") {
        showError(toast, e, { context: "save to folder" }, t);
      }
      // Dọn project tạm nếu lỗi giữa chừng
      if (createdProjectId) {
        deleteDubbingProject(createdProjectId).catch(() => {});
      }
    }
    reset();
  };

  return (
    <Page>
      <PageHeader
        title={t("downloader.title")}
        subtitle={t("downloader.subtitle")}
      />
      <PageContent maxWidth={880}>
        {/* Hero input */}
        <HeroInput
          url={url}
          onUrl={setUrl}
          onPaste={handlePaste}
          onAnalyze={doFetchInfo}
          fetching={fetching}
          disabled={downloading}
          inputRef={inputRef}
          engine={engine}
          onEngine={setEnginePersist}
          maxHeight={maxHeight}
          onMaxHeight={setMaxHeightPersist}
          t={t}
        />

        {/* Login-needed helper */}
        <AnimatePresence>
          {loginNeeded && !downloading && (
            <motion.div
              key="login-needed"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              style={{ marginTop: 16 }}
            >
              <LoginNeededCard
                url={loginNeeded.url}
                message={loginNeeded.message}
                onOpenChrome={async () => {
                  try {
                    await window.voxstudio?.openInChrome?.(loginNeeded.url);
                    toast.info("Đã mở trong Chrome. Login xong → Cmd+Q Chrome → quay lại app, bấm Phân tích.");
                  } catch {
                    toast.error("Không mở được Chrome.");
                  }
                }}
                onRetry={() => {
                  setLoginNeeded(null);
                  doFetchInfo();
                }}
                onDismiss={() => setLoginNeeded(null)}
                t={t}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Preview card */}
        <AnimatePresence mode="wait">
          {info && !downloading && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              style={{ marginTop: 16 }}
            >
              <PreviewCard
                info={info}
                preferNoWM={preferNoWM}
                onTogglePreferNoWM={() => setPreferNoWM((v) => !v)}
                onDub={handleToDub}
                onFolder={handleToFolder}
                t={t}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Progress */}
        <AnimatePresence>
          {downloading && (
            <motion.div
              key="progress"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              style={{ marginTop: 16 }}
            >
              <ProgressCard
                info={info}
                progress={progress}
                label={progressLabel}
                detail={progressDetail}
                onCancel={cancel}
                t={t}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Supported */}
        <div
          style={{
            fontSize: 11, color: "var(--n-8)",
            padding: "10px 14px",
            background: "var(--n-1)",
            border: "1px solid var(--n-3)",
            borderRadius: 8,
            marginTop: 16, marginBottom: 24,
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <Globe size={12} style={{ color: "var(--n-6)", flexShrink: 0 }} />
          <span>{t("downloader.supported")}</span>
        </div>

        {/* History */}
        <HistorySection
          items={history}
          onClear={clearHistory}
          onReplay={(u) => setUrl(u)}
          onOpenProject={(id) => nav(`/studio/dubbing/${id}`)}
          onOpenFolder={(path) => window.voxstudio?.revealFileInFolder?.(path)}
          t={t}
        />
      </PageContent>

      {/* Save As modal — pick folder + filename trước khi tải về máy */}
      <SaveAsModal
        open={saveAsOpen}
        onClose={() => setSaveAsOpen(false)}
        defaultName={cleanName(info?.title || "video")}
        defaultFolder={localStorage.getItem("voxstudio:batch:outputFolder")}
        ext=".mp4"
        onSave={doDownloadToFolder}
      />

      {/* Disclaimer modal */}
      <Modal
        open={disclaimerOpen}
        onClose={() => setDisclaimerOpen(false)}
        title={t("downloader.disclaimerTitle")}
        width={480}
        actions={
          <>
            <Button variant="ghost" size="md"
                    onClick={() => setDisclaimerOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary" size="md"
              onClick={() => {
                localStorage.setItem(AGREED_KEY, "1");
                setDisclaimerOpen(false);
                pendingActionRef.current?.();
                pendingActionRef.current = null;
              }}
            >
              {t("downloader.agree")}
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: "rgba(210,153,34,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <AlertTriangle size={16} style={{ color: "var(--warn)" }} />
          </div>
          <p style={{ lineHeight: 1.55, color: "var(--n-9)" }}>
            {t("downloader.disclaimer")}
          </p>
        </div>
      </Modal>
    </Page>
  );
}

// ── Hero URL input ───────────────────────────────────────────
function HeroInput({ url, onUrl, onPaste, onAnalyze, fetching, disabled,
                     inputRef, engine, onEngine,
                     maxHeight, onMaxHeight, t }) {
  const valid = /^https?:\/\/\S+$/i.test(url.trim());
  const engineOptions = [
    { value: "auto",    label: t("downloader.engineAuto"),    hint: t("downloader.engineAutoHint") },
    { value: "scraper", label: t("downloader.engineScraper"), hint: t("downloader.engineScraperHint") },
    { value: "ytdlp",   label: t("downloader.engineYtdlp"),   hint: t("downloader.engineYtdlpHint") },
  ];
  const resOptions = [
    { value: 480,   label: "480p" },
    { value: 720,   label: "720p" },
    { value: 1080,  label: "1080p" },
    { value: 99999, label: t("downloader.resBest") },
  ];
  const currentHint = engineOptions.find((o) => o.value === engine)?.hint;
  return (
    <div
      style={{
        padding: "28px 24px",
        borderRadius: 12,
        background: "linear-gradient(135deg, rgba(94,106,210,0.12), rgba(139,92,246,0.06))",
        border: "1px solid var(--n-3)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={14} style={{ color: "var(--accent)" }} />
        <span style={{
          fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
          textTransform: "uppercase", color: "var(--accent)",
        }}>
          {t("downloader.nav")}
        </span>
        <span style={{ flex: 1 }} />
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                          letterSpacing: "0.06em", color: "var(--n-6)" }}>
            {t("downloader.engine")}
          </span>
          <Segmented
            value={engine}
            onChange={onEngine}
            options={engineOptions.map(({ value, label }) => ({ value, label }))}
          />
        </div>
      </div>
      {currentHint && (
        <p style={{ fontSize: 11, color: "var(--n-8)", marginTop: -8, marginBottom: 12 }}>
          · {currentHint}
        </p>
      )}

      {/* Resolution row */}
      <div className="flex items-center gap-2 mb-3">
        <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                        letterSpacing: "0.06em", color: "var(--n-6)" }}>
          {t("downloader.resolution")}
        </span>
        <Segmented
          value={maxHeight}
          onChange={onMaxHeight}
          options={resOptions}
        />
      </div>
      <div
        className="flex items-center gap-2"
        style={{
          background: "var(--n-1)",
          border: `1px solid ${fetching ? "var(--accent)" : "var(--n-3)"}`,
          borderRadius: 10,
          padding: 5,
          transition: "border-color var(--dur-fast) var(--ease)",
        }}
      >
        <Link2 size={14} style={{ color: "var(--n-8)", marginLeft: 8, flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={url}
          onChange={(e) => onUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && valid && !fetching) onAnalyze(); }}
          onBlur={() => { if (valid && !fetching) onAnalyze(); }}
          disabled={disabled}
          placeholder={t("downloader.inputPlaceholder")}
          spellCheck={false}
          style={{
            flex: 1, minWidth: 0,
            background: "transparent", border: "none", outline: "none",
            padding: "10px 4px",
            fontSize: 13, color: "var(--n-10)",
            fontFamily: "var(--font-mono)",
          }}
        />
        {url && !fetching && !disabled && (
          <button
            onClick={() => onUrl("")}
            title="Clear"
            style={{
              width: 26, height: 26, border: "none", background: "transparent",
              color: "var(--n-6)", cursor: "pointer", borderRadius: 4,
            }}
          >
            <X size={12} />
          </button>
        )}
        {!disabled && (
          <Button size="sm" variant="ghost" icon={Clipboard} onClick={onPaste}>
            Paste
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          icon={fetching ? Loader2 : Sparkles}
          loading={fetching}
          disabled={!valid || disabled}
          onClick={onAnalyze}
        >
          {t("downloader.analyze")}
        </Button>
      </div>
    </div>
  );
}

// ── Preview card ─────────────────────────────────────────────
function PreviewCard({ info, preferNoWM, onTogglePreferNoWM, onDub, onFolder, t }) {
  const color = PLATFORM_COLORS[info.platform || "generic"] || "var(--n-6)";
  const mmss = formatDur(info.duration);
  return (
    <div
      style={{
        background: "var(--n-1)",
        border: "1px solid var(--n-3)",
        borderRadius: 12,
        overflow: "hidden",
        display: "grid",
        gridTemplateColumns: "180px 1fr",
        gap: 0,
      }}
    >
      {/* Thumb */}
      <div
        style={{
          height: "100%", minHeight: 120,
          background: "var(--n-2)",
          position: "relative",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {info.thumbnail ? (
          <img
            src={info.thumbnail}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : (
          <ImageIcon size={24} style={{ color: "var(--n-6)" }} />
        )}
        {mmss && (
          <div
            style={{
              position: "absolute", bottom: 8, right: 8,
              padding: "2px 6px", borderRadius: 4,
              background: "rgba(0,0,0,0.7)", color: "#fff",
              fontSize: 10, fontFamily: "var(--font-mono)",
            }}
          >
            {mmss}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="flex items-start gap-2">
          <span
            style={{
              fontSize: 10, fontWeight: 600, textTransform: "uppercase",
              letterSpacing: "0.06em",
              padding: "2px 8px", borderRadius: 4,
              background: `${color}20`,
              color: color === "#000000" ? "var(--n-10)" : color,
              flexShrink: 0,
            }}
          >
            {info.platform}
          </span>
          {info.author && (
            <span style={{ fontSize: 11, color: "var(--n-8)" }}>
              @{info.author}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <SourceBadge source={info.source} t={t} />
        </div>
        <h3
          title={info.title}
          style={{
            fontSize: 14, fontWeight: 500, color: "var(--n-10)",
            margin: 0, lineHeight: 1.4,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {info.title || "(no title)"}
        </h3>

        {/* Toggle no-watermark */}
        {(info.platform === "tiktok" || info.platform === "douyin") && (
          <label
            className="flex items-center gap-2 text-xs cursor-pointer"
            style={{ color: "var(--n-8)" }}
          >
            <input
              type="checkbox"
              checked={preferNoWM}
              onChange={onTogglePreferNoWM}
              style={{ accentColor: "var(--accent)" }}
            />
            <span>{t("downloader.preferNoWatermark")}</span>
            <span style={{ color: "var(--n-6)", fontSize: 10 }}>
              · {t("downloader.preferNoWatermarkHint")}
            </span>
          </label>
        )}

        <div className="flex items-center gap-2 mt-1">
          <Button variant="primary" size="md" icon={Wand2} onClick={onDub}>
            {t("downloader.toDub")}
          </Button>
          <Button variant="secondary" size="md" icon={Download} onClick={onFolder}>
            {t("downloader.toFolder")}
          </Button>
        </div>
        <div style={{ fontSize: 11, color: "var(--n-8)", lineHeight: 1.5 }}>
          <div>• <b>{t("downloader.toDub")}:</b> {t("downloader.toDubDesc")}</div>
          <div>• <b>{t("downloader.toFolder")}:</b> {t("downloader.toFolderDesc")}</div>
        </div>
      </div>
    </div>
  );
}

function SourceBadge({ source, t }) {
  const label = source === "scraper"
    ? t("downloader.sourceScraper")
    : t("downloader.sourceYtdlp");
  return (
    <span
      style={{
        fontSize: 10, color: "var(--n-8)",
        padding: "1px 8px", borderRadius: 4,
        border: "1px solid var(--n-3)",
        background: "var(--n-2)",
      }}
      title={label}
    >
      {label}
    </span>
  );
}

// ── Progress card ────────────────────────────────────────────
function ProgressCard({ info, progress, label, detail, onCancel, t }) {
  return (
    <div
      style={{
        background: "var(--n-1)",
        border: "1px solid var(--n-3)",
        borderRadius: 12,
        padding: 16,
        display: "flex", flexDirection: "column", gap: 10,
      }}
    >
      <div className="flex items-center gap-3">
        {info?.thumbnail && (
          <img
            src={info.thumbnail}
            alt=""
            style={{
              width: 56, height: 32, objectFit: "cover",
              borderRadius: 6, flexShrink: 0,
            }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            title={info?.title}
            style={{
              fontSize: 13, fontWeight: 500, color: "var(--n-10)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {info?.title || "…"}
          </div>
          <div style={{ fontSize: 11, color: "var(--n-8)" }}>
            {label}{detail ? ` · ${detail}` : ""}
          </div>
        </div>
        <Button variant="ghost" size="sm" icon={X} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
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
      <div className="flex items-center gap-2">
        <Loader2 size={11} className="animate-spin" style={{ color: "var(--accent)" }} />
        <span className="font-mono"
              style={{ fontSize: 11, color: "var(--n-8)", marginLeft: "auto" }}>
          {Math.round(progress)}%
        </span>
      </div>
    </div>
  );
}

// ── History table ────────────────────────────────────────────
function HistorySection({ items, onClear, onReplay, onOpenProject, onOpenFolder, t }) {
  if (!items.length) {
    return (
      <div
        style={{
          padding: "40px 20px", textAlign: "center",
          color: "var(--n-8)", fontSize: 12,
          border: "1px dashed var(--n-3)",
          borderRadius: 10,
        }}
      >
        {t("downloader.startPlaceholder")}
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span style={{
          fontSize: 10, fontWeight: 600, textTransform: "uppercase",
          letterSpacing: "0.06em", color: "var(--n-6)",
        }}>
          {t("downloader.history")}
        </span>
        <button
          onClick={onClear}
          style={{
            fontSize: 11, color: "var(--n-8)",
            background: "transparent", border: "none", cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 4,
          }}
        >
          <Trash2 size={10} /> {t("downloader.clearHistory")}
        </button>
      </div>
      <Table>
        <THead>
          <Th width={56} />
          <Th>Title</Th>
          <Th width={80}>Platform</Th>
          <Th width={80}>Thời gian</Th>
          <Th width={140} align="right"> </Th>
        </THead>
        <TBody>
          {items.map((it, idx) => (
            <Tr key={idx}>
              <Td>
                <div style={{
                  width: 44, height: 26, borderRadius: 4,
                  overflow: "hidden", background: "var(--n-2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  position: "relative",
                }}>
                  {it.thumbnail ? (
                    <img
                      src={it.thumbnail}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                  ) : (
                    <Film size={10} style={{ color: "var(--n-6)" }} />
                  )}
                </div>
              </Td>
              <Td title={it.title}>
                <span style={{ color: "var(--n-10)" }}>{it.title || "video"}</span>
                <div title={it.url} style={{
                  fontSize: 10, color: "var(--n-6)", fontFamily: "var(--font-mono)",
                  overflow: "hidden", textOverflow: "ellipsis", maxWidth: 380,
                  whiteSpace: "nowrap",
                }}>
                  {it.url}
                </div>
              </Td>
              <Td>
                <span style={{
                  fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                  padding: "2px 6px", borderRadius: 4,
                  background: `${PLATFORM_COLORS[it.platform || "generic"] || "#6c6c80"}20`,
                  color: PLATFORM_COLORS[it.platform || "generic"] || "var(--n-8)",
                }}>
                  {it.platform || "web"}
                </span>
              </Td>
              <Td>
                <span style={{ fontSize: 11, color: "var(--n-8)" }}>
                  {relTime(it.at)}
                </span>
              </Td>
              <Td align="right">
                <div className="flex items-center gap-1 justify-end">
                  {it.kind === "project" && it.project_id && (
                    <Button
                      size="sm" variant="ghost"
                      icon={Film}
                      onClick={() => onOpenProject(it.project_id)}
                    >
                      {t("downloader.openProject")}
                    </Button>
                  )}
                  {it.kind === "folder" && it.path && (
                    <Button
                      size="sm" variant="ghost"
                      icon={ExternalLink}
                      onClick={() => onOpenFolder(it.path)}
                    >
                      {t("downloader.openFolder")}
                    </Button>
                  )}
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => onReplay(it.url)}
                  >
                    <Link2 size={11} />
                  </Button>
                </div>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

// ── Login helper card ───────────────────────────────────────
function LoginNeededCard({ url, message, onOpenChrome, onRetry, onDismiss, t }) {
  return (
    <div
      style={{
        padding: 18,
        borderRadius: 12,
        background: "var(--n-1)",
        border: "1px solid var(--warn)",
        borderLeftWidth: 3,
      }}
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: "var(--n-10)",
            marginBottom: 4,
          }}>
            Video cần đăng nhập để xem
          </div>
          <p style={{ fontSize: 12, color: "var(--n-8)", lineHeight: 1.55, margin: 0 }}>
            Làm theo 3 bước:
          </p>
          <ol style={{
            margin: "6px 0 12px", paddingLeft: 18,
            fontSize: 12, color: "var(--n-9)", lineHeight: 1.7,
          }}>
            <li>Bấm <b>"Mở trong Chrome"</b> → login TikTok (hoặc platform đó)</li>
            <li>Trong Chrome bấm <kbd>⌘Q</kbd> để tắt hẳn (cookie mới unlock)</li>
            <li>Quay lại đây → bấm <b>"Thử lại"</b></li>
          </ol>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="md"
              icon={Chrome}
              onClick={onOpenChrome}
            >
              Mở trong Chrome
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={Sparkles}
              onClick={onRetry}
            >
              Thử lại
            </Button>
            <Button variant="ghost" size="md" onClick={onDismiss}>
              Bỏ qua
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── utils ────────────────────────────────────────────────────

function formatDur(s) {
  if (!s || !isFinite(s)) return null;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function relTime(ts) {
  if (!ts) return "";
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function safeName(name) {
  const keep = (name || "").replace(/[^\w \-.]/g, "_").trim();
  return keep.slice(0, 80) || "video";
}
