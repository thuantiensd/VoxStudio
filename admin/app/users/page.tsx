"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Search, Loader2, ChevronLeft, ChevronRight, Trash2, AlertTriangle,
  Users as UsersIcon, Crown, UserPlus, Ban as BanIcon, Download, RefreshCcw,
} from "lucide-react";
import Shell from "@/components/Shell";
import { fetchUsers, fetchStats, updateUser, purgeUser } from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";
import { PlanBadge, StatusBadge, VerifiedBadge, relativeTime } from "@/components/Badges";
import { UserDetailDrawer } from "@/components/UserDetailDrawer";

export default function UsersPage() {
  const [data, setData] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [plan, setPlan] = useState("");
  const [banned, setBanned] = useState<"" | "only" | "hide">("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  const [editing, setEditing] = useState<any | null>(null);
  const [purging, setPurging] = useState<any | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        fetchUsers({ q, plan, banned, page, per_page: perPage }),
        fetchStats().catch(() => null),
      ]);
      setData(r);
      if (s) setStats(s);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, plan, banned, perPage]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    load();
  }

  function exportCSV() {
    if (!data?.users) return;
    const rows = [
      ["ID", "Email", "Name", "Plan", "Role", "Verified", "Banned", "Created"],
      ...data.users.map((u: any) => [
        u.id, u.email, u.name || "", u.plan, u.role,
        u.email_verified ? "yes" : "no",
        u.is_banned ? "yes" : "no",
        u.created_at || "",
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voxstudio-users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalPages = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1),
    [data],
  );

  return (
    <Shell>
      <div className="p-8 max-w-7xl">
        {/* Header */}
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Người dùng</h1>
            <p className="text-xs text-muted mt-0.5">
              Quản lý tài khoản, gói dịch vụ, và quyền truy cập.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load}
                    title="Refresh"
                    className="p-2 rounded-md border border-border hover:bg-white/5">
              <RefreshCcw size={13} className={loading ? "animate-spin" : ""} />
            </button>
            <button onClick={exportCSV}
                    disabled={!data?.users?.length}
                    className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-border hover:bg-white/5 text-xs font-medium disabled:opacity-40">
              <Download size={12} />
              Export CSV
            </button>
          </div>
        </div>

        {/* Stats cards */}
        {stats?.users && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <StatCard
              icon={UsersIcon}
              label="Tổng user"
              value={stats.users.total}
              tint="bg-blue-500/10 text-blue-400"
            />
            <StatCard
              icon={Crown}
              label="Trả phí"
              value={
                (stats.users.by_plan?.pro || 0) +
                (stats.users.by_plan?.studio || 0)
              }
              tint="bg-purple-500/10 text-purple-400"
              hint={`${stats.users.by_plan?.pro || 0} Pro · ${stats.users.by_plan?.studio || 0} Studio`}
            />
            <StatCard
              icon={UserPlus}
              label="Mới hôm nay"
              value={stats.users.new_today}
              tint="bg-green-500/10 text-green-400"
              hint={`${stats.users.dau || 0} DAU · ${stats.users.wau || 0} WAU`}
            />
            <StatCard
              icon={BanIcon}
              label="Bị cấm"
              value={stats.users.banned}
              tint="bg-red-500/10 text-red-400"
            />
          </div>
        )}

        {/* Filter bar */}
        <form onSubmit={onSubmit}
              className="flex flex-wrap gap-2 mb-5 bg-surface border border-border rounded-lg p-3">
          <div className="flex-1 min-w-[200px] flex items-center gap-2 bg-bg border border-border rounded-md px-3">
            <Search size={14} className="text-muted" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm theo email hoặc tên…"
              className="flex-1 h-9 bg-transparent outline-none text-sm"
            />
          </div>
          <select value={plan} onChange={(e) => setPlan(e.target.value)}
                  className="h-9 px-3 text-sm bg-bg border border-border rounded-md">
            <option value="">Mọi gói</option>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="studio">Studio</option>
          </select>
          <select value={banned} onChange={(e) => setBanned(e.target.value as any)}
                  className="h-9 px-3 text-sm bg-bg border border-border rounded-md">
            <option value="">Mọi trạng thái</option>
            <option value="only">Chỉ bị cấm</option>
            <option value="hide">Ẩn bị cấm</option>
          </select>
          <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
                  className="h-9 px-3 text-sm bg-bg border border-border rounded-md">
            <option value="25">25 / trang</option>
            <option value="50">50 / trang</option>
            <option value="100">100 / trang</option>
          </select>
          <button type="submit"
                  className="h-9 px-4 bg-accent hover:bg-accent-hover text-sm font-semibold rounded-md">
            Tìm
          </button>
        </form>

        {/* Loading skeleton */}
        {loading && !data && (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="border-b border-border last:border-0 p-4 flex items-center gap-3 animate-pulse">
                <div className="w-9 h-9 rounded-full bg-white/5" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-48 bg-white/5 rounded" />
                  <div className="h-2 w-32 bg-white/5 rounded" />
                </div>
                <div className="h-5 w-14 bg-white/5 rounded" />
                <div className="h-5 w-20 bg-white/5 rounded" />
              </div>
            ))}
          </div>
        )}

        {/* Table */}
        {data && (
          <>
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted text-[10px] uppercase tracking-wider border-b border-border bg-bg/30">
                    <th className="text-left p-3 font-semibold">User</th>
                    <th className="text-left p-3 font-semibold">Gói</th>
                    <th className="text-left p-3 font-semibold">Trạng thái</th>
                    <th className="text-left p-3 font-semibold">Hoạt động cuối</th>
                    <th className="text-left p-3 font-semibold">Đăng ký</th>
                    <th className="text-right p-3 font-semibold w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u: any) => (
                    <tr key={u.id}
                        onClick={() => setDetailId(u.id)}
                        className="border-b border-border last:border-0 hover:bg-white/[0.02] cursor-pointer transition-colors">
                      <td className="p-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <UserAvatar
                            email={u.email}
                            name={u.name}
                            src={u.avatar}
                            size={36}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-sm truncate max-w-[260px]">
                                {u.name || u.email.split("@")[0]}
                              </span>
                              <VerifiedBadge verified={u.email_verified} />
                              {u.role === "admin" && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-yellow-500/15 text-yellow-400 uppercase tracking-wider">
                                  Admin
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-muted truncate font-mono">
                              {u.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-3">
                        <PlanBadge plan={u.plan} />
                      </td>
                      <td className="p-3">
                        <StatusBadge banned={u.is_banned} />
                      </td>
                      <td className="p-3 text-xs text-muted">
                        {u.last_active_at ? relativeTime(u.last_active_at) : "—"}
                      </td>
                      <td className="p-3 text-xs text-muted">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString("vi-VN") : "—"}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditing(u); }}
                          className="text-xs text-accent hover:underline mr-3">
                          Sửa
                        </button>
                        {u.role !== "admin" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setPurging(u); }}
                            title="Xoá vĩnh viễn"
                            className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300 hover:underline">
                            <Trash2 size={11} /> Xoá
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.users.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-12 text-center">
                        <UsersIcon size={32} className="text-muted mx-auto mb-2 opacity-40" />
                        <div className="text-sm text-muted">Không có user nào khớp điều kiện.</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4 text-xs">
              <div className="text-muted">
                Hiển thị <b className="text-fg">{data.users.length}</b> trong tổng số{" "}
                <b className="text-fg">{data.total}</b> user
              </div>
              <div className="flex items-center gap-3">
                <button disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                        className="p-1.5 rounded border border-border hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronLeft size={13} />
                </button>
                <span className="text-muted">
                  Trang <b className="text-fg">{data.page}</b> / {totalPages}
                </span>
                <button disabled={page >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                        className="p-1.5 rounded border border-border hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </>
        )}

        {/* Detail drawer */}
        <UserDetailDrawer
          userId={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(u) => { setDetailId(null); setEditing(u); }}
          onPurge={(u) => { setDetailId(null); setPurging(u); }}
          onBanToggle={async (u) => {
            await updateUser(u.id, { is_banned: !u.is_banned });
            setDetailId(null);
            load();
          }}
        />

        {/* Modals */}
        {editing && (
          <EditModal
            user={editing}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); load(); }}
          />
        )}

        {purging && (
          <PurgeModal
            user={purging}
            onClose={() => setPurging(null)}
            onPurged={() => { setPurging(null); load(); }}
          />
        )}
      </div>
    </Shell>
  );
}

