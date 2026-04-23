"use client";
import { useEffect, useState } from "react";
import { Search, Ban, ShieldCheck, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import Shell from "@/components/Shell";
import { fetchUsers, updateUser } from "@/lib/api";

export default function UsersPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [plan, setPlan] = useState("");
  const [banned, setBanned] = useState<"" | "only" | "hide">("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<any | null>(null);

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
                      <td className="p-3 text-right">
                        <button onClick={() => setEditing(u)}
                                className="text-xs text-accent hover:underline">
                          Sửa
                        </button>
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
