import { useEffect } from "react";
import { useToast } from "./Toast";
import { showError } from "../../services/errors";
import { useT } from "../../i18n/I18nContext";

/**
 * GlobalErrorHook — lắng nghe mọi error chưa catch ở renderer.
 *
 * - unhandledrejection: Promise.reject không có .catch
 * - window.error: JS runtime error
 *
 * Cả 2 đều convert qua classifyError rồi hiện Toast, để user không bao giờ
 * thấy "silent" lỗi.
 */
export default function GlobalErrorHook() {
  const toast = useToast();
  const t = useT();

  useEffect(() => {
    const onReject = (e) => {
      const reason = e?.reason ?? e;
      // Skip abort silently
      if (reason?.name === "AbortError" || reason?.kind === "abort") return;
      e.preventDefault();
      showError(toast, reason, { context: "unhandled" }, t);
    };
    const onError = (e) => {
      // eslint-disable-next-line no-console
      console.error("[window.error]", e.error || e.message);
      showError(toast, e.error || new Error(e.message || "Script error"), {
        context: "window",
      }, t);
    };
    window.addEventListener("unhandledrejection", onReject);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onReject);
      window.removeEventListener("error", onError);
    };
  }, [toast, t]);

  return null;
}
