"use client";

import { ArrowRight, BarChart3, Check, Lock, Mail, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const DECISION_STEPS = [
  "Understand what has worked for each connected brand",
  "Evaluate a draft against verified Instagram history",
  "Improve the decision before the content is published",
];

export default function Page() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setAuthError(null);
    try {
      const { error } = await createClient().auth.signInWithPassword({ email, password });
      if (error) {
        setAuthError(error.message);
        return;
      }
      window.location.href = "/dashboard";
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to reach the authentication service.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-[100dvh] bg-background p-3 text-foreground sm:p-5 lg:p-7">
      <div className="mx-auto grid min-h-[calc(100dvh-1.5rem)] max-w-[1180px] overflow-hidden rounded-[22px] border border-border bg-surface shadow-[var(--shadow-elevated)] sm:min-h-[calc(100dvh-2.5rem)] lg:grid-cols-[1.12fr_0.88fr]">
        <section className="relative hidden overflow-hidden bg-foreground p-10 text-background lg:flex lg:flex-col lg:justify-between xl:p-14">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-background text-sm font-bold text-foreground">F</div>
              <div>
                <div className="text-sm font-bold">FAIV Predict</div>
                <div className="mt-0.5 text-xs text-background/60">Content intelligence</div>
              </div>
            </div>
          </div>

          <div className="max-w-xl py-14">
            <div className="mb-6 inline-flex items-center gap-2 text-xs font-semibold text-background/60">
              <Sparkles aria-hidden="true" className="h-4 w-4" />
              Evidence before publishing
            </div>
            <h1 className="font-display text-[2.65rem] font-semibold leading-[1.08] tracking-[-0.05em] xl:text-[3.2rem]">
              Make a better content decision before it goes live.
            </h1>
            <p className="mt-6 max-w-lg text-[15px] leading-7 text-background/70">
              FAIV supports creative judgment with brand history, transparent predictions, and practical recommendations. It does not replace the specialist behind the work.
            </p>
          </div>

          <ul className="grid gap-3" aria-label="How FAIV supports decisions">
            {DECISION_STEPS.map((step) => (
              <li key={step} className="flex items-start gap-3 border-t border-background/10 pt-3 text-sm text-background/80">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-background/10">
                  <Check aria-hidden="true" className="h-3 w-3" />
                </span>
                {step}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex items-center justify-center px-5 py-12 sm:px-10 lg:px-14">
          <div className="w-full max-w-[390px]">
            <div className="mb-10 flex items-center gap-3 lg:hidden">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-foreground text-sm font-bold text-background">F</div>
              <div>
                <div className="text-sm font-bold">FAIV Predict</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Content intelligence</div>
              </div>
            </div>

            <div className="mb-8">
              <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl border border-border bg-surface-2 text-primary">
                <BarChart3 aria-hidden="true" className="h-5 w-5" />
              </div>
              <h2 className="font-display text-[1.8rem] font-semibold tracking-[-0.04em]">Welcome back</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Sign in to continue to your content decision workspace.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {authError && (
                <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/[0.07] px-4 py-3 text-sm leading-5 text-destructive">
                  {authError}
                </div>
              )}
              <Field
                icon={<Mail aria-hidden="true" className="h-[18px] w-[18px]" />}
                label="Email address"
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
              <Field
                icon={<Lock aria-hidden="true" className="h-[18px] w-[18px]" />}
                label="Password"
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />

              <Button type="submit" size="lg" aria-busy={loading} disabled={loading} className="w-full">
                {loading ? "Signing in…" : "Sign in to workspace"}
                {!loading && <ArrowRight aria-hidden="true" className="h-4 w-4" />}
              </Button>

              <p className="text-center text-xs leading-5 text-muted-foreground">
                Workspace access is provisioned by your administrator.
              </p>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}

function Field({
  icon,
  label,
  id,
  ...props
}: {
  icon: React.ReactNode;
  label: string;
  id: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-foreground">{label}</label>
      <div className="flex min-h-12 items-center rounded-xl border border-border-strong bg-surface px-3.5 transition-[border-color,box-shadow] duration-200 focus-within:border-ring focus-within:shadow-[0_0_0_3px_hsl(var(--ring)/0.14)]">
        <span className="text-muted-foreground">{icon}</span>
        <input
          {...props}
          id={id}
          className="ml-3 min-h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
        />
      </div>
    </div>
  );
}
