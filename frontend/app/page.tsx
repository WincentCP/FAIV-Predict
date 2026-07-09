"use client";

import { ArrowRight, Lock, Mail } from "lucide-react";
import { useState } from "react";
import { Logo } from "@/components/AppShell";
import { createClient } from "@/lib/supabase/client";

// Pre-filled development/test credentials. They authenticate against the real
// Supabase Auth project — there is no client-side bypass.
const DEV_EMAIL = "wincentcoleusphan@gmail.com";
const DEV_PASSWORD = "skripsisuccess";

export default function Page() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState(DEV_EMAIL);
  const [password, setPassword] = useState(DEV_PASSWORD);
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
    <div className="light relative flex min-h-screen w-full items-center justify-center bg-background px-4 py-12 text-foreground">
      {/* Subtle background glow */}
      <div
        aria-hidden
        className="pointer-events-none fixed -top-40 left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, hsl(var(--primary-glow)) 20%, transparent), transparent 70%)",
          filter: "blur(100px)",
        }}
      />

      {/* Auth card */}
      <div className="relative w-full max-w-sm animate-[fade-in_0.4s_ease-out]">
        {/* Logo + brand */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <Logo size={44} />
          <div className="text-center">
            <div className="font-display text-xl font-semibold tracking-tight">
              FAIV<span className="text-primary"> Predict</span>
            </div>
            <div className="mt-0.5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
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
              <div className="rounded-xl border border-destructive/25 bg-destructive/[0.06] p-3 text-xs font-medium text-destructive text-center">
                {authError}
              </div>
            )}
            <Field
              icon={<Mail className="h-4 w-4" />}
              label="Email"
              type="email"
              placeholder="you@studio.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Field
              icon={<Lock className="h-4 w-4" />}
              label="Password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <button
              type="submit"
              disabled={loading}
              className="group relative mt-1 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground transition-all duration-300 hover:shadow-[var(--shadow-glow-purple)] disabled:opacity-70"
            >
              <span className="relative z-10">
                {loading ? "Signing in…" : "Sign in"}
              </span>
              <ArrowRight className="relative z-10 h-4 w-4 transition-transform group-hover:translate-x-1" />
              <span
                aria-hidden
                className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full"
              />
            </button>

            <p className="pt-1 text-center text-[11px] text-muted-foreground">
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
