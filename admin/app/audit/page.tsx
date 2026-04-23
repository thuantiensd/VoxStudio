"use client";
import { useEffect, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import Shell from "@/components/Shell";
import { fetchAudit } from "@/lib/api";

export default function AuditPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);

  async function load() {
    setLoading(true);
    try { setData(await fetchAudit({ action, page, per_page: 50 })); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [action, page]);

  return (
    <Shell>
      <div className="p-8 max-w-6xl">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-semibold">Audit log</h1>
          <button onClick={load} className="p-1.5 hover:bg-white/5 rounded">
            <RefreshCcw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        <div className="flex gap-2 mb-5">
          <select value={action} onChange={(e) => { setPage(1); setAction(e.target.value); }}
                   className="h-8 px-3 text-sm bg-surface border border-border rounded-md">
            <option value="">Mọi action</option>
            <option value="login_success">Login</option>
            <option value="login_failed">Login fail</option>
            <option value="register">Register</option>
            <option value="logout">Logout</option>
            <option value="admin_update_user">Admin update user</option>
            <option value="admin_update_flag">Admin update flag</option>
            <option value="admin_cancel_job">Admin cancel job</option>
            <option value="admin_update_plan">Admin update plan</option>
          </select>
        </div>

        {loading && !data && (
          <div className="flex items-center gap-2 text-muted text-sm">
            <Loader2 size={14} className="animate-spin" /> Đang tải…
          </div>
        )}

        {data && (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted text-xs uppercase border-b border-border">
                  <th className="text-left p-3">Thời gian</th>
                  <th className="text-left p-3">User</th>
                  <th className="text-left p-3">Action</th>
                  <th className="text-left p-3">Target</th>
                  <th className="text-left p-3">IP</th>
                  <th className="text-left p-3">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r: any) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="p-3 text-xs text-muted">
                      {new Date(r.created_at).toLocaleString("vi-VN")}
                    </td>
                    <td className="p-3 font-mono text-xs">{r.user_id ? `#${r.user_id}` : "—"}</td>
                    <td className="p-3 font-mono text-xs">{r.action}</td>
                    <td className="p-3 text-xs text-muted">
                      {r.target_type ? `${r.target_type}:${r.target_id}` : "—"}
                    </td>
                    <td className="p-3 font-mono text-[11px] text-muted">{r.ip || "—"}</td>
                    <td className="p-3 text-[11px] text-muted font-mono max-w-xs truncate">
                      {r.metadata ? JSON.stringify(r.metadata) : "—"}
                    </td>
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-muted text-sm">
                    Chưa có log.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
