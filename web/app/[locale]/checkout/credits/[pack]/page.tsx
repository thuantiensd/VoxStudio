"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useParams, useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  Loader2, Copy, Check, AlertTriangle, ArrowLeft, CheckCircle2, Zap,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import {
  topupCredits, getMyPayment, listMyPayments,
  type Bank, type Payment,
} from "@/lib/api";

/**
 * CheckoutCreditsPage — flow mua credit pack qua bank transfer.
 * Tương tự /checkout/[plan] nhưng gọi topupCredits + show số credits sẽ nhận.
 */
export default function CheckoutCreditsPage() {
  const t = useTranslations("checkout");
  const tAccount = useTranslations("account");
  const params = useParams<{ pack: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { user, loading: authLoading, refresh } = useAuth();

  const packId = params.pack;
  const refCodeOverride = search.get("ref");

  const [data, setData] = useState<{ payment: Payment; bank: Bank; qr_url: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const initialized = useRef(false);

  // Auth gate
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/sign-in?next=/checkout/credits/${packId}`); return; }
    if (!user.email_verified) { router.replace("/verify"); return; }
  }, [user, authLoading, router, packId]);

  // Init: ?ref → fetch existing; not → topup mới
  useEffect(() => {
    if (authLoading || !user || !user.email_verified) return;
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      try {
        if (refCodeOverride) {
          const r = await getMyPayment(refCodeOverride);
          if (r.payment.status === "paid") {
            setData(r);
            setConfirmed(true);
          } else if (r.payment.status === "cancelled") {
            router.replace("/account");
            return;
          } else {
            setData(r);
          }
        } else {
          const r = await topupCredits(packId);
          setData(r);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : t("errCheckout"));
      } finally {
        setLoading(false);
      }
    })();
  }, [authLoading, user, packId, refCodeOverride, t, router]);

  // Poll status mỗi 30s
  useEffect(() => {
    if (!data?.payment?.ref_code || confirmed) return;
    const ref = data.payment.ref_code;
    const tick = async () => {
      try {
        const list = await listMyPayments();
        const p = list.payments.find((x) => x.ref_code === ref);
        if (p?.status === "paid") {
          setConfirmed(true);
          await refresh();
        } else if (p?.status === "cancelled") {
          router.replace("/account");
        }
      } catch {}
    };
    const iv = setInterval(tick, 30_000);
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, [data?.payment?.ref_code, confirmed, refresh, router]);

  function copy(text: string, key: string) {
    try {
      navigator.clipboard?.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {}
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b border-border/40">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2">
            <Image src="/logo.png" alt="VoxStudio" width={28} height={28}
                   className="h-7 w-7 rounded-md" />
            <span className="text-sm font-semibold">VoxStudio</span>
          </Link>
          <Link href="/account"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" />
            {tAccount("title")}
          </Link>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-2xl px-4 sm:px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight mb-6 inline-flex items-center gap-2">
          <Zap className="h-6 w-6 text-primary" />
          Nạp credits — Gói {packId.charAt(0).toUpperCase() + packId.slice(1)}
        </h1>

        {/* Confirmed */}
        {confirmed && data && (
          <div className="rounded-2xl border border-green-500/30 bg-green-500/10 p-6 text-center">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-green-500/20 text-green-500 mb-3">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <p className="text-base font-semibold text-green-500 mb-2">
              Đã cộng {data.payment.credits_amount?.toLocaleString("vi-VN") || 0} credits vào tài khoản!
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              Bạn có thể bắt đầu sử dụng ngay.
            </p>
            <Link href="/account">
              <Button>Về tài khoản</Button>
            </Link>
          </div>
        )}

        {/* Loading */}
        {!confirmed && loading && (
          <div className="rounded-2xl border border-border/60 bg-card/40 p-8 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary inline-block mb-2" />
            <p className="text-sm text-muted-foreground">{t("creating")}</p>
          </div>
        )}

        {/* Error */}
        {!confirmed && !loading && err && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm">{err}</p>
              <Link href="/pricing"
                    className="mt-3 inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                <ArrowLeft className="h-3 w-3" /> Xem bảng giá
              </Link>
            </div>
          </div>
        )}

        {/* Payment */}
        {!confirmed && !loading && !err && data && (
          <>
            {/* Credits info */}
            {data.payment.credits_amount && data.payment.credits_amount > 0 && (
              <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4 text-center">
                <div className="text-xs uppercase tracking-wider text-primary mb-1">
                  Bạn sẽ nhận
                </div>
                <div className="text-2xl font-bold inline-flex items-center gap-2">
                  <Zap className="h-5 w-5 text-primary" />
                  {data.payment.credits_amount.toLocaleString("vi-VN")} credits
                </div>
              </div>
            )}

            {data.qr_url && (
              <div className="flex justify-center mb-6">
                <div className="p-3 rounded-xl bg-white shadow-2xl">
                  <Image src={data.qr_url} alt="VietQR" width={240} height={240}
                         unoptimized className="rounded-md" />
                </div>
              </div>
            )}
            <p className="text-center text-xs text-muted-foreground mb-6">
              {t("scanHint")}
            </p>

            <div className="rounded-2xl border border-border/60 bg-card/40 divide-y divide-border/40">
              <Row label={t("bankName")} value={data.bank.name} />
              <Row label={t("accountName")} value={data.bank.account_name} />
              <Row label={t("accountNo")} value={data.bank.account_no}
                   copyable copied={copied === "acc"} onCopy={() => copy(data.bank.account_no, "acc")} mono />
              <Row label={t("amount")}
                   value={<span className="font-bold text-green-500">{data.payment.amount_vnd.toLocaleString("vi-VN")}đ</span>}
                   copyable copied={copied === "amt"}
                   onCopy={() => copy(String(data.payment.amount_vnd), "amt")} />
              <Row label={t("refCode")}
                   value={<span className="font-bold text-primary">{data.payment.ref_code}</span>}
                   copyable copied={copied === "ref"}
                   onCopy={() => copy(data.payment.ref_code, "ref")} mono />
            </div>

            <div className="mt-5 rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs leading-relaxed">
              <span className="font-semibold text-yellow-500">⚠</span>{" "}
              {t("important", { ref: data.payment.ref_code })}
            </div>

            <Link href="/account" className="block mt-6">
              <Button className="w-full">{t("didTransfer")}</Button>
            </Link>
            <p className="mt-4 text-center text-xs text-muted-foreground leading-relaxed">
              <Loader2 className="h-3 w-3 animate-spin inline-block mr-1" />
              {t("polling")} · {t("afterHint")}
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function Row({
  label, value, copyable, copied, onCopy, mono,
}: {
  label: string;
  value: React.ReactNode;
  copyable?: boolean;
  copied?: boolean;
  onCopy?: () => void;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 text-sm">
      <span className="w-32 flex-shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={`flex-1 ${mono ? "font-mono" : ""} break-all`}>{value || "—"}</span>
      {copyable && (
        <button onClick={onCopy}
                className="p-1.5 rounded-md border border-border/60 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Copy">
          {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
        </button>
      )}
    </div>
  );
}
