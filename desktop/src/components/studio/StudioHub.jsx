import { useParams, useNavigate } from "react-router-dom";
import {
  Clapperboard, Image as ImageIcon, Wand2, Sparkles, Music,
  Scissors, Sunrise, Lock,
} from "lucide-react";
import StudioDubbingHome from "./StudioDubbingHome";

/**
 * StudioHub — hub đa công cụ AI (phương án B: split view).
 *
 * Left sidebar (200px): danh sách tool + badge "Sắp ra mắt".
 * Right pane: nội dung tool đang active.
 *
 * Thêm tool mới = thêm 1 entry vào TOOLS + component render tương ứng.
 */

const TOOLS = [
  {
    id: "dubbing",
    label: "Lồng tiếng video",
    desc: "Tự dịch + giọng AI, xuất video có phụ đề",
    icon: Clapperboard,
    status: "ready",
    group: "VIDEO",
  },
  {
    id: "image-gen",
    label: "Tạo ảnh AI",
    desc: "Từ prompt text → ảnh chất lượng cao",
    icon: ImageIcon,
    status: "soon",
    group: "HÌNH ẢNH",
  },
  {
    id: "image-edit",
    label: "Chỉnh sửa ảnh AI",
    desc: "Xoá phông, thay đối tượng, outpaint",
    icon: Wand2,
    status: "soon",
    group: "HÌNH ẢNH",
  },
  {
    id: "upscale",
    label: "Upscale 2×/4×",
    desc: "Nâng độ phân giải ảnh cũ lên 4K",
    icon: Sunrise,
    status: "soon",
    group: "HÌNH ẢNH",
  },
  {
    id: "video-gen",
    label: "Tạo video từ ảnh",
    desc: "img2video — biến ảnh tĩnh thành clip ngắn",
    icon: Sparkles,
    status: "soon",
    group: "VIDEO",
  },
  {
    id: "music",
    label: "Tạo nhạc nền",
    desc: "Prompt → bản nhạc BGM không bản quyền",
    icon: Music,
    status: "soon",
    group: "AUDIO",
  },
  {
    id: "face-restore",
    label: "Phục hồi khuôn mặt",
    desc: "Làm nét ảnh cũ, mờ, rung",
    icon: Scissors,
    status: "soon",
    group: "HÌNH ẢNH",
  },
];

