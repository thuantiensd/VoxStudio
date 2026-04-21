/**
 * Error system — classify mọi lỗi runtime thành object có:
 *   { kind, title, message, hint, code, status, cause, variant }
 *
 * Dùng:
 *   try { ... } catch (e) { showError(toast, e, { context: "upload" }); }
 *
 * Integrations:
 *   - api.js ném AppError từ request() khi status >= 400
 *   - BatchContext dùng showError cho pipeline error
 *   - ErrorBoundary hiển thị fallback
 *   - Global unhandledrejection → toast
 */

// ── Custom error class ────────────────────────────────────────
export class AppError extends Error {
  constructor(message, { kind = "unknown", status = 0, code = null, cause = null, data = null } = {}) {
    super(message);
    this.name = "AppError";
    this.kind = kind;        // network | timeout | auth | not_found | validation | server | pipeline | fs | electron | abort | unknown
    this.status = status;    // HTTP status, 0 nếu không phải HTTP
    this.code = code;        // backend error code nếu có
    this.cause = cause;      // raw error gốc
    this.data = data;        // payload thêm (vd: filename)
  }
}

// ── Classify — chuyển bất kỳ error nào thành descriptor ──────
// `t` là hàm i18n (optional). Nếu không có → fallback tiếng Việt.
export function classifyError(err, ctx = {}, t = null) {
  // Abort (fetch signal) — không phải lỗi thật
  if (err?.name === "AbortError" || err?.kind === "abort") {
    return null; // skip silent
  }

  const T = t || ((key, params) => FALLBACK_VI[key] || key);

  // AppError đã enriched
  if (err instanceof AppError) {
    return renderAppError(err, ctx, T);
  }

  // TypeError: Failed to fetch — network down / backend offline
  if (err?.name === "TypeError" && /fetch/i.test(err?.message || "")) {
    return {
      kind: "network",
      title: T("errors.network.title"),
      message: T("errors.network.message"),
      hint: T("errors.network.hint"),
      variant: "error",
    };
  }

  // DOMException abort
  if (err?.name === "DOMException" && err?.code === 20) {
    return null;
  }

  // SyntaxError khi JSON.parse
  if (err?.name === "SyntaxError") {
    return {
      kind: "server",
      title: T("errors.parse.title"),
      message: T("errors.parse.message"),
      hint: T("errors.parse.hint"),
      variant: "error",
    };
  }

  // Message string có từ khoá đặc thù
  const msg = String(err?.message || err || "");
  if (/timeout|timed out/i.test(msg)) {
    return {
      kind: "timeout",
      title: T("errors.timeout.title"),
      message: msg,
      hint: T("errors.timeout.hint"),
      variant: "error",
    };
  }

  // Generic
  return {
    kind: "unknown",
    title: T("errors.unknown.title"),
    message: msg || T("errors.unknown.message"),
    hint: null,
    variant: "error",
  };
}

function renderAppError(err, ctx, T) {
  const base = {
    kind: err.kind,
    message: err.message,
    variant: "error",
  };

  switch (err.kind) {
    case "network":
      return { ...base,
        title: T("errors.network.title"),
        message: T("errors.network.message"),
        hint: T("errors.network.hint") };

    case "timeout":
      return { ...base,
        title: T("errors.timeout.title"),
        hint: T("errors.timeout.hint") };

    case "auth":
      return { ...base,
        title: T("errors.auth.title"),
        message: err.message || T("errors.auth.message"),
        hint: T("errors.auth.hint") };

    case "not_found":
      return { ...base,
        title: T("errors.notFound.title"),
        message: err.message || T("errors.notFound.message"),
        hint: null };

    case "validation":
      return { ...base,
        title: T("errors.validation.title"),
        hint: null,
        variant: "warn" };

    case "server":
      return { ...base,
        title: T("errors.server.title"),
        hint: T("errors.server.hint") };

    case "pipeline":
      return { ...base,
        title: T("errors.pipeline.title"),
        hint: err.data?.step ? T("errors.pipeline.hintAt", { step: err.data.step })
                             : T("errors.pipeline.hint") };

    case "fs":
      return { ...base,
        title: T("errors.fs.title"),
        hint: T("errors.fs.hint") };

    case "electron":
      return { ...base,
        title: T("errors.electron.title"),
        hint: T("errors.electron.hint") };

    default:
      return { ...base, title: T("errors.unknown.title") };
  }
}

// ── Helper: show via toast ────────────────────────────────────
export function showError(toast, err, ctx = {}, t = null) {
  const info = classifyError(err, ctx, t);
  if (!info) return; // silent (abort)
  const body = info.hint
    ? `${info.message}\n${info.hint}`
    : info.message;
  toast[info.variant || "error"](body, { title: info.title });
  // eslint-disable-next-line no-console
  console.error("[VoxStudio]", info.kind, info.title, err);
}

// ── Factory shortcuts dùng trong api.js ─────────────────────
export function fromResponse(res, detail) {
  const kind =
    res.status === 401 || res.status === 403 ? "auth"
  : res.status === 404                        ? "not_found"
  : res.status === 408 || res.status === 504  ? "timeout"
  : res.status === 422 || res.status === 400  ? "validation"
  : res.status >= 500                         ? "server"
  : "unknown";
  return new AppError(detail || res.statusText || `HTTP ${res.status}`, {
    kind, status: res.status,
  });
}

// ── Fallback messages (VI) — dùng khi i18n chưa init ─────────
const FALLBACK_VI = {
  "errors.network.title":    "Mất kết nối",
  "errors.network.message":  "Không thể kết nối tới máy chủ xử lý.",
  "errors.network.hint":     "Kiểm tra VITE_API_URL, backend uvicorn hoặc tunnel ngrok.",
  "errors.timeout.title":    "Hết thời gian",
  "errors.timeout.hint":     "Server phản hồi quá lâu. Thử lại hoặc kiểm tra tải GPU.",
  "errors.auth.title":       "Không có quyền",
  "errors.auth.message":     "Session đã hết hạn hoặc sai credential.",
  "errors.auth.hint":        "Đăng nhập lại để tiếp tục.",
  "errors.notFound.title":   "Không tìm thấy",
  "errors.notFound.message": "Tài nguyên không còn tồn tại.",
  "errors.validation.title": "Dữ liệu chưa hợp lệ",
  "errors.server.title":     "Lỗi máy chủ",
  "errors.server.hint":      "Kiểm tra log server. Nếu tiếp diễn, khởi động lại backend.",
  "errors.pipeline.title":   "Pipeline lỗi",
  "errors.pipeline.hint":    "Đã dừng giữa chừng — check log và thử lại.",
  "errors.pipeline.hintAt":  "Dừng tại bước: {step}",
  "errors.fs.title":         "Lỗi file",
  "errors.fs.hint":          "Kiểm tra quyền ghi + dung lượng ổ đĩa.",
  "errors.electron.title":   "Electron IPC lỗi",
  "errors.electron.hint":    "Thoát app và mở lại để nạp lại handler.",
  "errors.parse.title":      "Response không hợp lệ",
  "errors.parse.message":    "Server trả dữ liệu không phải JSON.",
  "errors.parse.hint":       "Có thể backend đang trả HTML (ngrok warning?) — kiểm tra header.",
  "errors.unknown.title":    "Có lỗi xảy ra",
  "errors.unknown.message":  "Không xác định được nguyên nhân.",
};
