import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Upload as UploadIcon } from "lucide-react";
import Sidebar from "./Sidebar";
import Titlebar from "./Titlebar";
import CommandPalette from "./CommandPalette";
import { useHotkeys } from "./useHotkeys";

const VIDEO_EXT = /\.(mp4|mov|mkv|avi|webm)$/i;

export default function AppShell({ children }) {
  const nav = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Global drag-drop từ Finder/Explorer: navigate Studio + pass files qua session.
  useEffect(() => {
    let leaveTimer = null;
    const onDragOver = (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      clearTimeout(leaveTimer);
      setDragOver(true);
    };
    const onDragLeave = () => {
      // debounce — dragleave bắn liên tục
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => setDragOver(false), 80);
    };
    const onDrop = (e) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer?.files || [])
        .filter((f) => VIDEO_EXT.test(f.name));
      if (!files.length) return;
      // Expose qua window.__dropBuffer cho StudioHome pick up
      window.__voxDroppedFiles = files;
      nav("/studio");
      // Notify StudioHome nếu đã mount
      window.dispatchEvent(new CustomEvent("vox:files-dropped", { detail: files }));
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [nav]);

  useHotkeys(
    {
      "mod+k": () => setPaletteOpen((o) => !o),
      "mod+1": () => nav("/studio"),
      "mod+2": () => nav("/library"),
      "mod+3": () => nav("/history"),
      "mod+4": () => nav("/"),
      "mod+5": () => nav("/clone"),
      "mod+,": () => nav("/settings"),
      "escape": () => setPaletteOpen(false),
    },
    []
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden"
         style={{ background: "var(--n-0)", color: "var(--n-10)" }}>
      <Titlebar onOpenPalette={() => setPaletteOpen(true)} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden"
              style={{ background: "var(--n-0)" }}>
          {children}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {/* Drop overlay toàn màn hình */}
      <AnimatePresence>
        {dragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            style={{
              position: "fixed", inset: 0, zIndex: 250,
              background: "rgba(10, 10, 10, 0.72)",
              backdropFilter: "blur(6px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                width: 320, padding: 28, textAlign: "center",
                border: "2px dashed var(--accent)",
                borderRadius: 12,
                background: "var(--accent-soft)",
                color: "var(--n-10)",
              }}
            >
              <UploadIcon size={32} style={{ color: "var(--accent)", marginBottom: 10 }} />
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                Thả video vào đây
              </div>
              <div style={{ fontSize: 12, color: "var(--n-8)" }}>
                MP4 · MOV · MKV · AVI · WEBM
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
