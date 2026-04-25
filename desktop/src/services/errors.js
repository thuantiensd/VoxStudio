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

// ── Upgrade modal opener — đăng ký từ UpgradeProvider lúc mount ─────
let _upgradeOpener = null;
export function setUpgradeOpener(fn) { _upgradeOpener = fn; }

// ── Helper: show via toast ────────────────────────────────────
export function showError(toast, err, ctx = {}, t = null) {
  // Lỗi quota → bật paywall modal thay vì toast inline.
  if (isQuotaError(err) && _upgradeOpener) {
    _upgradeOpener(err?.message || null);
    // eslint-disable-next-line no-console
    console.warn("[VoxStudio] quota exceeded:", err?.message);
    return;
  }
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
  : res.status === 402 || res.status === 429 ? "quota"
  : res.status === 404                        ? "not_found"
  : res.status === 408 || res.status === 504  ? "timeout"
  : res.status === 422 || res.status === 400  ? "validation"
  : res.status >= 500                         ? "server"
  : "unknown";
  return new AppError(detail || res.statusText || `HTTP ${res.status}`, {
    kind, status: res.status,
  });
}

/**
 * Heuristic: lỗi có phải quota/paywall không. Backend chưa nhất quán status
 * code → fallback match keyword trong message. Dùng để bật UpgradeModal
 * thay vì hiện toast/inline.
 */
export function isQuotaError(err) {
  if (!err) return false;
  if (err.kind === "quota") return true;
  if (err.status === 402 || err.status === 429) return true;
  const m = String(err.message || "").toLowerCase();
  return /lượt|hết\s*hạn|đã dùng \d+\/\d+|quota.*exceed|rate.?limit|usage.*limit/i.test(m);
}

// ── Fallback messages (VI) — dùng khi i18n chưa init ─────────
// LƯU Ý: Đây là chuỗi hiện cho người dùng cuối. TUYỆT ĐỐI không leak thuật
// ngữ kỹ thuật (uvicorn, ngrok, VITE_API_URL, GPU, IPC, backend, handler…).
// Chi tiết kỹ thuật chỉ log qua console.error.
const FALLBACK_VI = {
  "errors.network.title":    "Mất kết nối",
  "errors.network.message":  "Không thể kết nối tới dịch vụ xử lý.",
  "errors.network.hint":     "Kiểm tra kết nối mạng và thử lại sau ít phút.",
  "errors.timeout.title":    "Quá thời gian chờ",
  "errors.timeout.hint":     "Dịch vụ đang bận. Vui lòng thử lại.",
  "errors.auth.title":       "Cần đăng nhập lại",
  "errors.auth.message":     "Phiên của bạn đã hết hạn.",
  "errors.auth.hint":        "Hãy đăng nhập lại để tiếp tục.",
  "errors.notFound.title":   "Không tìm thấy",
  "errors.notFound.message": "Nội dung bạn yêu cầu không còn tồn tại.",
  "errors.validation.title": "Dữ liệu chưa hợp lệ",
  "errors.server.title":     "Dịch vụ tạm gián đoạn",
  "errors.server.hint":      "Chúng tôi đang khắc phục. Vui lòng thử lại sau vài phút.",
  "errors.pipeline.title":   "Xử lý bị gián đoạn",
  "errors.pipeline.hint":    "Đã dừng giữa chừng — vui lòng thử lại.",
  "errors.pipeline.hintAt":  "Dừng tại bước: {step}",
  "errors.fs.title":         "Lỗi lưu file",
  "errors.fs.hint":          "Kiểm tra quyền ghi và dung lượng ổ đĩa còn trống.",
  "errors.electron.title":   "Ứng dụng gặp sự cố",
  "errors.electron.hint":    "Vui lòng thoát và mở lại ứng dụng.",
  "errors.parse.title":      "Dữ liệu trả về không hợp lệ",
  "errors.parse.message":    "Không đọc được phản hồi từ dịch vụ.",
  "errors.parse.hint":       "Vui lòng thử lại. Nếu vẫn lỗi, khởi động lại ứng dụng.",
  "errors.unknown.title":    "Đã xảy ra lỗi",
  "errors.unknown.message":  "Vui lòng thử lại. Nếu vẫn tiếp diễn, thoát và mở lại ứng dụng.",
};
