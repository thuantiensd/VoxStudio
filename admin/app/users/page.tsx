"use client";
import { useEffect, useState } from "react";
import { Search, Ban, ShieldCheck, Loader2, ChevronLeft, ChevronRight, Trash2, AlertTriangle } from "lucide-react";
import Shell from "@/components/Shell";
import { fetchUsers, updateUser, purgeUser } from "@/lib/api";

export default function UsersPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [plan, setPlan] = useState("");
  const [banned, setBanned] = useState<"" | "only" | "hide">("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<any | null>(null);
  const [purging, setPurging] = useState<any | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetchUsers({ q, plan, banned, page, per_page: 25 });
      setData(r);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, plan, banned]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    load();
  }

  return (
    <Shell>
      <div className="p-8 max-w-6xl">
        <h1 className="text-xl font-semibold mb-5">Người dùng</h1>

        <form onSubmit={onSubmit}
              className="flex gap-2 mb-5 bg-surface border border-border rounded-lg p-3">
          <div className="flex-1 flex items-center gap-2 bg-bg border border-border rounded-md px-3">
            <Search size={14} className="text-muted" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Email hoặc tên…"
              className="flex-1 h-8 bg-transparent outline-none text-sm"
            />
          </div>
          <select value={plan} onChange={(e) => setPlan(e.target.value)}
                   className="h-8 px-2 text-sm bg-bg border border-border rounded-md">
            <option value="">Mọi gói</option>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="studio">Studio</option>
          </select>
          <select value={banned} onChange={(e) => setBanned(e.target.value as any)}
                   className="h-8 px-2 text-sm bg-bg border border-border rounded-md">
            <option value="">Tất cả</option>
            <option value="only">Chỉ bị cấm</option>
            <option value="hide">Ẩn bị cấm</option>
          </select>
          <button type="submit"
                   className="h-8 px-4 bg-accent hover:bg-accent-hover text-sm font-medium rounded-md">
            Tìm
          </button>
        </form>

        {loading && (
          <div className="flex items-center gap-2 text-muted text-sm py-4">
            <Loader2 size={14} className="animate-spin" /> Đang tải…
          </div>
        )}

        {data && (
          <>
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted text-xs uppercase border-b border-border">
                    <th className="text-left p-3">Email</th>
                    <th className="text-left p-3">Tên</th>
                    <th className="text-left p-3">Gói</th>
                    <th className="text-left p-3">Role</th>
                    <th className="text-left p-3">Trạng thái</th>
                    <th className="text-left p-3">Tạo lúc</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u: any) => (
                    <tr key={u.id}
                        className="border-b border-border last:border-0 hover:bg-white/2">
                      <td className="p-3 font-mono text-xs">{u.email}</td>
                      <td className="p-3">{u.name}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded text-[11px] bg-accent/15 text-accent capitalize">
                          {u.plan}
                        </span>
                      </td>
                      <td className="p-3">
                        {u.role === "admin" ? (
                          <span className="flex items-center gap-1 text-yellow-400 text-xs">
                            <ShieldCheck size={11} /> admin
                          </span>
                        ) : (
                          <span className="text-muted text-xs">user</span>
                        )}
                      </td>
                      <td className="p-3">
                        {u.is_banned ? (
                          <span className="flex items-center gap-1 text-red-400 text-xs">
                            <Ban size={11} /> cấm
                          </span>
                        ) : (
                          <span className="text-green-400 text-xs">hoạt động</span>
                        )}
                      </td>
                      <td className="p-3 text-muted text-xs">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString("vi-VN") : ""}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <button onClick={() => setEditing(u)}
                                className="text-xs text-accent hover:underline mr-3">
                          Sửa
                        </button>
                        {u.role !== "admin" && (
                          <button onClick={() => setPurging(u)}
                                  title="Xoá vĩnh viễn"
                                  className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300 hover:underline">
                            <Trash2 size={11} /> Xoá
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.users.length === 0 && (
                    <tr><td colSpan={7} className="p-8 text-center text-muted text-sm">
                      Không có user nào khớp điều kiện.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-3 text-xs text-muted">
              <div>Tổng: {data.total}</div>
              <div className="flex items-center gap-2">
                <button disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                        className="p-1 rounded hover:bg-white/5 disabled:opacity-30">
                  <ChevronLeft size={14} />
                </button>
                <span>Trang {data.page}</span>
                <button disabled={page * data.per_page >= data.total}
                        onClick={() => setPage((p) => p + 1)}
                        className="p-1 rounded hover:bg-white/5 disabled:opacity-30">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}

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
         className="fixed inset-0 bg-black/60 backdrop-blur flex items-center justify-center z-50">
      <div onClick={(e) => e.stopPropagation()}
           className="w-[420px] bg-surface border border-border rounded-xl p-5">
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