export default function StudioHub() {
  const { toolId } = useParams();
  const nav = useNavigate();
  const active = TOOLS.find((t) => t.id === toolId) || TOOLS[0];

  // Group tools theo group (giữ thứ tự xuất hiện đầu tiên)
  const groups = [];
  const seen = new Set();
  for (const t of TOOLS) {
    if (!seen.has(t.group)) { seen.add(t.group); groups.push(t.group); }
  }

  return (
    <div className="flex h-full overflow-hidden"
         style={{ background: "var(--n-0)" }}>
      {/* Left: tool sidebar */}
      <aside
        className="flex-shrink-0 flex flex-col"
        style={{
          width: 220,
          borderRight: "1px solid var(--n-3)",
          background: "var(--n-1)",
        }}
      >
        <div
          className="px-4 py-4"
          style={{ borderBottom: "1px solid var(--n-3)" }}
        >
          <div className="text-[11px] font-semibold uppercase tracking-wider"
               style={{ color: "var(--n-6)" }}>
            Studio
          </div>
          <div className="text-[13px] font-semibold mt-0.5"
               style={{ color: "var(--n-10)" }}>
            Công cụ AI
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-3">
          {groups.map((g) => (
            <div key={g}>
              <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider"
                   style={{ color: "var(--n-6)" }}>
                {g}
              </div>
              <div className="space-y-0.5">
                {TOOLS.filter((t) => t.group === g).map((t) => (
                  <ToolItem
                    key={t.id}
                    tool={t}
                    active={t.id === active.id}
                    onClick={() => {
                      if (t.status === "ready") nav(`/studio/${t.id}`);
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div
          className="px-3 py-2.5 text-[10.5px]"
          style={{
            borderTop: "1px solid var(--n-3)",
            color: "var(--n-7)",
            lineHeight: 1.5,
          }}
        >
          Đang phát triển thêm nhiều công cụ. Đề xuất tool bạn cần?{" "}
          <a
            href="mailto:hello@voxstudio.app"
            onClick={(e) => {
              e.preventDefault();
              window.voxstudio?.openExternal?.("mailto:hello@voxstudio.app");
            }}
            style={{ color: "var(--accent)", textDecoration: "none" }}
          >
            Gửi email
          </a>
        </div>
      </aside>

      {/* Right: tool content */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {active.status === "ready" ? (
          <ToolContent tool={active} />
        ) : (
          <ComingSoon tool={active} />
        )}
      </main>
    </div>
  );
}

function ToolItem({ tool, active, onClick }) {
  const Icon = tool.icon;
  const disabled = tool.status !== "ready";
  return (
    <button
      onClick={onClick}
      disabled={disabled && !active}
      className="w-full flex items-start gap-2.5 rounded-md px-2.5 py-2 transition-colors text-left"
      style={{
        background: active ? "var(--accent-soft)" : "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        border: "none",
      }}
      onMouseEnter={(e) => {
        if (!active && !disabled) e.currentTarget.style.background = "var(--n-2)";
      }}
      onMouseLeave={(e) => {
        if (!active && !disabled) e.currentTarget.style.background = "transparent";
      }}
    >
      <div
        className="rounded flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{
          width: 26, height: 26,
          background: active
            ? "linear-gradient(135deg, var(--accent), #8b5cf6)"
            : "var(--n-2)",
          color: active ? "#fff" : "var(--n-8)",
        }}
      >
        <Icon size={13} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center gap-1.5">
          <span className="text-[12.5px] truncate"
                style={{
                  color: active ? "var(--n-10)" : "var(--n-9)",
                  fontWeight: active ? 600 : 500,
                }}>
            {tool.label}
          </span>
          {disabled && <Lock size={10} style={{ color: "var(--n-6)" }} />}
        </div>
        <div className="text-[10.5px] truncate mt-0.5"
             style={{ color: "var(--n-7)" }}>
          {disabled ? "Sắp ra mắt" : tool.desc}
        </div>
      </div>
    </button>
  );
}

/* ─── Tool content dispatcher ─── */

function ToolContent({ tool }) {
  if (tool.id === "dubbing") return <StudioDubbingHome />;
  // fallback — không nên xảy ra vì mọi ready tool đều được handle
  return <ComingSoon tool={tool} />;
}

/* ─── Coming soon placeholder ─── */

function ComingSoon({ tool }) {
  const Icon = tool.icon;
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center" style={{ maxWidth: 440 }}>
        <div
          className="mx-auto rounded-2xl flex items-center justify-center mb-5"
          style={{
            width: 72, height: 72,
            background: "linear-gradient(135deg, var(--accent-soft), rgba(139,92,246,0.15))",
            border: "1px solid var(--n-3)",
          }}
        >
          <Icon size={30} style={{ color: "var(--accent)" }} />
        </div>
        <div
          className="inline-block px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold uppercase tracking-wider mb-3"
          style={{
            background: "var(--accent-soft)",
            color: "var(--accent)",
            letterSpacing: "0.08em",
          }}
        >
          Sắp ra mắt
        </div>
        <h2 className="text-xl font-semibold mb-2"
            style={{ color: "var(--n-10)", letterSpacing: "-0.01em" }}>
          {tool.label}
        </h2>
        <p className="text-sm mb-6" style={{ color: "var(--n-8)", lineHeight: 1.55 }}>
          {tool.desc}. Chúng tôi đang hoàn thiện công cụ này. Nếu bạn cần
          dùng sớm, gửi email để được ưu tiên beta test.
        </p>
        <button
          onClick={() => window.voxstudio?.openExternal?.("mailto:hello@voxstudio.app?subject=Beta%20test%20" + encodeURIComponent(tool.label))}
          className="rounded-md px-4 py-2 text-sm font-medium transition-colors"
          style={{
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            cursor: "pointer",
          }}
        >
          Đăng ký beta test
        </button>
      </div>
    </div>
  );
}
