"use client";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, ShieldAlert, Flag, Package,
  Activity, LogOut, Heart,
} from "lucide-react";
import { fetchMe, setToken } from "@/lib/api";

const NAV = [
  { href: "/",         label: "Dashboard",       icon: LayoutDashboard },
  { href: "/users",    label: "Người dùng",      icon: Users },
  { href: "/jobs",     label: "Tác vụ",          icon: Activity },
  { href: "/audit",    label: "Audit log",       icon: ShieldAlert },
  { href: "/flags",    label: "Feature flags",   icon: Flag },
  { href: "/plans",    label: "Gói dịch vụ",     icon: Package },
  { href: "/health",   label: "Sức khoẻ hệ thống", icon: Heart },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMe()
      .then((d) => {
        if (d.user?.role !== "admin") {
          setToken(null);
          router.replace("/login");
          return;
        }
        setUser(d.user);
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  const logout = () => {
    setToken(null);
    router.replace("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        Đang xác thực…
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 flex-shrink-0 border-r border-border bg-surface flex flex-col">
        <div className="px-4 py-4 border-b border-border">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">
            VoxStudio
          </div>
          <div className="text-base font-semibold mt-0.5">Admin</div>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = item.href === "/"
              ? pathname === "/"
              : pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-2.5 h-8 rounded-md text-sm transition-colors ${
                  active
                    ? "bg-accent/15 text-fg"
                    : "text-muted hover:bg-white/5 hover:text-fg"
                }`}
              >
                <Icon size={14} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-xs font-bold">
              {(user.name || user.email)[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{user.name || user.email}</div>
              <div className="text-[10px] text-muted truncate">{user.email}</div>
            </div>
            <button
              onClick={logout}
              title="Đăng xuất"
              className="p-1.5 rounded hover:bg-white/5 text-muted hover:text-fg"
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
