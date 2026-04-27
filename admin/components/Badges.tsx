import { Crown, Sparkles, Check, AlertCircle, Ban, ShieldCheck } from "lucide-react";

export function PlanBadge({ plan }: { plan: string }) {
  const cfg: Record<string, { label: string; icon: any; cls: string }> = {
    free:   { label: "Free",   icon: null,     cls: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
    pro:    { label: "Pro",    icon: Crown,    cls: "bg-purple-500/15 text-purple-300 border-purple-500/30" },
    studio: { label: "Studio", icon: Sparkles, cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  };
  const c = cfg[plan] || cfg.free;
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${c.cls}`}>
      {Icon && <Icon size={10} />}
      {c.label}
    </span>
  );
}

export function StatusBadge({ banned }: { banned: boolean }) {
  if (banned) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-red-500/15 text-red-400 border border-red-500/30">
        <Ban size={10} /> Bị cấm
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] bg-green-500/15 text-green-400 border border-green-500/30">
      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
      Hoạt động
    </span>
  );
}

export function VerifiedBadge({ verified }: { verified: boolean }) {
  if (verified) {
    return (
      <span title="Đã xác thực email"
            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-500/15 text-green-400">
        <Check size={11} />
      </span>
    );
  }
  return (
    <span title="Chưa xác thực email"
          className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-yellow-500/15 text-yellow-400">
      <AlertCircle size={11} />
    </span>
  );
}

export function RoleBadge({ role }: { role: string }) {
  if (role === "admin") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-yellow-400">
        <ShieldCheck size={11} /> Admin
      </span>
    );
  }
  return <span className="text-[11px] text-muted">User</span>;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const now = Date.now();
  const then = new Date(iso).getTime();
  const sec = Math.floor((now - then) / 1000);
  if (sec < 60) return `${sec}s trước`;
  if (sec < 3600) return `${Math.floor(sec / 60)} phút trước`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} giờ trước`;
  if (sec < 30 * 86400) return `${Math.floor(sec / 86400)} ngày trước`;
  if (sec < 365 * 86400) return `${Math.floor(sec / (30 * 86400))} tháng trước`;
  return `${Math.floor(sec / (365 * 86400))} năm trước`;
}
