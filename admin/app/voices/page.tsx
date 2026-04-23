"use client";
import { useEffect, useState } from "react";
import { Loader2, Trash2, Mic2 } from "lucide-react";
import Shell from "@/components/Shell";
import { api } from "@/lib/api";

export default function VoicesPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filterUserId, setFilterUserId] = useState("");

  async function load() {
    setLoading(true);
    try {
      const qs = filterUserId ? `?user_id=${filterUserId}` : "";
      const r = await api<any>(`/admin/voices${qs}`);
      setData(r);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filterUserId]);

  async function del(id: string, name: string) {
    if (!confirm(`Xoá giọng "${name}"? Hành động không thể undo.`)) return;
    await api(`/admin/voices/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <Shell>
      <div className="p-8 max-w-6xl">
        <h1 className="text-xl font-semibold mb-5">Giọng clone</h1>

        <div className="flex gap-2 mb-5">
          <input
            type="number"
            placeholder="Lọc theo user_id (để trống = tất cả)"
            value={filterUserId}
            onChange={(e) => setFilterUserId(e.target.value)}
            className="h-8 px-3 text-sm bg-surface border border-border rounded-md w-64" />
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
                  <th className="text-left p-3">Owner</th>
                  <th className="text-left p-3">Tên</th>
                  <th className="text-left p-3">Tags</th>
                  <th className="text-left p-3">Prompt</th>
                  <th className="text-left p-3">Tạo lúc</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.voices.map((v: any) => (
                  <tr key={v.id} className="border-b border-border last:border-0">
                    <td className="p-3 font-mono text-[10px] text-muted">{v.id}</td>
                    <td className="p-3 font-mono text-xs">#{v.user_id}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        <Mic2 size={12} className="text-muted" />
                        {v.name}
                      </div>
                      {v.ref_text && (
                        <div className="text-[11px] text-muted truncate max-w-sm mt-0.5">
                          {v.ref_text}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted">
                      {v.tags?.join(", ") || "—"}
                    </td>
                    <td className="p-3">
                      {v.has_prompt
                        ? <span className="text-green-400 text-[11px]">OK</span>
                        : <span className="text-yellow-400 text-[11px]">WAV only</span>}
                    </td>
                    <td className="p-3 text-muted text-xs">
                      {v.created_at ? new Date(v.created_at).toLocaleDateString("vi-VN") : ""}
                    </td>
                    <td className="p-3 text-right">
                      <button onClick={() => del(v.id, v.name)}
                              className="p-1.5 hover:bg-red-500/15 rounded text-red-400">
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
                {data.voices.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-muted text-sm">
                    Không có giọng nào.
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
