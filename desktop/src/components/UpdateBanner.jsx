import { useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";

/**
 * UpdateBanner — hiện khi electron-updater tìm thấy hoặc tải xong bản
 * mới. Ẩn khi không có / không phải Electron / user dismiss.
 *
 * State machine:
 *   none        → không hiện
 *   available   → 'Đang tải bản X…' với progress bar
 *   downloaded  → 'Bản X sẵn sàng' + nút 'Cập nhật & khởi động lại'
 *   error       → ẩn (user sẽ check lại lần mở app sau)
 */
export default function UpdateBanner() {
  const [state, setState] = useState("none");
  const [version, setVersion] = useState("");
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!window.voxstudio?.updater?.onEvent) return;
    const u = window.voxstudio.updater;
    const subs = [
      u.onEvent("update:available", (p) => {
        setVersion(p?.version || "");
        setState("available");
        setDismissed(false);
      }),
      u.onEvent("update:progress", (p) => {
        setProgress(p?.percent || 0);
      }),
      u.onEvent("update:downloaded", (p) => {
        setVersion(p?.version || "");
        setState("downloaded");
        setDismissed(false);
      }),
      u.onEvent("update:error", () => {
        // silent — không phiền user
        setState("none");
      }),
    ];
    return () => subs.forEach((off) => off && off());
  }, []);

  if (dismissed || state === "none") return null;

  const install = () => window.voxstudio?.updater?.quitAndInstall?.();

  return (
    <div
      style={{
        position: "fixed",
        bottom: 20, right: 20,
        zIndex: 180,
        width: 320,
        padding: 14,
        borderRadius: 10,
        background: "var(--n-1)",
        border: "1px solid var(--accent)",
        boxShadow: "0 8px 24px rgba(108,92,231,0.25)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div
          style={{
            width: 32, height: 32, borderRadius: 8,
            background: "var(--accent-soft)", color: "var(--accent)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {state === "downloaded"
            ? <RefreshCw size={14} />
            : <Download size={14} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--n-10)" }}>
            {state === "downloaded"
              ? `Bản mới ${version} sẵn sàng`
              : `Đang tải bản ${version}…`}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--n-8)", marginTop: 2, lineHeight: 1.4 }}>
            {state === "downloaded"
              ? "Khởi động lại để cập nhật — mọi thiết lập giữ nguyên."
              : `Đã tải ${progress}%. Bạn có thể tiếp tục làm việc.`}
          </div>

          {state === "available" && (
            <div
              style={{
                marginTop: 8,
                height: 4,
                borderRadius: 2,
                background: "var(--n-3)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: "100%",
                  background: "var(--accent)",
                  transition: "width 200ms linear",
                }}
              />
            </div>
          )}

          {state === "downloaded" && (
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button
                onClick={install}
                style={{
                  flex: 1, height: 30,
                  background: "var(--accent)", color: "#fff",
                  border: "none", borderRadius: 6,
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >
                Cập nhật ngay
              </button>
              <button
                onClick={() => setDismissed(true)}
                style={{
                  height: 30, padding: "0 10px",
                  background: "transparent", color: "var(--n-8)",
                  border: "1px solid var(--n-3)", borderRadius: 6,
                  fontSize: 12, cursor: "pointer",
                }}
              >
                Để sau
              </button>
            </div>
          )}
        </div>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Đóng"
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: "var(--n-7)", padding: 2,
          }}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
