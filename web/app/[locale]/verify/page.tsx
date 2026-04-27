"use client";
import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Loader2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/components/auth/auth-card";
import { TextField } from "@/components/auth/text-field";
import { useAuth } from "@/lib/auth-context";
import { resendVerification, verifyOtp } from "@/lib/api";

export default function VerifyPage() {
  const t = useTranslations("auth");
  const { user, loading: authLoading, refresh } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [resentMsg, setResentMsg] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user) router.replace("/sign-in?next=/verify");
    else if (user.email_verified) router.replace("/account");
  }, [user, authLoading, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr("");
    try {
      await verifyOtp(code);
      await refresh();
      router.push("/account");
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("errGeneric"));
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setResentMsg(""); setErr("");
    try {
      await resendVerification();
      setResentMsg(t("resentOk"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("errGeneric"));
    }
  }

  if (authLoading || !user) return null;

  return (
    <AuthCard
      title={t("verifyTitle")}
      subtitle={t("verifySubtitle", { email: user.email })}
    >
      <form onSubmit={submit} className="space-y-5">
        <TextField
          id="code" label={t("verifyCode")} type="text"
          value={code}
          onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
          placeholder={t("verifyCodePh")}
          required autoComplete="one-time-code"
          inputMode="numeric" maxLength={6} icon={KeyRound}
          inputClassName="text-center text-2xl font-mono tracking-[0.4em]"
        />

        {err && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2.5">
            {err}
          </div>
        )}
        {resentMsg && (
          <div className="text-sm text-primary bg-primary/10 border border-primary/30 rounded-md px-3 py-2.5">
            {resentMsg}
          </div>
        )}

        <Button type="submit" className="w-full !h-11 text-sm font-semibold"
                disabled={loading || code.length !== 6}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("verifyCta")}
        </Button>
        <button type="button" onClick={resend}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2">
          {t("resend")}
        </button>
      </form>
    </AuthCard>
  );
}
