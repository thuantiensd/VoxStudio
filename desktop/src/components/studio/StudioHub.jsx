import { useParams, useNavigate } from "react-router-dom";
import {
  Clapperboard, Captions, Mic, Mic2, Image as ImageIcon, Wand2,
  Scissors, Sparkles, Music, Sunrise,
} from "lucide-react";
import StudioDubbingHomeV2 from "./StudioDubbingHomeV2";
import { useT } from "../../i18n/I18nContext";

/**
 * StudioHub — landing page hiển thị toàn bộ công cụ AI dạng grid card.
 *
 * Routes:
 *   /studio              → HubLanding (grid)
 *   /studio/dubbing      → StudioDubbingHomeV2
 *   /studio/<toolId>     → ComingSoon nếu chưa ready
 */

const TOOL_DEFS = [
  { id: "dubbing", tKey: "dubbing", icon: Clapperboard, status: "ready", target: "/studio/dubbing",
    color: { fg: "#a48bff", bg: "rgba(124,92,255,0.12)", border: "rgba(124,92,255,0.30)" } },
  { id: "subtitle", tKey: "subtitle", icon: Captions, status: "ready", target: "/stt",
    color: { fg: "#fbbf24", bg: "rgba(251,191,36,0.12)", border: "rgba(251,191,36,0.30)" } },
  { id: "tts", tKey: "tts", icon: Mic, status: "ready", target: "/",
    color: { fg: "#f472b6", bg: "rgba(236,72,153,0.12)", border: "rgba(236,72,153,0.30)" } },
  { id: "clone", tKey: "clone", icon: Mic2, status: "ready", target: "/clone",
    color: { fg: "#60a5fa", bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.30)" } },
  { id: "image-gen", tKey: "imageGen", icon: ImageIcon, status: "soon",
    color: { fg: "#4ade80", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.30)" } },
  { id: "video-cut", tKey: "videoCut", icon: Scissors, status: "soon",
    color: { fg: "#fb923c", bg: "rgba(251,146,60,0.12)", border: "rgba(251,146,60,0.30)" } },
  { id: "image-edit", tKey: "imageEdit", icon: Wand2, status: "soon",
    color: { fg: "#c084fc", bg: "rgba(168,85,247,0.12)", border: "rgba(168,85,247,0.30)" } },
  { id: "music", tKey: "music", icon: Music, status: "soon",
    color: { fg: "#2dd4bf", bg: "rgba(20,184,166,0.12)", border: "rgba(20,184,166,0.30)" } },
  { id: "upscale", tKey: "upscale", icon: Sunrise, status: "soon",
    color: { fg: "#fb7185", bg: "rgba(244,63,94,0.12)", border: "rgba(244,63,94,0.30)" } },
];

function useTools() {
  const t = useT();
  return TOOL_DEFS.map((d) => ({
    ...d,
    label: t(`studioHub.tools.${d.tKey}.label`),
    desc: t(`studioHub.tools.${d.tKey}.desc`),
    tags: t(`studioHub.tools.${d.tKey}.tags`).split(","),
  }));
}

export default function StudioHub() {
  const { toolId } = useParams();
  const nav = useNavigate();
  const TOOLS = useTools();
  const active = TOOLS.find((t) => t.id === toolId);

  // Tool active + ready → render component
  if (active && active.status === "ready") {
    if (active.id === "dubbing") return <StudioDubbingHomeV2 />;
    // Tool ready khác đã có route riêng (TTS, Clone, STT) — redirect
    nav(active.target || "/", { replace: true });
    return null;
  }

  // Tool active + soon → ComingSoon
  if (active && active.status === "soon") {
    return <ComingSoon tool={active} onBack={() => nav("/studio")} />;
  }

  // Default: hub landing grid
  return <HubLanding tools={TOOLS} onPick={(tool) => {
    if (tool.status === "soon") {
      nav(`/studio/${tool.id}`);
    } else if (tool.target) {
      nav(tool.target);
    }
  }} />;
}

/* ─────────────────────────────────────────────────────── */
/* Hub landing — bento layout (featured + asymmetric grid) */
/* ─────────────────────────────────────────────────────── */
function HubLanding({ tools, onPick }) {
  const t = useT();
  const featured = tools[0];
  const ready = tools.slice(1).filter((x) => x.status === "ready");
  const soon = tools.filter((x) => x.status === "soon");
  const readyCount = tools.filter((x) => x.status === "ready").length;

  return (
    <div style={{
      height: "100%", overflowY: "auto",
      background: "var(--n-0)",
    }}>
      <div style={{
        maxWidth: 1280, margin: "0 auto",
        padding: "36px 40px 60px",
      }}>
        {/* Editorial hero — center aligned cho cân */}
        <div style={{
          textAlign: "center",
          marginBottom: 36, marginTop: 12,
          display: "flex", flexDirection: "column", alignItems: "center",
        }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            color: "var(--accent)", fontSize: 11, fontWeight: 700,
            letterSpacing: "0.12em", textTransform: "uppercase",
            marginBottom: 14, padding: "5px 11px", borderRadius: 12,
            background: "var(--accent-soft)",
            border: "1px solid var(--accent-ring)",
          }}>
            <Sparkles size={11} /> VoxStudio · {t("studioHub.heroBadge", { n: readyCount })}
          </div>
          <h1 style={{
            margin: 0, fontSize: 42, fontWeight: 750,
            color: "var(--n-10)", letterSpacing: "-0.03em",
            lineHeight: 1.05,
          }}>
            {t("studioHub.heroTitle1")}{" "}
            <span style={{
              background: "linear-gradient(90deg, var(--accent), #ec4899 50%, #fbbf24 100%)",
              WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
            }}>
              {t("studioHub.heroTitleAccent")}
            </span>
          </h1>
          <p style={{
            margin: "16px 0 0", fontSize: 14.5, color: "var(--n-8)",
            lineHeight: 1.6, maxWidth: 580,
          }}>
            {t("studioHub.heroSubtitle")}
          </p>
        </div>

        {/* Featured hero card — Dubbing flagship */}
        <FeaturedCard tool={featured} onClick={() => onPick(featured)} />

        {/* Section: ready tools */}
        {ready.length > 0 && (
          <>
            <SectionLabel sub={t("studioHub.sectionReadyHint")}>{t("studioHub.sectionReady")}</SectionLabel>
            <div style={gridReady}>
              {ready.map((tl) => (
                <RowCard key={tl.id} tool={tl} onClick={() => onPick(tl)} />
              ))}
            </div>
          </>
        )}

        {/* Section: coming soon */}
        {soon.length > 0 && (
          <>
            <SectionLabel sub={t("studioHub.sectionSoonHint")}>{t("studioHub.sectionSoon")}</SectionLabel>
            <div style={gridSoon}>
              {soon.map((tl) => (
                <SmallCard key={tl.id} tool={tl} onClick={() => onPick(tl)} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children, sub }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 12,
      marginTop: 36, marginBottom: 14,
    }}>
      <h2 style={{
        margin: 0, fontSize: 11.5, fontWeight: 700,
        color: "var(--n-7)", letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}>
        {children}
      </h2>
      {sub && (
        <span style={{
          fontSize: 11, color: "var(--n-6)", fontWeight: 400,
          letterSpacing: 0, textTransform: "none",
        }}>
          {sub}
        </span>
      )}
      <div style={{ flex: 1, height: 1, background: "var(--n-3)" }} />
    </div>
  );
}

const gridReady = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
  gap: 12,
};
const gridSoon = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: 10,
};

/* ─── Featured hero card (Dubbing) ─── */
function FeaturedCard({ tool, onClick }) {
  const t = useT();
  const Icon = tool.icon;
  return (
    <button
      onClick={onClick}
      style={{
        position: "relative", overflow: "hidden",
        width: "100%", textAlign: "left",
        background: "linear-gradient(135deg, var(--accent-soft) 0%, var(--n-1) 60%)",
        border: "1px solid var(--accent-ring)",
        borderRadius: 16,
        padding: "28px 32px",
        cursor: "pointer",
        transition: "all 0.18s",
        fontFamily: "inherit",
        display: "grid", gridTemplateColumns: "1fr auto",
        alignItems: "center", gap: 24,
        minHeight: 140,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--accent)";
        e.currentTarget.style.boxShadow = "0 0 0 1px var(--accent), 0 16px 40px var(--accent-soft)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--accent-ring)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* Background glow */}
      <div style={{
        position: "absolute", top: -50, right: -50,
        width: 220, height: 220, borderRadius: "50%",
        background: "radial-gradient(circle, var(--accent-soft) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      <div style={{ position: "relative" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 10.5, fontWeight: 700,
          color: "#4ade80", letterSpacing: "0.1em",
          textTransform: "uppercase", marginBottom: 12,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: "#22c55e",
            boxShadow: "0 0 8px #22c55e",
            animation: "pulse 2s ease-in-out infinite",
          }} />
          {t("studioHub.featuredBadge")}
        </div>
        <h2 style={{
          margin: "0 0 8px", fontSize: 26, fontWeight: 700,
          color: "var(--n-10)", letterSpacing: "-0.015em",
          lineHeight: 1.15,
        }}>
          {tool.label}
        </h2>
        <p style={{
          margin: "0 0 14px", fontSize: 13.5,
          color: "var(--n-8)", lineHeight: 1.55, maxWidth: 480,
        }}>
          {tool.desc}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {tool.tags.map((tag) => (
            <span key={tag} style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              fontSize: 11, fontWeight: 500,
              padding: "4px 10px", borderRadius: 12,
              background: "var(--n-2)",
              border: "1px solid var(--n-3)",
              color: "var(--n-9)",
            }}>
              <span style={{
                width: 4, height: 4, borderRadius: "50%",
                background: tool.color.fg,
              }} />
              {tag.toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      {/* Right side: icon + CTA */}
      <div style={{
        display: "flex", flexDirection: "column",
        alignItems: "flex-end", gap: 14, position: "relative",
      }}>
        <div style={{
          width: 76, height: 76, borderRadius: 16,
          background: tool.color.bg,
          border: `1px solid ${tool.color.border}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: `0 8px 24px ${tool.color.bg}`,
        }}>
          <Icon size={36} style={{ color: tool.color.fg }} />
        </div>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "9px 18px", borderRadius: 9,
          background: "linear-gradient(135deg, var(--accent), #ec4899)",
          color: "#fff", fontSize: 13, fontWeight: 600,
          boxShadow: "0 4px 14px rgba(124,92,255,0.35)",
        }}>
          {t("studioHub.ctaStart")}
        </span>
      </div>
    </button>
  );
}

/* ─── Row-style card (ready tools) ─── */
function RowCard({ tool, onClick }) {
  const Icon = tool.icon;
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left", display: "flex", alignItems: "center", gap: 14,
        background: "var(--n-1)",
        border: "1px solid var(--n-3)",
        borderRadius: 12, padding: "16px 18px",
        cursor: "pointer", transition: "all 0.15s",
        fontFamily: "inherit", position: "relative",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--n-2)";
        e.currentTarget.style.borderColor = tool.color.border;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--n-1)";
        e.currentTarget.style.borderColor = "var(--n-3)";
      }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 10,
        background: tool.color.bg, border: `1px solid ${tool.color.border}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        <Icon size={20} style={{ color: tool.color.fg }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 600, color: "var(--n-10)",
          marginBottom: 3, letterSpacing: "-0.005em",
        }}>
          {tool.label}
        </div>
        <div style={{
          fontSize: 11.5, color: "var(--n-7)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {tool.tags.join(" · ").toLowerCase()}
        </div>
      </div>
      <span style={{
        color: "var(--n-6)", fontSize: 16, paddingLeft: 4,
      }}>→</span>
    </button>
  );
}

/* ─── Small card (coming soon tools) ─── */
function SmallCard({ tool, onClick }) {
  const t = useT();
  const Icon = tool.icon;
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left",
        background: "var(--n-1)",
        border: "1px dashed var(--n-3)",
        borderRadius: 12, padding: "16px 18px",
        cursor: "pointer", transition: "all 0.15s",
        fontFamily: "inherit", opacity: 0.75,
        display: "flex", flexDirection: "column", gap: 10,
        minHeight: 120,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = "1";
        e.currentTarget.style.borderColor = tool.color.border;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = "0.75";
        e.currentTarget.style.borderColor = "var(--n-3)";
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: tool.color.bg,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <Icon size={15} style={{ color: tool.color.fg }} />
        </div>
        <div style={{
          fontSize: 13, fontWeight: 600, color: "var(--n-9)",
          letterSpacing: "-0.005em", lineHeight: 1.3,
        }}>
          {tool.label}
        </div>
      </div>
      <p style={{
        margin: 0, fontSize: 11.5, color: "var(--n-7)",
        lineHeight: 1.5, flex: 1,
      }}>
        {tool.desc}
      </p>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 10, fontWeight: 600,
        color: "var(--n-6)", letterSpacing: "0.04em",
      }}>
        <Sparkles size={9} /> {t("studioHub.soonTag")}
      </div>
    </button>
  );
}

/* ─────────────────────────────────────────────────────── */
/* Coming soon page                                         */
/* ─────────────────────────────────────────────────────── */
function ComingSoon({ tool, onBack }) {
  const t = useT();
  const Icon = tool.icon;
  return (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "var(--n-0)", padding: 32,
    }}>
      <div style={{
        textAlign: "center", maxWidth: 460,
      }}>
        <div style={{
          width: 84, height: 84, borderRadius: 18,
          background: tool.color.bg,
          border: `1px solid ${tool.color.border}`,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          marginBottom: 20,
        }}>
          <Icon size={36} style={{ color: tool.color.fg }} />
        </div>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "4px 12px", fontSize: 11, fontWeight: 700,
          borderRadius: 14,
          background: "var(--accent-soft)",
          color: "var(--accent)",
          letterSpacing: "0.08em", textTransform: "uppercase",
          marginBottom: 14,
        }}>
          <Sparkles size={11} /> {t("studioHub.comingSoonBadge")}
        </span>
        <h2 style={{
          margin: "0 0 10px", fontSize: 22, fontWeight: 700,
          color: "var(--n-10)", letterSpacing: "-0.015em",
        }}>
          {tool.label}
        </h2>
        <p style={{
          margin: "0 0 24px", fontSize: 14, color: "var(--n-8)",
          lineHeight: 1.6,
        }}>
          {tool.desc} {t("studioHub.comingSoonHint")}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button
            onClick={onBack}
            style={{
              padding: "9px 18px", borderRadius: 8,
              background: "transparent", border: "1px solid var(--n-3)",
              color: "var(--n-9)", fontSize: 13, fontWeight: 500,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {t("studioHub.back")}
          </button>
          <button
            onClick={() => window.voxstudio?.openExternal?.(
              "mailto:hello@voxstudio.app?subject=Beta%20test%20" + encodeURIComponent(tool.label)
            )}
            style={{
              padding: "9px 18px", borderRadius: 8,
              background: "var(--accent)", color: "#fff",
              border: "none", fontSize: 13, fontWeight: 500,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {t("studioHub.joinBeta")}
          </button>
        </div>
      </div>
    </div>
  );
}
