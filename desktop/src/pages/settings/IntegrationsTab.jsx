import { useEffect, useState } from "react";
import {
  Key, Eye, EyeOff, Check, X, ShieldCheck, ShieldAlert,
  ExternalLink, Loader2, Trash2, Save, AlertTriangle,
} from "lucide-react";
import { listKeys, getKey, setKey, isSecureBackend } from "../../services/keyvault";
import { testProviderKey } from "../../services/api";
import { useToast } from "../../components/ui/Toast";
import Modal from "../../components/ui/Modal";
import { useT } from "../../i18n/I18nContext";

/* ─────────────────────────────────────────────────────────
   Settings → AI & API keys
   Paste keys cho các dịch vụ translate/LLM. Electron: lưu
   qua OS Keychain. Web: fallback localStorage (cảnh báo).
   Test mỗi key bằng 1 câu dịch thử.
   ───────────────────────────────────────────────────────── */

const PROVIDERS = [
  { id: "openai",       name: "OpenAI (GPT)",          hintKey: "settings.integrations.hintOpenai",      link: "https://platform.openai.com/api-keys",                placeholder: "sk-proj-…" },
  { id: "claude",       name: "Anthropic Claude",      hintKey: "settings.integrations.hintClaude",      link: "https://console.anthropic.com/settings/keys",          placeholder: "sk-ant-api…" },
  { id: "gemini",       name: "Google Gemini",         hintKey: "settings.integrations.hintGemini",      link: "https://aistudio.google.com/apikey",                  placeholder: "AIza…" },
  { id: "deepl",        name: "DeepL",                 hintKey: "settings.integrations.hintDeepl",       link: "https://www.deepl.com/account/summary",                placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx" },
  { id: "google_cloud", name: "Google Cloud Translate", hintKey: "settings.integrations.hintGoogleCloud", link: "https://console.cloud.google.com/apis/credentials",   placeholder: "AIza…" },
];

export default function IntegrationsTab() {
  const t = useT();
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
        <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--n-9)" }}
             dangerouslySetInnerHTML={{ __html: secure ? t("settings.integrations.bannerSecure") : t("settings.integrations.bannerWeb") }} />
      </div>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8,
                       color: "var(--n-8)", fontSize: 13 }}>
          <Loader2 size={14} className="animate-spin" /> {t("settings.integrations.loadingVault")}
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
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // 'ok' | 'fail'
  const [confirmOpen, setConfirmOpen] = useState(false);

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
      toast.success(provider.name, { title: t("settings.integrations.toastSavedTitle") });
      setEditing(false);
      onChanged?.();
    } catch (e) {
      toast.error(e?.message || t("settings.integrations.toastSaveError"), { title: t("settings.integrations.toastSaveErrorTitle") });
    } finally {
      setLoading(false);
    }
  }

  async function doRemove() {
    setConfirmOpen(false);
    setLoading(true);
    try {
      await setKey(provider.id, "");
      toast.info(provider.name, { title: t("settings.integrations.toastDeletedTitle") });
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
        toast.warn(t("settings.integrations.toastNoKey"), { title: t("settings.integrations.toastNoKeyTitle") });
        return;
      }
      // Test trực tiếp qua endpoint chuyên dụng (cheap: list models / 1 token).
      // Kèm model mặc định cho LLM provider để check luôn quyền truy cập
      // (vd key OpenAI valid nhưng gpt-5 chưa được cấp quyền → catch luôn).
      const defaultModel = {
        openai: "gpt-5",
        claude: "claude-opus-4-5",
        gemini: "gemini-2.5-pro",
      }[provider.id] || null;

      const res = await testProviderKey(provider.id, key, defaultModel);
      if (res?.ok) {
        setTestResult("ok");
        toast.success(res.message || provider.name,
                       { title: t("settings.integrations.toastTestOk", { name: provider.name }) });
      } else {
        setTestResult("fail");
        toast.error(res?.message || t("settings.integrations.toastUnknownReason"),
                     { title: t("settings.integrations.toastTestFailedTitle", { name: provider.name }) });
      }
    } catch (e) {
      setTestResult("fail");
      toast.error(e?.message || t("settings.integrations.toastUnknownReason"),
                   { title: t("settings.integrations.toastTestFailedTitle", { name: provider.name }) });
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
            {t(provider.hintKey)}{" "}
            <a href={provider.link}
                onClick={(e) => {
                  e.preventDefault();
                  window.voxstudio?.openExternal?.(provider.link) ||
                  window.open(provider.link, "_blank");
                }}
                style={{ color: "var(--accent)", textDecoration: "none" }}>
              {t("settings.integrations.getKey")} <ExternalLink size={10} style={{ display: "inline", verticalAlign: "-1px" }} />
            </a>
          </div>
        </div>

        <StatusBadge hasKey={hasKey} testResult={testResult} />

        {!editing && (
          <button
            onClick={startEdit}
            style={btnSecondary}
          >
            {hasKey ? t("settings.integrations.edit") : t("settings.integrations.add")}
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
              title={show ? t("settings.integrations.hideKey") : t("settings.integrations.showKey")}
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
              {t("settings.integrations.save")}
            </button>
            <button onClick={test}
                    disabled={testing || !value.trim()}
                    style={btnSecondary}>
              {testing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              {t("settings.integrations.testKey")}
            </button>
            {hasKey && (
              <button onClick={() => setConfirmOpen(true)}
                      style={{ ...btnSecondary, color: "var(--err)",
                                borderColor: "rgba(239,68,68,0.35)" }}>
                <Trash2 size={12} /> {t("settings.integrations.remove")}
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={() => { setEditing(false); setValue(""); }}
                    style={btnGhost}>
              {t("settings.integrations.cancel")}
            </button>
          </div>
        </div>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        width={400}
        actions={
          <>
            <button onClick={() => setConfirmOpen(false)} style={btnGhost}>
              {t("settings.integrations.cancel")}
            </button>
            <button
              onClick={doRemove}
              style={{ ...btnBase,
                background: "var(--err)", color: "#fff", borderColor: "var(--err)",
                height: 32, padding: "0 14px", fontWeight: 500,
              }}
            >
              <Trash2 size={13} /> {t("settings.integrations.removeKey")}
            </button>
          </>
        }
      >
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start",
                       padding: "4px 2px" }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            background: "rgba(239,68,68,0.12)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <AlertTriangle size={18} style={{ color: "var(--err)" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--n-10)",
                           marginBottom: 6 }}>
              {t("settings.integrations.removeKeyTitle", { name: provider.name })}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--n-8)", lineHeight: 1.55 }}>
              {t("settings.integrations.removeKeyHint", { name: provider.name })}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function StatusBadge({ hasKey, testResult }) {
  const t = useT();
  if (testResult === "ok") return <Pill color="#22c55e" bg="rgba(34,197,94,0.12)" icon={Check} label={t("settings.integrations.badgeOk")} />;
  if (testResult === "fail") return <Pill color="var(--err)" bg="rgba(239,68,68,0.12)" icon={X} label={t("settings.integrations.badgeFail")} />;
  if (hasKey) return <Pill color="var(--n-9)" bg="var(--n-2)" icon={Check} label={t("settings.integrations.badgeSaved")} />;
  return <Pill color="var(--n-7)" bg="transparent" label={t("settings.integrations.badgeEmpty")} />;
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
