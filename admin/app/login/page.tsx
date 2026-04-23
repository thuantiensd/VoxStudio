"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, Loader2 } from "lucide-react";
import { login } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(email.trim(), password);
      router.replace("/");
    } catch (e: any) {
      setError(e?.detail || e?.message || "Đăng nhập thất bại.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-surface border border-border rounded-xl p-6"
      >
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">
          VoxStudio
        </div>
        <h1 className="text-xl font-semibold mt-1 mb-5">Admin Console</h1>

        {error && (
          <div className="mb-4 p-2.5 rounded-md bg-red-500/10 border border-red-500/30 text-xs text-red-400">
            {error}
          </div>
        )}

        <label className="block mb-3">
          <span className="text-xs text-muted mb-1 block">Email</span>
          <input
            type="email" required autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-9 px-3 text-sm bg-bg border border-border rounded-md outline-none focus:border-accent"
          />
        </label>

        <label className="block mb-5">
          <span className="text-xs text-muted mb-1 block">Mật khẩu</span>
          <input
            type="password" required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-9 px-3 text-sm bg-bg border border-border rounded-md outline-none focus:border-accent"
          />
        </label>

        <button
          type="submit" disabled={loading}
          className="w-full h-10 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
          Đăng nhập
        </button>

        <p className="mt-4 text-[11px] text-muted text-center">
          Chỉ tài khoản có role=admin mới vào được. Liên hệ SuperAdmin nếu cần truy cập.
        </p>
      </form>
    </div>
  );
}