function StatCard({
  icon: Icon, label, value, tint, hint,
}: {
  icon: any;
  label: string;
  value: number;
  tint: string;
  hint?: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-start justify-between mb-2">
        <div className={`w-8 h-8 rounded-md ${tint} flex items-center justify-center`}>
          <Icon size={14} />
        </div>
      </div>
      <div className="text-2xl font-semibold tracking-tight">
        {value.toLocaleString("vi-VN")}
      </div>
      <div className="text-xs text-muted mt-0.5">{label}</div>
      {hint && (
        <div className="text-[10px] text-muted mt-1.5 truncate">{hint}</div>
      )}
    </div>
  );
}

function EditModal({ user, onClose, onSaved }: any) {
  const [plan, setPlan] = useState(user.plan);
  const [role, setRole] = useState(user.role);
  const [isBanned, setIsBanned] = useState(user.is_banned);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      await updateUser(user.id, { plan, role, is_banned: isBanned });
      onSaved();
    } catch (e: any) {
      setError(e?.detail || e?.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose}
         className="fixed inset-0 bg-black/60 backdrop-blur flex items-center justify-center z-50 p-4">
      <div onClick={(e) => e.stopPropagation()}
           className="w-full max-w-md bg-surface border border-border rounded-xl p-5">
        <div className="text-xs text-muted uppercase tracking-wider">Sửa user</div>
        <div className="text-base font-semibold mt-0.5 mb-4 truncate">{user.email}</div>

        {error && (
          <div className="mb-3 p-2 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-400">
            {error}
          </div>
        )}

        <Field label="Gói">
          <select value={plan} onChange={(e) => setPlan(e.target.value)}
                  className="w-full h-9 px-3 text-sm bg-bg border border-border rounded-md">
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="studio">Studio</option>
          </select>
        </Field>

        <Field label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value)}
                  className="w-full h-9 px-3 text-sm bg-bg border border-border rounded-md">
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </Field>

        <label className="flex items-center gap-2 mt-3 cursor-pointer">
          <input type="checkbox" checked={isBanned}
                 onChange={(e) => setIsBanned(e.target.checked)} />
          <span className="text-sm">Cấm tài khoản này (không thể đăng nhập)</span>
        </label>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose}
                  className="flex-1 h-9 border border-border rounded-md text-sm hover:bg-white/5">
            Huỷ
          </button>
          <button onClick={save} disabled={saving}
                  className="flex-1 h-9 bg-accent hover:bg-accent-hover text-sm font-medium rounded-md disabled:opacity-50">
            {saving ? "Đang lưu…" : "Lưu"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: any) {
  return (
    <div className="mb-3">
      <div className="text-xs text-muted mb-1">{label}</div>
      {children}
    </div>
  );
}

