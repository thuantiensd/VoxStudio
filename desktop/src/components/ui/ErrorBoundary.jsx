import { Component } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import Button from "./Button";

/**
 * ErrorBoundary — bắt mọi runtime error của React tree bên trong.
 * Hiển thị fallback full-screen có thông tin lỗi + nút Reload / Reset.
 * Không dùng cho network/backend error (đã có toast lo) — chỉ cho React crash.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info);
    this.setState({ info });
  }

  reset = () => {
    this.setState({ error: null, info: null });
  };

  reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    const msg = this.state.error?.message || "Unknown error";
    const stack = this.state.error?.stack || "";
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "var(--n-0)",
          color: "var(--n-10)",
          padding: 40,
        }}
      >
        <div
          style={{
            maxWidth: 520,
            width: "100%",
            background: "var(--n-1)",
            border: "1px solid var(--n-3)",
            borderRadius: 12,
            padding: 28,
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 48, height: 48, borderRadius: "50%",
              background: "rgba(248,81,73,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <AlertTriangle size={22} style={{ color: "var(--err)" }} />
          </div>
          <h2 style={{
            fontSize: 18, fontWeight: 600, margin: 0, color: "var(--n-10)",
            letterSpacing: "var(--tr-tight)",
          }}>
            Ứng dụng gặp lỗi
          </h2>
          <p style={{
            fontSize: 13, color: "var(--n-8)",
            marginTop: 8, marginBottom: 4,
          }}>
            {msg}
          </p>
          <p style={{ fontSize: 11, color: "var(--n-6)", marginBottom: 20 }}>
            App has crashed · Thử Reload hoặc báo lại lỗi nếu lặp lại.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <Button variant="secondary" size="md" onClick={this.reset}>
              Tiếp tục
            </Button>
            <Button variant="primary" size="md" icon={RefreshCw} onClick={this.reload}>
              Reload app
            </Button>
          </div>
          {stack && (
            <details style={{
              marginTop: 18, textAlign: "left",
              fontSize: 11, color: "var(--n-6)",
            }}>
              <summary style={{ cursor: "pointer", color: "var(--n-8)" }}>
                Stack trace
              </summary>
              <pre
                className="font-mono"
                style={{
                  marginTop: 8, padding: 10,
                  background: "var(--n-0)",
                  border: "1px solid var(--n-3)",
                  borderRadius: 6,
                  maxHeight: 240, overflow: "auto",
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}
              >
                {stack}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}
