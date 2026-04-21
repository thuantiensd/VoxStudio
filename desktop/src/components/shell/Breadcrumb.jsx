import { useLocation, useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useT } from "../../i18n/I18nContext";

export default function Breadcrumb() {
  const t = useT();
  const loc = useLocation();
  const navigate = useNavigate();

  const ROUTE_LABELS = {
    "/":         t("shell.titleHome"),
    "/studio":   t("shell.titleStudio"),
    "/clone":    t("shell.titleClone"),
    "/library":  t("shell.titleLibrary"),
    "/history":  t("shell.titleHistory"),
    "/settings": t("shell.titleSettings"),
  };

  // Tạo crumb từ path. /studio/abc-123 → ["Studio", "abc-123" (8 ký tự)]
  const parts = loc.pathname.split("/").filter(Boolean);
  const crumbs = [{ label: "VoxStudio", path: "/" }];
  let acc = "";
  for (const p of parts) {
    acc += "/" + p;
    const known = ROUTE_LABELS[acc];
    if (known) {
      crumbs.push({ label: known, path: acc });
    } else {
      // id segment — show short
      const short = p.length > 10 ? p.slice(0, 8) + "…" : p;
      crumbs.push({ label: short, path: acc });
    }
  }

  return (
    <nav className="flex items-center gap-1 text-[12px]"
         style={{ color: "var(--n-8)" }}>
      {crumbs.map((c, i) => (
        <div key={c.path} className="flex items-center gap-1">
          {i > 0 && <ChevronRight size={12} style={{ opacity: 0.5 }} />}
          <button
            onClick={() => navigate(c.path)}
            className="no-drag px-1.5 py-0.5 rounded hover:bg-[var(--n-2)] transition-colors"
            style={{
              color: i === crumbs.length - 1 ? "var(--n-10)" : "var(--n-8)",
              fontWeight: i === crumbs.length - 1 ? 500 : 400,
            }}
          >
            {c.label}
          </button>
        </div>
      ))}
    </nav>
  );
}
