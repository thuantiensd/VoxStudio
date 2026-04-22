import { useEffect, useState } from "react";
import {
  Key, Eye, EyeOff, Check, X, ShieldCheck, ShieldAlert,
  ExternalLink, Loader2, Trash2, Save,
} from "lucide-react";
import { listKeys, getKey, setKey, isSecureBackend } from "../../services/keyvault";
import { translateTexts } from "../../services/api";
import { useToast } from "../../components/ui/Toast";

/* ─────────────────────────────────────────────────────────
   Settings → AI & API keys
   Paste keys cho các dịch vụ translate/LLM. Electron: lưu
   qua OS Keychain. Web: fallback localStorage (cảnh báo).
   Test mỗi key bằng 1 câu dịch thử.
   ───────────────────────────────────────────────────────── */

const PROVIDERS = [
  {
    id: "openai", name: "OpenAI (GPT)",
    hint: "Dùng cho translate + polish (mặc định gpt-4o-mini).",
    link: "https://platform.openai.com/api-keys",
    placeholder: "sk-proj-…",
  },
  {
    id: "claude", name: "Anthropic Claude",
    hint: "Translate + polish (claude-3-5-haiku).",
    link: "https://console.anthropic.com/settings/keys",
    placeholder: "sk-ant-api…",
  },
  {
    id: "gemini", name: "Google Gemini",
    hint: "Translate + reasoning (gemini-1.5-flash).",
    link: "https://aistudio.google.com/apikey",
    placeholder: "AIza…",
  },
  {
    id: "deepl", name: "DeepL",
    hint: "Máy dịch chất lượng cao. Free tier có giới hạn.",
    link: "https://www.deepl.com/account/summary",
    placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx",
  },
  {
    id: "google_cloud", name: "Google Cloud Translate",
    hint: "Chất lượng cao, độ chính xác tốt. Cần đăng ký tài khoản Google Cloud.",
    link: "https://console.cloud.google.com/apis/credentials",
    placeholder: "AIza…",
  },
];

export default function IntegrationsTab() {
  const toast = useToast();
  const secure = isSecureBackend();
  const [saved, setSaved] = useState({});  // {id: bool}
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const { ids } = await listKeys();
      setSaved(ids || {});
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  return (
    <div>
      {/* Banner */}
      <div
        style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          padding: 12, borderRadius: 8,
          background: secure ? "rgba(34,197,94,0.08)" : "rgba(251,191,36,0.10)",
          border: `1px solid ${secure ? "rgba(34,197,94,0.25)" : "rgba(251,191,36,0.3)"}`,
          marginBottom: 24,
        }}
      >
        {secure
          ? <ShieldCheck size={16} style={{ color: "#22c55e", flexShrink: 0, marginTop: 1 }} />
          : <ShieldAlert  size={16} style={{ color: "#f59e0b", flexShrink: 0, marginTop: 1 }} />}
        <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--n-9)" }}>
          {secure ? (
            <>
              <b>Được mã hoá an toàn trên máy bạn.</b> Key chỉ lưu cục bộ,
              không bao giờ được gửi đến chúng tôi. Khi dịch, key được gửi
              trực tiếp tới nhà cung cấp bạn chọn (OpenAI / Claude / DeepL …)
              qua kết nối mã hoá HTTPS.
            </>
          ) : (
            <>
              <b>Phiên bản trình duyệt — key chưa được mã hoá.</b>
              Chỉ nên dùng tạm để thử. Hãy dùng app desktop để key được bảo
              vệ bằng kho khoá an toàn của hệ điều hành.
            </>
          )}
        </div>
      </div>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8,
                       color: "var(--n-8)", fontSize: 13 }}>
          <Loader2 size={14} className="animate-spin" /> Đang đọc vault…
        </div>
      )}

      {!loading && PROVIDERS.map((p) => (
        <ProviderRow key={p.id} provider={p}
                      hasKey={!!saved[p.id]}
                      onChanged={refresh}
                      toast={toast} />
      ))}
    </div>
  );
}

