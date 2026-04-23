"use client";
import { useEffect, useState } from "react";
import { Users, Activity, AlertTriangle, TrendingUp, Loader2 } from "lucide-react";
import Shell from "@/components/Shell";
import { fetchStats } from "@/lib/api";

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats().then(setStats).finally(() => setLoading(false));
    const iv = setInterval(() => fetchStats().then(setStats).catch(() => {}), 15000);
    return () => clearInterval(iv);
  }, []);

  return (
    <Shell>
      <div className="p-8 max-w-6xl">
        <h1 className="text-xl font-semibold mb-6">Tổng quan</h1>

        {loading && (
          <div className="flex items-center gap-2 text-muted text-sm">
            <Loader2 size={14} className="animate-spin" /> Đang tải…
          </div>
        )}

        {stats && (
          <>
            <div className="grid grid-cols-4 gap-4 mb-6">
              <Stat icon={Users} label="Tổng user" value={stats.users.total}
                    hint={`+${stats.users.new_today} hôm nay`} />
              <Stat icon={TrendingUp} label="DAU (hôm nay)" value={stats.users.dau}
                    hint={`MAU: ${stats.users.mau}`} />
              <Stat icon={Activity} label="Job hôm nay" value={stats.jobs.today}
                    hint={`${stats.jobs.running} đang chạy · ${stats.jobs.pending} chờ`} />
              <Stat icon={AlertTriangle} label="Lỗi 24h" value={stats.jobs.errors_24h}
                    hint="trong tác vụ GPU"
                    tone={stats.jobs.errors_24h > 0 ? "warn" : "ok"} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Card title="Phân bổ theo gói">
                <ul className="space-y-2">
                  {Object.entries(stats.users.by_plan || {}).map(([plan, count]) => (
                    <li key={plan} className="flex justify-between items-center text-sm">
                      <span className="capitalize">{plan}</span>
                      <span className="font-mono text-muted">{String(count)}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card title="Trạng thái user">
                <Row label="Tổng" value={stats.users.total} />
                <Row label="Bị cấm" value={stats.users.banned} tone={stats.users.banned > 0 ? "warn" : "muted"} />
                <Row label="Active tuần này" value={stats.users.wau} />
                <Row label="Active tháng này" value={stats.users.mau} />
              </Card>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}

function Stat({ icon: Icon, label, value, hint, tone = "default" }: any) {
  const toneColor =
    tone === "warn" ? "text-yellow-400" :
    tone === "ok"   ? "text-green-400" :
    "text-fg";
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 text-muted text-xs mb-2">
        <Icon size={12} />
        <span>{label}</span>
      </div>
      <div className={`text-2xl font-semibold ${toneColor}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted mt-1">{hint}</div>}
    </div>
  );
}

function Card({ title, children }: any) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, tone = "default" }: any) {
  const color = tone === "warn" ? "text-yellow-400" : "text-fg";
  return (
    <div className="flex justify-between items-center py-1.5 text-sm border-b border-border last:border-0">
      <span className="text-muted">{label}</span>
      <span className={`font-mono ${color}`}>{value}</span>
    </div>
  );
}
