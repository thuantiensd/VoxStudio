/**
 * Sentry init cho renderer (React app).
 * Import sớm nhất ở main.jsx. Skip nếu VITE_SENTRY_DSN không có.
 */
import * as Sentry from "@sentry/react";

const dsn = import.meta.env.VITE_SENTRY_DSN || "";

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE || "development",
    release: `voxstudio-desktop@${import.meta.env.VITE_APP_VERSION || "0.1.0"}`,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Không gửi PII
    sendDefaultPii: false,
    beforeSend(event) {
      // Lọc request body / formData khỏi breadcrumbs + event
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => {
          if (b.data && (b.data.body || b.data.data)) {
            const { body, data, ...rest } = b.data;
            return { ...b, data: rest };
          }
          return b;
        });
      }
      return event;
    },
  });
  // eslint-disable-next-line no-console
  console.log("[sentry] renderer initialized");
}

/**
 * Gắn user context sau khi login. Chỉ gửi id — không gửi email/name
 * để tránh PII. Gọi từ AuthContext sau login.
 */
export function setSentryUser(userId) {
  if (!dsn) return;
  try {
    if (userId) Sentry.setUser({ id: String(userId) });
    else Sentry.setUser(null);
  } catch {}
}

export default Sentry;
