"use client";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Mail, Lock, User } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/components/auth/auth-card";
import { TextField } from "@/components/auth/text-field";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";

export default function SignUpPage() {
  const t = useTranslations("auth");
  const { register } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr("");
    try {
      await register(email, password, name || undefined);
      router.push("/verify");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setErr(t("errExists"));
      else setErr(e instanceof Error ? e.message : t("errGeneric"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title={t("signUpTitle")}
      subtitle={t("signUpSubtitle")}
      footer={
        <>
          {t("haveAccount")}{" "}
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            {t("submitSignIn")}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <TextField
          id="name" label={t("name")} type="text"
          value={name} onChange={setName}
          placeholder={t("namePh")}
          autoComplete="name" icon={User}
        />
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
          required minLength={8} autoComplete="new-password" icon={Lock}
        />

        {err && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2.5">
            {err}
          </div>
        )}

        <Button type="submit" className="w-full !h-11 text-sm font-semibold" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("submitSignUp")}
        </Button>
      </form>
    </AuthCard>
  );
}
