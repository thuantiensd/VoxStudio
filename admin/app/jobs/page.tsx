"use client";
import { useEffect, useState } from "react";
import { X, Loader2, RefreshCcw } from "lucide-react";
import Shell from "@/components/Shell";
import { fetchJobs, cancelJob } from "@/lib/api";

const STATUS_COLOR: Record<string, string> = {
  pending:  "bg-zinc-500/15 text-zinc-400",
  running:  "bg-blue-500/15 text-blue-400",
  done:     "bg-green-500/15 text-green-400",
  error:    "bg-red-500/15 text-red-400",
  canceled: "bg-yellow-500/15 text-yellow-400",
};

export default function JobsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");

  async function load() {
    setLoading(true);
    try {
      const r = await fetchJobs({ status, kind, per_page: 50 });
      setData(r);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, kind]);

  // Auto-refresh nếu có job đang chạy / pending
  useEffect(() => {
    const iv = setInterval(() => {
      if (data?.jobs?.some((j: any) => j.status === "running" || j.status === "pending")) {
        fetchJobs({ status, kind, per_page: 50 }).then(setData).catch(() => {});
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [data, status, kind]);

  async function doCancel(id: string) {
    if (!confirm("Huỷ job này?")) return;
    await cancelJob(id);
    load();
  }

  return (
    <Shell>
      <div className="p-8 max-w-7xl">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-semibold">Tác vụ GPU</h1>
          <button onClick={load} className="p-1.5 hover:bg-white/5 rounded">
            <RefreshCcw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        <div className="flex gap-2 mb-5">
          <select value={status} onChange={(e) => setStatus(e.target.value)}
                   className="h-8 px-3 text-sm bg-surface border border-border rounded-md">
            <option value="">Mọi trạng thái</option>
            <option value="pending">Đang chờ</option>
            <option value="running">Đang chạy</option>
            <option value="done">Hoàn thành</option>
            <option value="error">Lỗi</option>
            <option value="canceled">Đã huỷ</option>
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value)}
                   className="h-8 px-3 text-sm bg-surface border border-border rounded-md">
            <option value="">Mọi loại</option>
            <option value="dubbing">Dubbing</option>
            <option value="stt">STT</option>
            <option value="tts">TTS</option>
            <option value="clone">Clone</option>
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
                  <th className="text-left p-3">ID</th>
                  <th className="text-left p-3">User</th>
                  <th className="text-left p-3">Loại</th>
                  <th className="text-left p-3">Trạng thái</th>
                  <th className="text-left p-3">Tiến độ</th>
                  <th className="text-left p-3">Tạo lúc</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((j: any) => (
                  <tr key={j.id} className="border-b border-border last:border-0">
                    <td className="p-3 font-mono text-[10px] text-muted">{j.id.slice(0, 8)}…</td>
                    <td className="p-3 font-mono text-xs">#{j.user_id}</td>
                    <td className="p-3 text-xs capitalize">{j.kind}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[11px] ${STATUS_COLOR[j.status] || ""}`}>
                        {j.status}
                      </span>
                    </td>
                    <td className="p-3 text-xs">
                      {j.status === "running" ? `${Math.round(j.progress)}%` : ""}
                      {j.current_step && <span className="text-muted ml-1">{j.current_step}</span>}
                      {j.error && <span className="text-red-400 text-[11px]" title={j.error}>lỗi</span>}
                    </td>
                    <td className="p-3 text-muted text-xs">
                      {j.created_at ? new Date(j.created_at).toLocaleString("vi-VN") : ""}
                    </td>
                    <td className="p-3 text-right">
                      {(j.status === "pending" || j.status === "running") && (
                        <button onClick={() => doCancel(j.id)}
                                title="Huỷ job"
                                className="p-1 hover:bg-red-500/15 rounded text-red-400">
                          <X size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {data.jobs.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-muted text-sm">
                    Không có job nào.
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
