"use client";
import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import Shell from "@/components/Shell";
import { fetchFlags, upsertFlag, deleteFlag } from "@/lib/api";

export default function FlagsPage() {
  const [flags, setFlags] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try { setFlags((await fetchFlags()).flags); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Shell>
      <div className="p-8 max-w-4xl">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-semibold">Feature flags</h1>
          <button onClick={() => setCreating(true)}
                   className="h-8 px-3 bg-accent hover:bg-accent-hover text-sm font-medium rounded-md flex items-center gap-1.5">
            <Plus size={13} /> Thêm flag
          </button>
        </div>

        {loading && !flags && (
          <div className="flex items-center gap-2 text-muted text-sm">
            <Loader2 size={14} className="animate-spin" /> Đang tải…
          </div>
        )}

        {flags && (
          <div className="space-y-2">
            {flags.map((f) => <FlagRow key={f.name} flag={f} onChange={load} />)}
            {flags.length === 0 && (
              <div className="p-8 text-center text-muted text-sm bg-surface border border-border rounded-lg">
                Chưa có flag nào. Thêm để gate tính năng beta.
              </div>
            )}
          </div>
        )}

        {creating && <CreateModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />}
      </div>
    </Shell>
  );
}

function FlagRow({ flag, onChange }: any) {
  const [enabled, setEnabled] = useState(flag.enabled);
  const [rollout, setRollout] = useState(flag.rollout_percent);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await upsertFlag(flag.name, {
        enabled, rollout_percent: rollout,
        whitelist_user_ids: flag.whitelist_user_ids || [],
        description: flag.description,
      });
      onChange();
    } finally { setSaving(false); }
  }

  async function del() {
    if (!confirm(`Xoá flag "${flag.name}"?`)) return;
    await deleteFlag(flag.name);
    onChange();
  }

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="font-mono text-sm">{flag.name}</div>
          {flag.description && <div className="text-xs text-muted mt-0.5">{flag.description}</div>}
        </div>
        <button onClick={del} className="p-1.5 hover:bg-red-500/15 rounded text-red-400">
          <Trash2 size={13} />
        </button>
      </div>

      <div className="flex items-center gap-4 mt-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={enabled}
                 onChange={(e) => setEnabled(e.target.checked)} />
          <span className="text-sm">Bật</span>
        </label>

        <div className="flex items-center gap-2 flex-1">
          <span className="text-xs text-muted">Rollout</span>
          <input type="range" min={0} max={100} value={rollout}
                 onChange={(e) => setRollout(parseInt(e.target.value))}
                 className="flex-1 max-w-sm" />
          <span className="text-sm font-mono w-10 text-right">{rollout}%</span>
        </div>

        <button onClick={save} disabled={saving}
                 className="h-8 px-3 bg-accent hover:bg-accent-hover text-xs font-medium rounded-md disabled:opacity-50">
          {saving ? "…" : "Lưu"}
        </button>
      </div>

      {flag.whitelist_user_ids?.length > 0 && (
        <div className="mt-2 text-[11px] text-muted">
          Whitelist: {flag.whitelist_user_ids.join(", ")}
        </div>
      )}
    </div>
  );
}

function CreateModal({ onClose, onCreated }: any) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (!name.trim() || !/^[a-z0-9_]+$/i.test(name)) {
      setError("Tên chỉ dùng a-z, 0-9, _ (snake_case)");
      return;
    }
    setSaving(true);
    try {
      await upsertFlag(name.trim(), {
        enabled, rollout_percent: 0,
        whitelist_user_ids: [],
        description: description.trim() || null,
      });
      onCreated();
    } catch (e: any) {
      setError(e?.detail || e?.message);
    } finally { setSaving(false); }
  }

  return (
    <div onClick={onClose}
         className="fixed inset-0 bg-black/60 backdrop-blur flex items-center justify-center z-50">
      <div onClick={(e) => e.stopPropagation()}
           className="w-[420px] bg-surface border border-border rounded-xl p-5">
        <div className="text-base font-semibold mb-4">Thêm feature flag</div>

        {error && (
          <div className="mb-3 p-2 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="text-xs text-muted mb-1">Tên (snake_case)</div>
        <input value={name} onChange={(e) => setName(e.target.value)}
               placeholder="image_gen_beta"
               className="w-full h-9 px-3 mb-3 text-sm bg-bg border border-border rounded-md font-mono" />

        <div className="text-xs text-muted mb-1">Mô tả (optional)</div>
        <input value={description} onChange={(e) => setDescription(e.target.value)}
               placeholder="Tính năng tạo ảnh AI dùng Flux"
               className="w-full h-9 px-3 mb-3 text-sm bg-bg border border-border rounded-md" />

        <label className="flex items-center gap-2 mt-3 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="text-sm">Bật ngay (rollout 0% - dùng whitelist để test)</span>
        </label>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 h-9 border border-border rounded-md text-sm hover:bg-white/5">Huỷ</button>
          <button onClick={create} disabled={saving || !name.trim()}
                   className="flex-1 h-9 bg-accent hover:bg-accent-hover text-sm font-medium rounded-md disabled:opacity-50">
            {saving ? "…" : "Tạo"}
          </button>
        </div>
      </div>
    </div>
  );
}
