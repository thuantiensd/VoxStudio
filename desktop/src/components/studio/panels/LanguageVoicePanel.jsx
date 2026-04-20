import { useState, useEffect } from "react";
import { Globe, Mic } from "lucide-react";
import { listVoices } from "../../../services/api";
import { useT } from "../../../i18n/I18nContext";

const LANGUAGES = [
  { value: "auto", label: "Tự động phát hiện" },
  { value: "vietnamese", label: "Tiếng Việt" },
  { value: "english", label: "English" },
  { value: "chinese", label: "中文" },
  { value: "japanese", label: "日本語" },
  { value: "korean", label: "한국어" },
  { value: "french", label: "Français" },
  { value: "spanish", label: "Español" },
  { value: "german", label: "Deutsch" },
  { value: "portuguese", label: "Português" },
  { value: "russian", label: "Русский" },
  { value: "thai", label: "ไทย" },
  { value: "hindi", label: "हिन्दी" },
];
const TARGETS = LANGUAGES.filter((l) => l.value !== "auto");

/**
 * LanguageVoicePanel — chọn Source / Target language + giọng đọc.
 * Mỗi thay đổi ghi ngay lên backend qua onUpdate.
 */
export default function LanguageVoicePanel({ project, onUpdate }) {
  const t = useT();
  const [voices, setVoices] = useState([]);

  useEffect(() => {
    listVoices().then((r) => setVoices(r.voices || [])).catch(() => {});
  }, []);

  return (
    <>
      <Section icon={<Globe size={13} />} title={t("studio.panels.language")}>
        <Field label={t("studio.panels.sourceLang")}>
          <Select
            value={project.source_language || "auto"}
            onChange={(v) => onUpdate({ source_language: v })}
            options={LANGUAGES}
          />
        </Field>
        <Field label={t("studio.panels.targetLang")}>
          <Select
            value={project.target_language || "vietnamese"}
            onChange={(v) => onUpdate({ target_language: v })}
            options={TARGETS}
          />
        </Field>
      </Section>

      <Section icon={<Mic size={13} />} title={t("studio.panels.voice")}>
        <Field label={t("studio.panels.voiceLabel")}>
          <Select
            value={project.voice_id || ""}
            onChange={(v) => onUpdate({ voice_id: v || null })}
            options={[
              { value: "", label: t("studio.panels.voiceDefault") },
              ...voices.map((v) => ({ value: v.id, label: v.name })),
            ]}
          />
        </Field>
        {voices.length === 0 && (
          <p className="text-xs italic"
             style={{ color: "var(--text-secondary)" }}>
            {t("studio.panels.noVoices")}
          </p>
        )}
      </Section>
    </>
  );
}

// ── primitives ──
export function Section({ icon, title, children }) {
  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: "var(--bg-card)",
        border: "1px solid rgba(127,127,160,0.12)",
      }}
    >
      <div
        className="flex items-center gap-1.5 mb-2.5 text-xs font-medium"
        style={{ color: "var(--text-primary)" }}
      >
        <span style={{ color: "var(--accent)" }}>{icon}</span> {title}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div>
      <label
        className="block text-[11px] mb-1"
        style={{ color: "var(--text-secondary)" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2.5 py-1.5 rounded text-sm outline-none"
      style={{
        background: "var(--bg-base)",
        color: "var(--text-primary)",
        border: "1px solid rgba(127,127,160,0.2)",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
