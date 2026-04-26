"use client";
import { useEffect, useState } from "react";
import { Check, Loader2, RefreshCcw, Copy, X, AlertTriangle } from "lucide-react";
import Shell from "@/components/Shell";
import { fetchPayments, confirmPayment, rejectPayment } from "@/lib/api";

const STATUS_COLOR: Record<string, string> = {
  pending:   "bg-yellow-500/15 text-yellow-400",
  paid:      "bg-green-500/15 text-green-400",
  cancelled: "bg-zinc-500/15 text-zinc-400",
};

type Action = "confirm" | "reject";

export default function PaymentsPage() {
  const [data, setData] = useState<{ payments: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("pending");
  const [err, setErr] = useState("");

  // Modal state
  const [modal, setModal] = useState<{ payment: any; action: Action } | null>(null);

  async function load() {
    setLoading(true); setErr("");
    try {
      const r = await fetchPayments(status, 200);
      setData(r);
    } catch (e: any) {
      setErr(e?.detail || e?.message || "Lỗi tải danh sách");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  function copy(text: string) {
    try { navigator.clipboard?.writeText(text); } catch {}
  }

  return (
    <Shell>
      <div className="p-8 max-w-7xl">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-semibold">Thanh toán</h1>
            <p className="text-xs text-muted mt-0.5">
              Xác nhận chuyển khoản tay → kích hoạt gói cho user.
            </p>
          </div>
          <button onClick={load} className="p-1.5 hover:bg-white/5 rounded">
            <RefreshCcw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        <div className="flex gap-2 mb-5">
          <select value={status} onChange={(e) => setStatus(e.target.value)}
                  className="h-8 px-3 text-sm bg-surface border border-border rounded-md">
            <option value="pending">Chờ xác nhận</option>
            <option value="paid">Đã xác nhận</option>
            <option value="cancelled">Đã huỷ</option>
            <option value="all">Tất cả</option>
          </select>
        </div>

        {err && (
          <div className="mb-4 px-3 py-2 rounded text-xs bg-red-500/15 text-red-400 border border-red-500/30">
            {err}
          </div>
        )}

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
                  <th className="text-left p-3">Ref code</th>
                  <th className="text-left p-3">User</th>
                  <th className="text-left p-3">Plan</th>
                  <th className="text-right p-3">Số tiền</th>
                  <th className="text-left p-3">Trạng thái</th>
                  <th className="text-left p-3">Tạo lúc</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((p: any) => (
                  <tr key={p.ref_code} className="border-b border-border last:border-0">
                    <td className="p-3 font-mono text-xs">
                      <button onClick={() => copy(p.ref_code)}
                              className="inline-flex items-center gap-1 hover:text-fg"
                              title="Copy">
                        {p.ref_code}
                        <Copy size={10} className="text-muted" />
                      </button>
                    </td>
                    <td className="p-3 text-xs">
                      <div className="font-medium">{p.user_name || "—"}</div>
                      <div className="text-muted text-[11px]">{p.user_email}</div>
                    </td>
                    <td className="p-3 text-xs">
                      <span className="capitalize">{p.plan_id}</span>
                      {p.is_ltd && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-purple-500/15 text-purple-400">
                          LTD
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right font-mono text-xs">
                      {p.amount_vnd?.toLocaleString("vi-VN")}đ
                      {p.amount_usd > 0 && (
                        <div className="text-muted text-[10px]">
                          ${(p.amount_usd / 100).toFixed(2)}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[11px] ${STATUS_COLOR[p.status] || ""}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="p-3 text-muted text-xs">
                      {p.created_at ? new Date(p.created_at).toLocaleString("vi-VN") : ""}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {p.status === "pending" && (
                        <div className="inline-flex gap-1.5">
                          <button
                            onClick={() => setModal({ payment: p, action: "confirm" })}
                            className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs
                                       bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors">
                            <Check size={12} /> Xác nhận
                          </button>
                          <button
                            onClick={() => setModal({ payment: p, action: "reject" })}
                            className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs
                                       bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors">
                            <X size={12} /> Từ chối
                          </button>
                        </div>
                      )}
                      {p.status !== "pending" && p.note && (
                        <span title={p.note} className="text-muted text-[11px] italic">
                          ghi chú
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {data.payments.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-muted text-sm">
                    Không có payment nào.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <ActionModal
          payment={modal.payment}
          action={modal.action}
          otherPendings={
            (data?.payments || []).filter(
              (x: any) =>
                x.user_id === modal.payment.user_id &&
                x.ref_code !== modal.payment.ref_code &&
                x.status === "pending",
            )
          }
          onClose={() => setModal(null)}
          onDone={async () => { setModal(null); await load(); }}
        />
      )}
    </Shell>
  );
}

function ActionModal({
  payment, action, otherPendings, onClose, onDone,
}: {
  payment: any;
  action: Action;
  otherPendings: any[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const isConfirm = action === "confirm";

  async function submit() {
    setLoading(true); setErr("");
    try {
      if (isConfirm) await confirmPayment(payment.ref_code, note || undefined);
      else await rejectPayment(payment.ref_code, note || undefined);
      onDone();
    } catch (e: any) {
      setErr(e?.detail || e?.message || "Lỗi xử lý");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4
                 bg-black/60 backdrop-blur-sm"
    >
      <div className="w-full max-w-md bg-surface border border-border rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2.5 p-4 border-b border-border">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              isConfirm
                ? "bg-green-500/15 text-green-400"
                : "bg-red-500/15 text-red-400"
            }`}>
            {isConfirm ? <Check size={16} /> : <AlertTriangle size={16} />}
          </div>
          <h2 className="flex-1 text-base font-semibold">
            {isConfirm ? "Xác nhận thanh toán" : "Từ chối thanh toán"}
          </h2>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1.5 hover:bg-white/5 rounded text-muted hover:text-fg
                       disabled:opacity-40">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted leading-relaxed">
            {isConfirm
              ? "Sau khi xác nhận, gói sẽ được kích hoạt ngay cho user. Hành động này không thể hoàn tác."
              : "Giao dịch sẽ chuyển sang trạng thái Đã huỷ. Hành động này không thể hoàn tác."}
          </p>

          <div className="bg-bg/50 border border-border rounded-md p-3 space-y-2 text-xs">
            <Row label="Mã" value={payment.ref_code} mono />
            <Row label="User" value={`${payment.user_name || "—"} (${payment.user_email})`} />
            <Row
              label="Gói"
              value={
                <>
                  <span className="capitalize">{payment.plan_id}</span>
                  {payment.is_ltd && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-purple-500/15 text-purple-400">
                      LTD
                    </span>
                  )}
                </>
              }
            />
            <Row
              label="Số tiền"
              value={
                <span className="font-semibold">
                  {payment.amount_vnd?.toLocaleString("vi-VN")}đ
                  {payment.amount_usd > 0 && (
                    <span className="text-muted font-normal ml-1.5">
                      (${(payment.amount_usd / 100).toFixed(2)})
                    </span>
                  )}
                </span>
              }
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1.5">
              Ghi chú {isConfirm ? "(tuỳ chọn)" : "— lý do từ chối"}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={
                isConfirm
                  ? "VD: Đã đối chiếu sao kê 26/04"
                  : "VD: Sai số tiền / Không thấy giao dịch trong sao kê"
              }
              disabled={loading}
              className="w-full px-2.5 py-2 text-xs bg-bg border border-border rounded-md
                         focus:outline-none focus:border-accent
                         disabled:opacity-50 resize-none"
            />
          </div>

          {isConfirm && otherPendings.length > 0 && (
            <div className="px-3 py-2 rounded text-xs bg-yellow-500/10 text-yellow-300
                            border border-yellow-500/30 leading-relaxed">
              <div className="flex items-center gap-1.5 font-medium mb-1">
                <AlertTriangle size={12} />
                User này còn {otherPendings.length} giao dịch pending khác
              </div>
              <ul className="ml-4 list-disc space-y-0.5 text-yellow-200/80">
                {otherPendings.map((o) => (
                  <li key={o.ref_code}>
                    <span className="font-mono">{o.ref_code}</span>
                    {" — "}
                    <span className="capitalize">{o.plan_id}</span>
                    {o.is_ltd && " (LTD)"}
                    {" — "}
                    {o.amount_vnd?.toLocaleString("vi-VN")}đ
                  </li>
                ))}
              </ul>
              <div className="mt-1.5 text-yellow-200/70">
                Sẽ tự huỷ khi xác nhận giao dịch này.
              </div>
            </div>
          )}

          {err && (
            <div className="px-3 py-2 rounded text-xs bg-red-500/15 text-red-400
                            border border-red-500/30">
              {err}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-4 border-t border-border">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 h-9 rounded-md text-xs font-medium border border-border
                       hover:bg-white/5 disabled:opacity-40">
            Huỷ
          </button>
          <button
            onClick={submit}
            disabled={loading}
            className={`flex-1 h-9 rounded-md text-xs font-medium inline-flex items-center justify-center gap-1.5
                        text-white disabled:opacity-50 transition-colors ${
                          isConfirm
                            ? "bg-green-600 hover:bg-green-500"
                            : "bg-red-600 hover:bg-red-500"
                        }`}>
            {loading
              ? <Loader2 size={13} className="animate-spin" />
              : (isConfirm ? <Check size={13} /> : <X size={13} />)}
            {isConfirm ? "Xác nhận" : "Từ chối"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-16 flex-shrink-0 text-muted">{label}</span>
      <span className={`flex-1 text-fg ${mono ? "font-mono" : ""} break-all`}>
        {value || "—"}
      </span>
    </div>
  );
}
