"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Check, Mail, KeyRound, Lock } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/components/auth/auth-card";
import { TextField } from "@/components/auth/text-field";
import { forgotPassword, resetPassword } from "@/lib/api";

type Step = "email" | "reset" | "done";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr("");
    try {
      await forgotPassword(email);
      setStep("reset");
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("errGeneric"));
    } finally {
      setLoading(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr("");
    try {
      await resetPassword({ email, code, new_password: newPassword });
      setStep("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("errGeneric"));
    } finally {
      setLoading(false);
    }
  }

  if (step === "done") {
    return (
      <AuthCard title={t("resetTitle")}>
        <div className="text-center py-2">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary mb-4">
            <Check className="h-7 w-7" />
          </div>
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            {t("resetCta")} ✓
          </p>
          <Link href="/sign-in">
            <Button className="w-full !h-11 text-sm font-semibold">{t("submitSignIn")}</Button>
          </Link>
        </div>
      </AuthCard>
    );
  }

  if (step === "reset") {
    return (
      <AuthCard title={t("resetTitle")} subtitle={t("resetSubtitle")}>
        <form onSubmit={submitReset} className="space-y-5">
          <TextField
            id="code" label={t("verifyCode")} type="text"
            value={code}
            onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric" maxLength={6} required icon={KeyRound}
            inputClassName="text-center text-xl font-mono tracking-[0.3em]"
          />
          <TextField
            id="newpw" label={t("newPassword")} type="password"
            value={newPassword} onChange={setNewPassword}
            placeholder={t("passwordPh")}
            required minLength={8} icon={Lock}
          />

          {err && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2.5">
              {err}
            </div>
          )}
          <Button type="submit" className="w-full !h-11 text-sm font-semibold" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("resetCta")}
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("forgotTitle")}
      subtitle={t("forgotSubtitle")}
      footer={
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          {t("submitSignIn")}
        </Link>
      }
    >
      <form onSubmit={submitEmail} className="space-y-5">
        <TextField
          id="email" label={t("email")} type="email"
          value={email} onChange={setEmail}
          placeholder={t("emailPh")}
          required autoComplete="email" icon={Mail}
        />

        {err && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2.5">
            {err}
          </div>
        )}
        <Button type="submit" className="w-full !h-11 text-sm font-semibold" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("forgotCta")}
        </Button>
      </form>
    </AuthCard>
  );
}
