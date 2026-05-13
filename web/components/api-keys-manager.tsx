"use client";

/**
 * API Keys Manager — modal cho user lưu + test BYOK keys server-side.
 *
 * Hỗ trợ 5 provider: Gemini, OpenAI, Claude, DeepL, Google Cloud.
 * Key lưu encrypted server-side (Fernet) → reuse cho mọi project.
 *
 * Usage:
 *   <ApiKeysManager open={open} onClose={() => setOpen(false)} />
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  listUserApiKeys,
  setUserApiKey,
  testUserApiKey,
  deleteUserApiKey,
  type UserApiKeyInfo,
} from "@/lib/api";

const PROVIDERS: Array<{
  id: string;
  label: string;
  placeholder: string;
  hint: string;
}> = [
  {
    id: "gemini",
    label: "Google Gemini",
    placeholder: "AIza...",
    hint: "Lấy tại Google AI Studio → API keys",
  },
  {
    id: "openai",
    label: "OpenAI (GPT)",
    placeholder: "sk-...",
    hint: "Lấy tại platform.openai.com → API keys",
  },
  {
    id: "claude",
    label: "Anthropic Claude",
    placeholder: "sk-ant-...",
    hint: "Lấy tại console.anthropic.com → API keys",
  },
  {
    id: "deepl",
    label: "DeepL",
    placeholder: "xxxxx:fx (free) hoặc xxxxx (pro)",
    hint: "Lấy tại deepl.com/pro-account → Authentication",
  },
  {
    id: "google_cloud",
    label: "Google Cloud Translate",
    placeholder: "AIza...",
    hint: "Lấy tại Google Cloud Console → APIs & Services → Credentials",
  },
];

type ProviderState = {
  inputValue: string;
  hasSavedKey: boolean;
  testStatus: "untested" | "ok" | "invalid" | "error";
  testMessage: string;
  lastTestedAt: string | null;
  showInput: boolean;
  saving: boolean;
  testing: boolean;
};

const defaultState = (): ProviderState => ({
  inputValue: "",
  hasSavedKey: false,
  testStatus: "untested",
  testMessage: "",
  lastTestedAt: null,
  showInput: false,
  saving: false,
  testing: false,
});

export function ApiKeysManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [states, setStates] = useState<Record<string, ProviderState>>(() =>
    Object.fromEntries(PROVIDERS.map((p) => [p.id, defaultState()])),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load existing keys khi modal mở
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await listUserApiKeys();
      const next = { ...states };
      for (const p of PROVIDERS) {
        const existing = r.keys.find((k) => k.provider === p.id);
        next[p.id] = {
          ...defaultState(),
          hasSavedKey: existing?.has_key || false,
          testStatus: existing?.test_status || "untested",
          testMessage: existing?.test_message || "",
          lastTestedAt: existing?.last_tested_at || null,
        };
      }
      setStates(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tải danh sách keys thất bại");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const update = (id: string, patch: Partial<ProviderState>) => {
    setStates((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  };

  const handleSave = async (id: string) => {
    const st = states[id];
    if (!st.inputValue.trim() || st.inputValue.trim().length < 8) {
      update(id, { testStatus: "error", testMessage: "Key quá ngắn" });
      return;
    }
    update(id, { saving: true });
    try {
      const r = await setUserApiKey(id, st.inputValue.trim());
      update(id, {
        hasSavedKey: r.key.has_key,
        inputValue: "",
        showInput: false,
        testStatus: r.key.test_status as ProviderState["testStatus"],
        testMessage: "Đã lưu — bấm Test để verify",
        saving: false,
      });
    } catch (e) {
      update(id, {
        saving: false,
        testStatus: "error",
        testMessage: e instanceof Error ? e.message : "Lưu thất bại",
      });
    }
  };

  const handleTest = async (id: string) => {
    const st = states[id];
    update(id, { testing: true, testMessage: "Đang test..." });
    try {
      // Nếu user đang nhập input → test key đó. Nếu không → test key đã lưu.
      const keyToTest = st.inputValue.trim() || undefined;
      // Kèm model mặc định cho LLM provider để check luôn quyền truy cập
      // (vd key OpenAI valid nhưng account chưa được cấp quyền gpt-5).
      const defaultModel: Record<string, string> = {
        openai: "gpt-5",
        claude: "claude-opus-4-5",
        gemini: "gemini-2.5-pro",
      };
      const r = await testUserApiKey(id, keyToTest, defaultModel[id]);
      update(id, {
        testing: false,
        testStatus: r.ok ? "ok" : "invalid",
        testMessage: r.message,
      });
    } catch (e) {
      update(id, {
        testing: false,
        testStatus: "error",
        testMessage: e instanceof Error ? e.message : "Test thất bại",
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Xoá API key cho ${id}?`)) return;
    try {
      await deleteUserApiKey(id);
      update(id, {
        hasSavedKey: false,
        inputValue: "",
        showInput: false,
        testStatus: "untested",
        testMessage: "",
        lastTestedAt: null,
      });
    } catch (e) {
      update(id, {
        testStatus: "error",
        testMessage: e instanceof Error ? e.message : "Xoá thất bại",
      });
    }
  };

  if (!mounted || !open) return null;

  const badge = (status: ProviderState["testStatus"]) => {
    if (status === "ok") return { color: "bg-green-500/20 text-green-300 border-green-500/40", label: "🟢 Hợp lệ" };
    if (status === "invalid") return { color: "bg-red-500/20 text-red-300 border-red-500/40", label: "🔴 Sai" };
    if (status === "error") return { color: "bg-amber-500/20 text-amber-300 border-amber-500/40", label: "⚠️ Lỗi" };
    return { color: "bg-muted/40 text-muted-foreground border-border/60", label: "⚪ Chưa test" };
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-border/60 bg-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div>
            <h2 className="text-base font-bold">🔑 Quản lý API Keys</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Key được mã hoá lưu trên server — không phải nhập lại mỗi lần dùng.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-muted/30"
            aria-label="Đóng"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
          {loading && (
            <div className="text-center text-xs text-muted-foreground py-4">Đang tải...</div>
          )}

          {PROVIDERS.map((p) => {
            const st = states[p.id];
            const b = badge(st.testStatus);
            return (
              <div
                key={p.id}
                className="rounded-lg border border-border/60 bg-background p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{p.label}</span>
                      <span className={`rounded-md border px-1.5 py-0.5 text-[10px] ${b.color}`}>
                        {b.label}
                      </span>
                      {st.hasSavedKey && (
                        <span className="rounded-md border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-300">
                          💾 Đã lưu
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[10.5px] text-muted-foreground">{p.hint}</p>
                  </div>
                </div>

                {/* Input + actions */}
                {(st.showInput || !st.hasSavedKey) && (
                  <div className="mt-3 space-y-2">
                    <input
                      type="password"
                      value={st.inputValue}
                      onChange={(e) => update(p.id, { inputValue: e.target.value })}
                      placeholder={p.placeholder}
                      className="w-full rounded-md border border-border/60 bg-background px-3 py-2 font-mono text-xs outline-none focus:border-primary/50"
                    />
                    {st.testMessage && (
                      <p className="text-[11px] text-muted-foreground">{st.testMessage}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleSave(p.id)}
                        disabled={st.saving || !st.inputValue.trim()}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        {st.saving ? "Đang lưu..." : "💾 Lưu"}
                      </button>
                      <button
                        onClick={() => handleTest(p.id)}
                        disabled={st.testing || (!st.inputValue.trim() && !st.hasSavedKey)}
                        className="rounded-md border border-border/60 px-3 py-1.5 text-xs hover:bg-muted/30 disabled:opacity-50"
                      >
                        {st.testing ? "Đang test..." : "🧪 Test"}
                      </button>
                      {st.showInput && (
                        <button
                          onClick={() => update(p.id, { showInput: false, inputValue: "" })}
                          className="rounded-md border border-border/60 px-3 py-1.5 text-xs hover:bg-muted/30"
                        >
                          Huỷ
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Actions khi đã có key + không show input */}
                {st.hasSavedKey && !st.showInput && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => handleTest(p.id)}
                      disabled={st.testing}
                      className="rounded-md border border-border/60 px-3 py-1.5 text-xs hover:bg-muted/30 disabled:opacity-50"
                    >
                      {st.testing ? "Đang test..." : "🧪 Test key đã lưu"}
                    </button>
                    <button
                      onClick={() => update(p.id, { showInput: true })}
                      className="rounded-md border border-border/60 px-3 py-1.5 text-xs hover:bg-muted/30"
                    >
                      ✏️ Đổi key
                    </button>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
                    >
                      🗑️ Xoá
                    </button>
                    {st.testMessage && (
                      <span className="text-[11px] text-muted-foreground self-center">
                        {st.testMessage}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-border/60 bg-background/40 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-lg bg-foreground px-4 py-1.5 text-sm font-bold text-background hover:opacity-90"
          >
            Xong
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
