"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Loader2, LogOut, AlertTriangle, Crown, ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { listMyPayments, type Payment } from "@/lib/api";

const STATUS_COLOR: Record<string, string> = {
  pending:   "bg-yellow-500/15 text-yellow-500",
  paid:      "bg-green-500/15 text-green-500",
  cancelled: "bg-zinc-500/15 text-zinc-400",
};

export default function AccountPage() {
  const t = useTranslations("account");
  const tAuth = useTranslations("auth");
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/sign-in?next=/account"); return; }
    listMyPayments()
      .then((r) => setPayments(r.payments || []))
      .catch(() => setPayments([]))
      .finally(() => setLoading(false));
  }, [user, authLoading, router]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const planName = user.plan.charAt(0).toUpperCase() + user.plan.slice(1);
  const isPaid = user.plan !== "free";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border/40 bg-card/30">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2">
            <Image src="/logo.png" alt="VoxStudio" width={28} height={28}
                   className="h-7 w-7 rounded-md" />
            <span className="text-sm font-semibold">VoxStudio</span>
          </Link>
          <button onClick={() => { logout(); router.replace("/"); }}
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <LogOut className="h-3.5 w-3.5" />
            {tAuth("logoutCta")}
          </button>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-4 sm:px-6 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>

        {/* User card */}
        <div className="mt-6 rounded-2xl border border-border/60 bg-card/40 p-5 flex items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-primary to-pink-500 text-primary-foreground text-base font-bold">
            {(user.name || user.email)[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{user.name || user.email}</div>
            <div className="text-xs text-muted-foreground truncate">{user.email}</div>
          </div>
        </div>

        {/* Verify banner */}
        {!user.email_verified && (
          <div className="mt-4 rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm">{t("verifyBanner")}</p>
              <Link href="/verify"
                    className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                {t("verifyAction")} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        )}

        {/* Plan card */}
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {t("planTitle")}
          </h2>
          <div className="rounded-2xl border border-border/60 bg-card/40 p-5 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-xl font-semibold">
                {isPaid && <Crown className="h-5 w-5 text-yellow-500" />}
                {planName}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {!isPaid
                  ? t("planFree")
                  : (user.plan_expires_at
                      ? t("planActive", { date: new Date(user.plan_expires_at).toLocaleDateString("vi-VN") })
                      : t("planLifetime"))}
              </p>
            </div>
            <Link href="/pricing">
              <Button variant={isPaid ? "outline" : "default"}>
                {t("upgrade")} <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>

        {/* Payments */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {t("paymentsTitle")}
          </h2>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin inline-block mr-2" /> ...
            </div>
          ) : !payments || payments.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">
              {t("noPayments")}
            </div>
          ) : (
            <div className="rounded-2xl border border-border/60 bg-card/40 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground uppercase border-b border-border/40">
                    <th className="text-left p-3 font-medium">{t("paymentsTitle")}</th>
                    <th className="text-left p-3 font-medium">Plan</th>
                    <th className="text-right p-3 font-medium">Amount</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.ref_code} className="border-b border-border/30 last:border-0">
                      <td className="p-3 font-mono text-xs">{p.ref_code}</td>
                      <td className="p-3 capitalize">
                        {p.plan_id}{p.is_ltd && <span className="ml-1 text-xs text-purple-500">LTD</span>}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {p.amount_vnd.toLocaleString("vi-VN")}đ
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[11px] ${STATUS_COLOR[p.status] || ""}`}>
                          {t(p.status === "paid" ? "statusPaid" : p.status === "pending" ? "statusPending" : "statusCancelled")}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {p.status === "pending" && (
                          <Link href={`/checkout/${p.plan_id}?ref=${p.ref_code}`}
                                className="text-xs text-primary hover:underline">
                            {t("viewQr")}
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
