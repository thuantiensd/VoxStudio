"use client";
import { useEffect, useState } from "react";
import {
  X, Loader2, Wallet, Activity, Calendar, Mail, Crown, Trash2, Edit3, Ban,
} from "lucide-react";
import { fetchUserDetail } from "@/lib/api";
import { UserAvatar } from "./UserAvatar";
import { PlanBadge, StatusBadge, VerifiedBadge, RoleBadge, relativeTime } from "./Badges";

const PAYMENT_STATUS_COLOR: Record<string, string> = {
  pending:   "bg-yellow-500/15 text-yellow-400",
  paid:      "bg-green-500/15 text-green-400",
  cancelled: "bg-zinc-500/15 text-zinc-400",
};

type Tab = "profile" | "payments" | "activity";

export function UserDetailDrawer({
  userId, onClose, onEdit, onPurge, onBanToggle,
}: {
  userId: number | null;
  onClose: () => void;
  onEdit: (user: any) => void;
  onPurge: (user: any) => void;
  onBanToggle: (user: any) => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("profile");

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setData(null);
    setTab("profile");
    fetchUserDetail(userId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [userId]);

  if (!userId) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Backdrop */}
      <div onClick={onClose}
           className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Drawer */}
      <div className="relative w-full max-w-[520px] h-full bg-bg border-l border-border
                      flex flex-col overflow-hidden shadow-2xl">
        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin text-muted" />
          </div>
        )}

        {data && (
          <>
            {/* Header */}
            <div className="px-5 pt-5 pb-4 border-b border-border bg-surface">
              <div className="flex items-start justify-between mb-4">
                <div className="text-xs uppercase tracking-wider text-muted">Chi tiết user</div>
                <button onClick={onClose}
                        className="p-1.5 rounded-md hover:bg-white/5 text-muted hover:text-fg">
                  <X size={14} />
                </button>
              </div>

              <div className="flex items-center gap-3.5">
                <UserAvatar
                  email={data.user.email}
                  name={data.user.name}
                  src={data.user.avatar}
                  size={56}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold truncate">
                      {data.user.name || data.user.email.split("@")[0]}
                    </h2>
                    <VerifiedBadge verified={data.user.email_verified} />
                  </div>
                  <div className="text-xs text-muted truncate font-mono">{data.user.email}</div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <PlanBadge plan={data.user.plan} />
                    <StatusBadge banned={data.user.is_banned} />
                    <RoleBadge role={data.user.role} />
                  </div>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2 mt-4">
                <Stat
                  icon={Wallet}
                  label="Đã chi"
                  value={`${(data.total_spent_vnd || 0).toLocaleString("vi-VN")}đ`}
                />
                <Stat
                  icon={Activity}
                  label="Jobs gần đây"
                  value={String((data.jobs_recent || []).length)}
                />
                <Stat
                  icon={Calendar}
                  label="Đăng ký"
                  value={data.user.created_at
                    ? new Date(data.user.created_at).toLocaleDateString("vi-VN")
                    : "—"}
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-4">
                <button onClick={() => onEdit(data.user)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-md text-xs font-medium border border-border hover:bg-white/5">
                  <Edit3 size={12} /> Sửa
                </button>
                <button onClick={() => onBanToggle(data.user)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-md text-xs font-medium bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25">
                  <Ban size={12} /> {data.user.is_banned ? "Bỏ cấm" : "Cấm"}
                </button>
                {data.user.role !== "admin" && (
                  <button onClick={() => onPurge(data.user)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-md text-xs font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25">
                    <Trash2 size={12} /> Xoá
                  </button>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border bg-surface">
              {(["profile", "payments", "activity"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                    tab === t
                      ? "border-accent text-fg"
                      : "border-transparent text-muted hover:text-fg"
                  }`}
                >
                  {t === "profile" && "Thông tin"}
                  {t === "payments" && `Thanh toán (${(data.payments || []).length})`}
                  {t === "activity" && "Hoạt động"}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-5 text-sm">
              {tab === "profile" && (
                <div className="space-y-3">
                  <Row label="ID" value={data.user.id} mono />
                  <Row label="Email" value={data.user.email} mono />
                  <Row label="Tên" value={data.user.name || "—"} />
                  <Row label="Gói hiện tại" value={<PlanBadge plan={data.user.plan} />} />
                  {data.user.plan_expires_at && (
                    <Row
                      label="Hết hạn"
                      value={new Date(data.user.plan_expires_at).toLocaleString("vi-VN")}
                    />
                  )}
                  <Row label="Role" value={<RoleBadge role={data.user.role} />} />
                  <Row
                    label="Email verified"
                    value={data.user.email_verified ? "✓ Đã xác thực" : "Chưa xác thực"}
                  />
                  <Row
                    label="Tạo lúc"
                    value={data.user.created_at
                      ? new Date(data.user.created_at).toLocaleString("vi-VN")
                      : "—"}
                  />
                  <Row
                    label="Hoạt động cuối"
                    value={data.user.last_active_at
                      ? `${relativeTime(data.user.last_active_at)} (${new Date(data.user.last_active_at).toLocaleString("vi-VN")})`
                      : "Chưa hoạt động"}
                  />

                  {data.usage_month && (
                    <div className="mt-5 pt-5 border-t border-border">
                      <div className="text-xs uppercase tracking-wider text-muted mb-3">
                        Sử dụng tháng này
                      </div>
                      <pre className="bg-surface border border-border rounded-md p-3 text-[11px] font-mono overflow-x-auto">
                        {JSON.stringify(data.usage_month, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {tab === "payments" && (
                <div>
                  {(data.payments || []).length === 0 ? (
                    <div className="text-center py-12 text-muted text-xs">
                      Chưa có giao dịch nào.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {data.payments.map((p: any) => (
                        <div key={p.ref_code}
                             className="bg-surface border border-border rounded-lg p-3 text-xs">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-mono font-semibold">{p.ref_code}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] ${PAYMENT_STATUS_COLOR[p.status] || ""}`}>
                              {p.status}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-muted">
                            <span className="capitalize">
                              {p.plan_id}
                              {p.is_ltd && <span className="ml-1 text-purple-400">(LTD)</span>}
                            </span>
                            <span className="font-mono text-fg font-medium">
                              {p.amount_vnd?.toLocaleString("vi-VN")}đ
                            </span>
                          </div>
                          <div className="text-[10px] text-muted mt-1">
                            {p.paid_at
                              ? `Thanh toán: ${new Date(p.paid_at).toLocaleString("vi-VN")}`
                              : `Tạo: ${new Date(p.created_at).toLocaleString("vi-VN")}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === "activity" && (
                <div className="space-y-2">
                  {(data.audit_recent || []).length === 0 ? (
                    <div className="text-center py-12 text-muted text-xs">
                      Chưa có hoạt động.
                    </div>
                  ) : (
                    data.audit_recent.map((a: any) => (
                      <div key={a.id} className="bg-surface border border-border rounded-md p-2.5 text-xs">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="font-medium">{a.action}</span>
                          <span className="text-[10px] text-muted">
                            {relativeTime(a.created_at)}
                          </span>
                        </div>
                        {a.target_type && (
                          <div className="text-[10px] text-muted">
                            {a.target_type}: {a.target_id}
                          </div>
                        )}
                        {a.ip && <div className="text-[10px] text-muted">IP: {a.ip}</div>}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: any) {
  return (
    <div className="bg-bg/60 border border-border rounded-md px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted mb-0.5">
        <Icon size={10} />
        {label}
      </div>
      <div className="text-sm font-semibold truncate">{value}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 text-xs">
      <span className="w-28 flex-shrink-0 text-muted">{label}</span>
      <span className={`flex-1 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
