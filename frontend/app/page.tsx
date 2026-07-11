"use client";

import { ArrowRight, Lock, Mail } from "lucide-react";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function Page() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthError(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setAuthError(error.message);
        return;
      }

      window.location.href = "/dashboard";
    } catch (err: any) {
      setAuthError(err.message || "Failed to connect to authentication server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] w-full items-center justify-center bg-background px-4 py-12 text-foreground">
      {/* Auth card */}
      <div className="relative w-full max-w-sm animate-[fade-in_0.4s_ease-out]">
        {/* Logo + brand */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="text-center">
            <div className="font-display text-xl font-semibold tracking-tight">
              FAIV<span className="text-primary"> Predict</span>
            </div>
            <div className="mt-1 text-xs font-semibold text-muted-foreground">
              Performance Analytics
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface/80 p-7 shadow-[var(--shadow-elevated)] backdrop-blur">
          <div className="mb-6">
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              Welcome back
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Sign in to continue to your workspace.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {authError && (
              <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/[0.06] p-3 text-xs font-medium text-destructive text-center">
                {authError}
              </div>
            )}
            <Field
              icon={<Mail className="h-4 w-4" />}
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="you@studio.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Field
              icon={<Lock className="h-4 w-4" />}
              label="Password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <button
              type="submit"
              aria-busy={loading}
              disabled={loading}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground transition-colors duration-200 hover:bg-primary/92 disabled:opacity-70"
            >
              <span className="relative z-10">
                {loading ? "Signing in…" : "Sign in"}
              </span>
              <ArrowRight className="h-4 w-4" />
            </button>

            <p className="pt-1 text-center text-xs text-muted-foreground">
              Accounts are provisioned by the workspace administrator.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({
  icon,
  label,
  hint,
  ...props
}: {
  icon: React.ReactNode;
  label: string;
  hint?: React.ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {hint}
      </div>
      <div className="group relative flex items-center rounded-xl border border-border bg-surface/70 px-3.5 transition-all focus-within:border-ring focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,hsl(var(--ring))_18%,transparent)]">
        <span className="text-muted-foreground">{icon}</span>
        <input
          {...props}
          className="ml-3 h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
        />
      </div>
    </label>
  );
}
