"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import Shell from "@/components/Shell";
import { fetchPlans, updatePlan } from "@/lib/api";

export default function PlansPage() {
  const [plans, setPlans] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { setPlans((await fetchPlans()).plans); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Shell>
      <div className="p-8 max-w-6xl">
        <h1 className="text-xl font-semibold mb-5">Gói dịch vụ</h1>

        {loading && !plans && (
          <div className="flex items-center gap-2 text-muted text-sm">
            <Loader2 size={14} className="animate-spin" /> Đang tải…
          </div>
        )}

        {plans && (
          <div className="space-y-3">
            {plans.map((p) => <PlanRow key={p.id} plan={p} onSaved={load} />)}
          </div>
        )}
      </div>
    </Shell>
  );
}

function PlanRow({ plan, onSaved }: any) {
  const [priceVnd, setPriceVnd] = useState(plan.price_vnd);
  const [ltdVnd, setLtdVnd] = useState(plan.ltd?.price_vnd || 0);
  const [ltdSlots, setLtdSlots] = useState(
    (plan.ltd?.slots_available ?? 0) + 0 // server trả slots_available = total - taken
  );
  const [active, setActive] = useState(plan.is_active);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await updatePlan(plan.id, {
        price_vnd: priceVnd,
        ltd_price_vnd: ltdVnd,
        is_active: active,
      });
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div className="bg-surface border border-border rounded-lg">
      <div className="p-4 flex items-center justify-between cursor-pointer"
           onClick={() => setExpanded((x) => !x)}>
        <div>
          <div className="flex items-center gap-3">
            <span className="text-base font-semibold">{plan.name}</span>
            <span className="text-xs font-mono text-muted">{plan.id}</span>
            {!plan.is_active && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400">INACTIVE</span>
            )}
          </div>
          <div className="text-xs text-muted mt-1">
            {plan.price_vnd === 0 ? "Miễn phí" : `${plan.price_vnd.toLocaleString()}đ/tháng`}
            {plan.ltd && plan.ltd.price_vnd > 0 &&
              ` · LTD ${plan.ltd.price_vnd.toLocaleString()}đ (${plan.ltd.slots_available} suất)`}
          </div>
        </div>
        <span className="text-xs text-muted">{expanded ? "Thu gọn" : "Sửa"}</span>
      </div>

      {expanded && (
        <div className="border-t border-border p-4 space-y-3">
          <Field label="Giá VND/tháng">
            <input type="number" value={priceVnd}
                   onChange={(e) => setPriceVnd(parseInt(e.target.value) || 0)}
                   className="w-full h-9 px-3 text-sm bg-bg border border-border rounded-md font-mono" />
          </Field>
          <Field label="Giá LTD (trọn đời) VND">
            <input type="number" value={ltdVnd}
                   onChange={(e) => setLtdVnd(parseInt(e.target.value) || 0)}
                   className="w-full h-9 px-3 text-sm bg-bg border border-border rounded-md font-mono" />
          </Field>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span className="text-sm">Đang hoạt động (hiển thị cho user)</span>
          </label>

          <details className="mt-2">
            <summary className="text-xs text-muted cursor-pointer">Xem features + limits raw (JSON)</summary>
            <pre className="mt-2 p-2 bg-bg border border-border rounded text-[11px] font-mono text-muted overflow-auto">
{JSON.stringify({ features: plan.features, limits: plan.limits }, null, 2)}
            </pre>
            <p className="text-[11px] text-muted mt-1">
              Edit chi tiết features/limits qua API (chưa có UI). Hoặc ALTER trực tiếp bảng plans.
            </p>
          </details>

          <button onClick={save} disabled={saving}
                  className="h-9 px-4 bg-accent hover:bg-accent-hover text-sm font-medium rounded-md disabled:opacity-50">
            {saving ? "Đang lưu…" : "Lưu thay đổi"}
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: any) {
  return (
    <div>
      <div className="text-xs text-muted mb-1">{label}</div>
      {children}
    </div>
  );
}