function PurgeModal({ user, onClose, onPurged }: any) {
  const [confirmText, setConfirmText] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = confirmText === "DELETE";

  async function doPurge() {
    setWorking(true);
    setError("");
    try {
      await purgeUser(user.id);
      onPurged();
    } catch (e: any) {
      setError(e?.detail || e?.message || "Lỗi xoá");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div onClick={() => !working && onClose()}
         className="fixed inset-0 bg-black/60 backdrop-blur flex items-center justify-center z-50 p-4">
      <div onClick={(e) => e.stopPropagation()}
           className="w-full max-w-md bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-9 h-9 rounded-lg bg-red-500/15 text-red-400 flex items-center justify-center">
            <AlertTriangle size={18} />
          </div>
          <div>
            <div className="text-base font-semibold">Xoá user vĩnh viễn?</div>
            <div className="text-xs text-muted">Hành động không thể hoàn tác</div>
          </div>
        </div>

        <div className="bg-bg/50 border border-border rounded-md p-3 mb-3 text-xs space-y-1.5">
          <div className="flex gap-2">
            <span className="w-16 text-muted flex-shrink-0">Email</span>
            <span className="font-medium truncate">{user.email}</span>
          </div>
          <div className="flex gap-2">
            <span className="w-16 text-muted flex-shrink-0">Tên</span>
            <span>{user.name || "—"}</span>
          </div>
          <div className="flex gap-2">
            <span className="w-16 text-muted flex-shrink-0">Gói</span>
            <span className="capitalize">{user.plan}</span>
          </div>
          <div className="flex gap-2">
            <span className="w-16 text-muted flex-shrink-0">ID</span>
            <span className="font-mono">{user.id}</span>
          </div>
        </div>

        <div className="text-xs text-muted leading-relaxed mb-3">
          Sẽ <b className="text-fg">xoá vĩnh viễn</b>:
          <ul className="list-disc ml-5 mt-1 space-y-0.5">
            <li>Tài khoản user trong DB</li>
            <li>Mọi giao dịch thanh toán của user</li>
            <li>Voice clones + file embedding trên server</li>
            <li>Lịch sử jobs, usage events</li>
          </ul>
          <div className="mt-2 text-yellow-500/90">
            Audit log sẽ giữ lại (ẩn danh user_id).
          </div>
        </div>

        <div className="mb-3">
          <label className="block text-xs text-muted mb-1.5">
            Gõ <code className="px-1 py-0.5 rounded bg-red-500/15 text-red-400 font-mono">DELETE</code> để xác nhận
          </label>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            disabled={working}
            className="w-full h-9 px-3 text-sm bg-bg border border-border rounded-md font-mono
                       focus:outline-none focus:border-red-500/50 disabled:opacity-50"
          />
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 rounded text-xs bg-red-500/15 text-red-400 border border-red-500/30">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} disabled={working}
                  className="flex-1 h-9 border border-border rounded-md text-sm hover:bg-white/5 disabled:opacity-40">
            Huỷ
          </button>
          <button onClick={doPurge} disabled={!canSubmit || working}
                  className="flex-1 h-9 rounded-md text-sm font-semibold bg-red-600 hover:bg-red-500 text-white
                             disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
            {working ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            Xoá vĩnh viễn
          </button>
        </div>
      </div>
    </div>
  );
}
