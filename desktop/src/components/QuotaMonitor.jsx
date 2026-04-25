import { useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "./ui/Toast";
import { fetchMe } from "../services/api";
import { useT } from "../i18n/I18nContext";

/**
 * QuotaMonitor — poll /auth/me định kỳ, toast khi user dùng gần hết
 * quota (>= 80%) hoặc đã hết (>= 100%). Mỗi cảnh báo chỉ hiện 1 lần /
 * phiên để không spam.
 *
 * Mount ở App level (bên trong AuthProvider).
 */
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 phút
const WARN_KEY_PREFIX = "voxstudio:quota-warned:";
// Device-level storage — không scope per-user vì reset theo phiên app.

const METRIC_DEFS = [
  { key: "dubbing", labelKey: "quota.dubbingMinutes", unitKey: "quota.minutes",
    usage: (u) => u.dubbing_min || 0, limit: (lim) => lim.dubbing_min_month },
  { key: "stt", labelKey: "quota.subtitleMinutes", unitKey: "quota.minutes",
    usage: (u) => u.stt_min || 0, limit: (lim) => lim.stt_min_month },
  { key: "tts", labelKey: "quota.ttsChars", unitKey: "quota.chars",
    usage: (u) => u.tts_chars || 0, limit: (lim) => lim.tts_chars_month },
];

export default function QuotaMonitor() {
  const { isAuthenticated, token } = useAuth();
  const toast = useToast();
  const t = useT();
  const warnedRef = useRef(new Set()); // tracking session, không persist

  useEffect(() => {
    if (!isAuthenticated) return;
    let stopped = false;

    const checkOnce = async () => {
      try {
        const me = await fetchMe();
        const usage = me?.usage_month || {};
        const limits = me?.plan?.limits || {};
        const planId = (me?.plan?.id || "").toLowerCase();
        const planKey = `auth.plan.${planId}`;
        const planTr = planId ? t(planKey) : "";
        const planName = (planTr && planTr !== planKey) ? planTr : (me?.plan?.name || "");

        for (const m of METRIC_DEFS) {
          const used = m.usage(usage);
          const limit = m.limit(limits);
          if (limit === -1 || !limit) continue;
          const pct = used / limit;
          const keyHit  = `${m.key}:100`;
          const keyWarn = `${m.key}:80`;
          const label = t(m.labelKey).toLowerCase();
          const unit = t(m.unitKey);

          if (pct >= 1 && !warnedRef.current.has(keyHit)) {
            warnedRef.current.add(keyHit);
            warnedRef.current.add(keyWarn);
            toast?.error?.(
              t("quota.exceededMsg", { limit: limit.toLocaleString(), unit, label, plan: planName }),
              { title: t("quota.exceeded") },
            );
          } else if (pct >= 0.8 && !warnedRef.current.has(keyWarn)) {
            warnedRef.current.add(keyWarn);
            const remaining = Math.max(0, limit - used);
            toast?.warn?.(
              t("quota.warningMsg", { remaining: remaining.toLocaleString(), limit: limit.toLocaleString(), unit, label }),
              { title: t("quota.warning") },
            );
          }
        }
      } catch {
        // silent
      }
    };

    // Delay 3s để UI load xong rồi mới check
    const initTimer = setTimeout(() => {
      if (!stopped) checkOnce();
    }, 3000);
    const iv = setInterval(() => { if (!stopped) checkOnce(); }, CHECK_INTERVAL_MS);

    return () => {
      stopped = true;
      clearTimeout(initTimer);
      clearInterval(iv);
    };
  }, [isAuthenticated, token, toast, t]);

  // Reset warn set khi logout (token đổi null)
  useEffect(() => {
    if (!isAuthenticated) warnedRef.current.clear();
  }, [isAuthenticated]);

  return null;
}