function ProviderRow({ provider, hasKey, onChanged, toast }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // 'ok' | 'fail'

  async function startEdit() {
    const cur = await getKey(provider.id);
    setValue(cur || "");
    setEditing(true);
    setTestResult(null);
  }

  async function save() {
    setLoading(true);
    try {
      await setKey(provider.id, value.trim());
      toast.success(provider.name, { title: "Đã lưu" });
      setEditing(false);
      onChanged?.();
    } catch (e) {
      toast.error(e?.message || "Không lưu được key.", { title: "Lỗi lưu key" });
    } finally {
      setLoading(false);
    }
  }

  async function remove() {
    if (!confirm(`Xoá API key cho ${provider.name}?`)) return;
    setLoading(true);
    try {
      await setKey(provider.id, "");
      toast.info(provider.name, { title: "Đã xoá" });
      setEditing(false);
      setValue("");
      onChanged?.();
    } finally {
      setLoading(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const key = editing ? value.trim() : await getKey(provider.id);
      if (!key) {
        toast.warn("Paste key trước rồi test.", { title: "Chưa có key" });
        return;
      }
      const res = await translateTexts({
        texts: ["Hello world"],
        target: "vi", source: "en",
        engine: provider.id,
        apiKey: key,
      });
      const out = (res?.translations || [])[0];
      if (out) {
        setTestResult("ok");
        toast.success(`"Hello world" → "${out}"`, { title: `${provider.name} OK` });
      } else {
        setTestResult("fail");
        toast.warn("Provider trả về rỗng. Kiểm tra key hoặc quota.",
                    { title: "Không có kết quả" });
      }
    } catch (e) {
      setTestResult("fail");
      toast.error(e?.message || "Không rõ nguyên nhân.",
                   { title: `${provider.name} thất bại` });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div
      style={{
        padding: 14,
        border: "1px solid var(--n-3)",
        borderRadius: 10,
        background: "var(--n-1)",
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10,
                    marginBottom: editing ? 12 : 0 }}>
        <Key size={14} style={{ color: "var(--n-7)" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--n-10)" }}>
            {provider.name}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--n-7)", marginTop: 2 }}>
            {provider.hint}{" "}
            <a href={provider.link}
                onClick={(e) => {
                  e.preventDefault();
                  window.voxstudio?.openExternal?.(provider.link) ||
                  window.open(provider.link, "_blank");
                }}
                style={{ color: "var(--accent)", textDecoration: "none" }}>
              Lấy key <ExternalLink size={10} style={{ display: "inline", verticalAlign: "-1px" }} />
            </a>
          </div>
        </div>

        <StatusBadge hasKey={hasKey} testResult={testResult} />

        {!editing && (
          <button
            onClick={startEdit}
            style={btnSecondary}
          >
            {hasKey ? "Sửa" : "Thêm"}
          </button>
        )}
      </div>

      {editing && (
        <div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type={show ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={provider.placeholder}
              autoFocus
              style={{
                flex: 1, height: 32, padding: "0 10px",
                background: "var(--n-0)", border: "1px solid var(--n-3)",
                borderRadius: 6, color: "var(--n-10)", fontSize: 12.5,
                fontFamily: "var(--font-mono, monospace)",
              }}
            />
            <button
              onClick={() => setShow((v) => !v)}
              title={show ? "Ẩn key" : "Hiện key"}
              style={{ ...iconBtn }}
            >
              {show ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 10,
                         flexWrap: "wrap" }}>
            <button onClick={save}
                    disabled={loading || !value.trim()}
                    style={btnPrimary}>
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Lưu
            </button>
            <button onClick={test}
                    disabled={testing || !value.trim()}
                    style={btnSecondary}>
              {testing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Test key
            </button>
            {hasKey && (
              <button onClick={remove}
                      style={{ ...btnSecondary, color: "var(--err)",
                                borderColor: "rgba(239,68,68,0.35)" }}>
                <Trash2 size={12} /> Xoá
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={() => { setEditing(false); setValue(""); }}
                    style={btnGhost}>
              Huỷ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ hasKey, testResult }) {
  if (testResult === "ok") return <Pill color="#22c55e" bg="rgba(34,197,94,0.12)" icon={Check} label="Đã test OK" />;
  if (testResult === "fail") return <Pill color="var(--err)" bg="rgba(239,68,68,0.12)" icon={X} label="Test lỗi" />;
  if (hasKey) return <Pill color="var(--n-9)" bg="var(--n-2)" icon={Check} label="Đã lưu" />;
  return <Pill color="var(--n-7)" bg="transparent" label="Trống" />;
}

function Pill({ color, bg, icon: Icon, label }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 8px", borderRadius: 4,
      background: bg, color,
      fontSize: 11, fontWeight: 500,
      border: bg === "transparent" ? "1px dashed var(--n-4)" : "none",
    }}>
      {Icon && <Icon size={10} />}
      {label}
    </div>
  );
}

const btnBase = {
  display: "inline-flex", alignItems: "center", gap: 6,
  height: 28, padding: "0 10px", borderRadius: 6,
  fontSize: 12, fontWeight: 500, cursor: "pointer",
  border: "1px solid transparent",
};
const btnPrimary = { ...btnBase,
  background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" };
const btnSecondary = { ...btnBase,
  background: "var(--n-1)", color: "var(--n-10)", borderColor: "var(--n-3)" };
const btnGhost = { ...btnBase,
  background: "transparent", color: "var(--n-8)" };
const iconBtn = { ...btnBase, padding: 0, width: 32,
  background: "var(--n-1)", color: "var(--n-8)", borderColor: "var(--n-3)",
  justifyContent: "center" };
