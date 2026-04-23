"use client";
import { useEffect, useState } from "react";
import { Check, X, Loader2, RefreshCcw } from "lucide-react";
import Shell from "@/components/Shell";
import { fetchHealth } from "@/lib/api";

export default function HealthPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { setData(await fetchHealth()); } finally { setLoading(false); }
  }
  useEffect(() => {
    load();
    const iv = setInterval(() => fetchHealth().then(setData).catch(() => {}), 10000);
    return () => clearInterval(iv);
  }, []);

  return (
    <Shell>
      <div className="p-8 max-w-4xl">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-semibold">Sức khoẻ hệ thống</h1>
          <button onClick={load} className="p-1.5 hover:bg-white/5 rounded">
            <RefreshCcw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {!data && loading && (
          <div className="flex items-center gap-2 text-muted text-sm">
            <Loader2 size={14} className="animate-spin" /> Kiểm tra…
          </div>
        )}

        {data && (
          <div className="grid grid-cols-3 gap-3 mb-5">
            <StatusCard label="Database" ok={data.db} />
            <StatusCard label="GPU" ok={data.gpu_ready} />
            <StatusCard label="Worker" ok={data.worker_alive} />
          </div>
        )}

        {data?.vram && (
          <div className="bg-surface border border-border rounded-lg p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">VRAM</div>
            <pre className="text-[11px] font-mono text-muted overflow-auto">
              {JSON.stringify(data.vram, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </Shell>
  );
}

function StatusCard({ label, ok }: any) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4 flex items-center gap-3">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
        ok ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
      }`}>
        {ok ? <Check size={14} /> : <X size={14} />}
      </div>
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] text-muted">{ok ? "OK" : "Lỗi"}</div>
      </div>
    </div>
  );
}
