"use client";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Mail, Lock } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/components/auth/auth-card";
import { TextField } from "@/components/auth/text-field";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";

export default function SignInPage() {
  const t = useTranslations("auth");
  const { login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/account";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr("");
    try {
      await login(email, password);
      router.push(next);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setErr(t("errInvalid"));
      else setErr(e instanceof Error ? e.message : t("errGeneric"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title={t("signInTitle")}
      subtitle={t("signInSubtitle")}
      footer={
        <>
          {t("noAccount")}{" "}
          <Link href="/sign-up" className="font-medium text-primary hover:underline">
            {t("submitSignUp")}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <TextField
          id="email" label={t("email")} type="email"
          value={email} onChange={setEmail}
          placeholder={t("emailPh")}
          required autoComplete="email" icon={Mail}
        />
        <TextField
          id="password" label={t("password")} type="password"
          value={password} onChange={setPassword}
          placeholder={t("passwordPh")}
          required autoComplete="current-password" icon={Lock}
          rightSlot={
            <Link href="/forgot-password" className="text-xs text-primary hover:underline">
              {t("forgot")}
            </Link>
          }
        />

        {err && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2.5">
            {err}
          </div>
        )}

        <Button type="submit" className="w-full !h-11 text-sm font-semibold" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("submitSignIn")}
        </Button>
      </form>
    </AuthCard>
  );
}
