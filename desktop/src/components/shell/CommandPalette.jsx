import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import {
  Clapperboard, Mic2, AudioWaveform, Library, ClockFading,
  Settings as Cog, Search, Upload, FolderOpen, Trash2, SunMoon,
} from "lucide-react";
import { useTheme } from "../../theme/ThemeContext";
import { useBatch } from "../../batch/BatchContext";

/**
 * CommandPalette — ⌘K. Navigate + actions + recent projects.
 */
export default function CommandPalette({ open, onClose }) {
  const nav = useNavigate();
  const { theme, setTheme } = useTheme() || { theme: "dark", setTheme: () => {} };
  const { clearDone } = useBatch() || {};
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!open) setValue("");
  }, [open]);

  const go = (path) => () => { nav(path); onClose(); };

  const actions = useMemo(() => [
    { id: "nav:studio",   icon: Clapperboard,  label: "Studio",        group: "Chuyển trang", run: go("/studio"),   hotkey: "⌘1" },
    { id: "nav:library",  icon: Library,  label: "Thư viện giọng", group: "Chuyển trang", run: go("/library"),  hotkey: "⌘2" },
    { id: "nav:history",  icon: ClockFading,   label: "Lịch sử",        group: "Chuyển trang", run: go("/history"),  hotkey: "⌘3" },
    { id: "nav:tts",      icon: AudioWaveform, label: "TTS",            group: "Chuyển trang", run: go("/"),         hotkey: "⌘4" },
    { id: "nav:clone",    icon: Mic2,          label: "Voice Clone",    group: "Chuyển trang", run: go("/clone"),    hotkey: "⌘5" },
    { id: "nav:settings", icon: Cog,           label: "Cài đặt",        group: "Chuyển trang", run: go("/settings"), hotkey: "⌘," },

    { id: "act:upload",   icon: Upload,        label: "Tải video mới lên Studio", group: "Hành động", run: go("/studio") },
    { id: "act:output",   icon: FolderOpen,    label: "Mở thư mục xuất",          group: "Hành động",
      run: () => {
        const folder = localStorage.getItem("voxstudio:batch:outputFolder");
        if (folder) window.voxstudio?.revealFileInFolder?.(folder);
        onClose();
      } },
    { id: "act:clear",    icon: Trash2,        label: "Xoá các job đã xong khỏi lịch sử", group: "Hành động",
      run: () => { clearDone?.(); onClose(); } },
    { id: "act:theme",    icon: SunMoon,       label: `Đổi theme (hiện: ${theme})`, group: "Hành động",
      run: () => {
        const next = theme === "dark" ? "light" : "dark";
        setTheme(next);
        onClose();
      } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [theme, clearDone, onClose]);

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
                  placeholder="Gõ để tìm trang hoặc lệnh…"
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
                  Không tìm thấy lệnh.
                </Command.Empty>

                {["Chuyển trang", "Hành động"].map((group) => (
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
