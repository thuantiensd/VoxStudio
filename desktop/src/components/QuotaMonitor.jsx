import { useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "./ui/Toast";
import { fetchMe } from "../services/api";

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

const METRICS = [
  {
    key: "dubbing",
    label: "Phút lồng tiếng",
    usage: (u) => u.dubbing_min || 0,
    limit: (lim) => lim.dubbing_min_month,
    unit: "phút",
  },
  {
    key: "stt",
    label: "Phút phụ đề (STT)",
    usage: (u) => u.stt_min || 0,
    limit: (lim) => lim.stt_min_month,
    unit: "phút",
  },
  {
    key: "tts",
    label: "Ký tự TTS",
    usage: (u) => u.tts_chars || 0,
    limit: (lim) => lim.tts_chars_month,
    unit: "ký tự",
  },
];

export default function QuotaMonitor() {
  const { isAuthenticated, token } = useAuth();
  const toast = useToast();
  const warnedRef = useRef(new Set()); // tracking session, không persist

  useEffect(() => {
    if (!isAuthenticated) return;
    let stopped = false;

    const checkOnce = async () => {
      try {
        const me = await fetchMe();
        const usage = me?.usage_month || {};
        const limits = me?.plan?.limits || {};
        const planName = me?.plan?.name || "";

        for (const m of METRICS) {
          const used = m.usage(usage);
          const limit = m.limit(limits);
          if (limit === -1 || !limit) continue; // unlimited hoặc không có
          const pct = used / limit;
          const keyHit  = `${m.key}:100`;
          const keyWarn = `${m.key}:80`;

          if (pct >= 1 && !warnedRef.current.has(keyHit)) {
            warnedRef.current.add(keyHit);
            warnedRef.current.add(keyWarn); // skip warn level nếu đã hết
            toast?.error?.(
              `Bạn đã dùng hết ${limit.toLocaleString()} ${m.unit} ${m.label.toLowerCase()} trong gói ${planName} tháng này. Nâng cấp để tiếp tục.`,
              { title: "Đã hết hạn mức" },
            );
          } else if (pct >= 0.8 && !warnedRef.current.has(keyWarn)) {
            warnedRef.current.add(keyWarn);
            const remaining = Math.max(0, limit - used);
            toast?.warn?.(
              `Còn ${remaining.toLocaleString()}/${limit.toLocaleString()} ${m.unit} ${m.label.toLowerCase()}. Cân nhắc nâng cấp gói.`,
              { title: "Sắp hết hạn mức" },
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
  }, [isAuthenticated, token, toast]);

  // Reset warn set khi logout (token đổi null)
  useEffect(() => {
    if (!isAuthenticated) warnedRef.current.clear();
  }, [isAuthenticated]);

  return null;
}
