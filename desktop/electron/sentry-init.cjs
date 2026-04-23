/**
 * Sentry init cho Electron main process.
 *
 * Nếu SENTRY_DSN không set → skip init (dev / self-host). Không crash.
 * User/team nào muốn bật observability chỉ cần:
 *   SENTRY_DSN=https://xxx@oXXX.ingest.sentry.io/YYY npm run electron:dev
 * hoặc set trong electron-builder env khi build production.
 */
const { app } = require("electron");

function initSentry() {
  const dsn = process.env.SENTRY_DSN || process.env.VOX_SENTRY_DSN || "";
  if (!dsn) {
    console.log("[sentry] SENTRY_DSN không có — skip init");
    return;
  }
  try {
    const Sentry = require("@sentry/electron/main");
    Sentry.init({
      dsn,
      release: `voxstudio@${app.getVersion()}`,
      environment: app.isPackaged ? "production" : "development",
      tracesSampleRate: 0,   // performance tracing off để giảm event volume
      sampleRate: 1.0,       // 100% error capture
      // Lọc PII — không gửi user input, chỉ stack trace + app context
      beforeSend(event, hint) {
        // Xoá content body từ breadcrumbs (có thể chứa text user nhập)
        if (event.breadcrumbs) {
          event.breadcrumbs = event.breadcrumbs.map((b) => ({
            ...b,
            data: b.data ? { ...b.data, body: undefined, data: undefined } : b.data,
          }));
        }
        return event;
      },
    });
    console.log("[sentry] main process initialized");
  } catch (e) {
    console.warn("[sentry] main init failed:", e.message);
  }
}

module.exports = { initSentry };
