import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import {
  Clapperboard, Mic2, AudioWaveform, Library, ClockFading,
  Settings as Cog, Search, Upload, FolderOpen, Trash2, SunMoon, Languages,
  CloudDownload, FileText,
} from "lucide-react";
import { useTheme } from "../../theme/ThemeContext";
import { useBatch } from "../../batch/BatchContext";
import { useT, useI18n } from "../../i18n/I18nContext";

/**
 * CommandPalette — ⌘K. Navigate + actions + recent projects.
 */
export default function CommandPalette({ open, onClose }) {
  const t = useT();
  const nav = useNavigate();
  const { theme, setTheme } = useTheme() || { theme: "dark", setTheme: () => {} };
  const { locale, setLocale, locales } = useI18n();
  const { clearDone } = useBatch() || {};
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!open) setValue("");
  }, [open]);

  const go = (path) => () => { nav(path); onClose(); };

  const NAV = t("palette.navigate");
  const ACT = t("palette.actions");

  const actions = useMemo(() => [
    { id: "nav:studio",   icon: Clapperboard,  label: t("shell.titleStudio"),   group: NAV, run: go("/studio"),   hotkey: "⌘1" },
    { id: "nav:library",  icon: Library,       label: t("shell.titleLibrary"),  group: NAV, run: go("/library"),  hotkey: "⌘2" },
    { id: "nav:history",  icon: ClockFading,   label: t("shell.titleHistory"),  group: NAV, run: go("/history"),  hotkey: "⌘3" },
    { id: "nav:tts",      icon: AudioWaveform, label: t("shell.titleTTS"),      group: NAV, run: go("/"),         hotkey: "⌘4" },
    { id: "nav:clone",    icon: Mic2,          label: t("shell.titleClone"),      group: NAV, run: go("/clone"),      hotkey: "⌘5" },
    { id: "nav:download", icon: CloudDownload, label: t("shell.titleDownloader"), group: NAV, run: go("/downloader"), hotkey: "⌘6" },
    { id: "nav:stt",      icon: FileText,      label: t("shell.titleSTT"),         group: NAV, run: go("/stt"),        hotkey: "⌘7" },
    { id: "nav:settings", icon: Cog,           label: t("shell.titleSettings"),   group: NAV, run: go("/settings"),   hotkey: "⌘," },

    { id: "act:upload",   icon: Upload,        label: t("palette.uploadVideo"),      group: ACT, run: go("/studio") },
    { id: "act:output",   icon: FolderOpen,    label: t("palette.openOutputFolder"), group: ACT,
      run: () => {
        const folder = localStorage.getItem("voxstudio:batch:outputFolder");
        if (folder) window.voxstudio?.revealFileInFolder?.(folder);
        onClose();
      } },
    { id: "act:clear",    icon: Trash2,        label: t("palette.clearDone"), group: ACT,
      run: () => { clearDone?.(); onClose(); } },
    { id: "act:theme",    icon: SunMoon,       label: t("palette.toggleTheme", { theme }), group: ACT,
      run: () => {
        const next = theme === "dark" ? "light" : "dark";
        setTheme(next);
        onClose();
      } },
    { id: "act:lang",     icon: Languages,     label: `${locale === "vi" ? "Switch to English" : "Chuyển sang Tiếng Việt"}`, group: ACT,
      run: () => {
        const i = locales.indexOf(locale);
        setLocale(locales[(i + 1) % locales.length]);
        onClose();
      } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [theme, locale, clearDone, onClose, t]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12, ease: [0.2, 0.8, 0.2, 1] }}
          onClick={onClose}
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "rgba(0,0,0,0.45)",
            backdropFilter: "blur(4px)",
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: -8 }}
            animate={{ opacity: 1, scale: 1,    y: 0 }}
            exit={{    opacity: 0, scale: 0.98, y: -8 }}
            transition={{ duration: 0.12, ease: [0.2, 0.8, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: "14vh", left: "50%",
              transform: "translateX(-50%)",
              width: 640, maxWidth: "90vw",
              background: "var(--n-1)",
              border: "1px solid var(--n-3)",
              borderRadius: 10,
              boxShadow: "var(--shadow-pop)",
              overflow: "hidden",
            }}
          >
            <Command label="Command palette" value={value} onValueChange={setValue}>
              <div className="flex items-center gap-2 px-3.5 py-3"
                   style={{ borderBottom: "1px solid var(--n-3)" }}>
                <Search size={14} style={{ color: "var(--n-8)" }} />
                <Command.Input
                  autoFocus
                  placeholder={t("palette.placeholder")}
                  className="flex-1 bg-transparent outline-none"
                  style={{
                    color: "var(--n-10)",
                    fontSize: 14,
                  }}
                />
                <kbd>ESC</kbd>
              </div>
              <Command.List
                style={{
                  maxHeight: 420, overflowY: "auto",
                  padding: 6,
                }}
              >
                <Command.Empty
                  style={{
                    padding: 24, textAlign: "center",
                    color: "var(--n-8)", fontSize: 13,
                  }}
                >
                  {t("palette.empty")}
                </Command.Empty>

                {[NAV, ACT].map((group) => (
                  <Command.Group
                    key={group}
                    heading={group}
                    className="cmdk-group"
                  >
                    {actions.filter((a) => a.group === group).map((a) => {
                      const Icon = a.icon;
                      return (
                        <Command.Item
                          key={a.id}
                          value={`${a.label} ${a.group}`}
                          onSelect={a.run}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "8px 10px", borderRadius: 6,
                            cursor: "pointer",
                            color: "var(--n-9)",
                            fontSize: 13,
                          }}
                        >
                          <Icon size={14} style={{ color: "var(--n-8)" }} />
                          <span className="flex-1">{a.label}</span>
                          {a.hotkey && <kbd>{a.hotkey}</kbd>}
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                ))}
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
