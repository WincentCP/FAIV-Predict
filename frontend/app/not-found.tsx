import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background px-5 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center shadow-[var(--shadow-soft)] sm:p-10">
        <p className="text-sm font-semibold text-primary">404</p>
        <h1 className="mt-3 font-display text-2xl font-semibold tracking-[-0.035em] text-foreground">Page not found</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">The page may have moved, or the link is no longer available.</p>
        <Link href="/dashboard" className={`${buttonVariants({ size: "lg" })} mt-7`}>
          Return to overview
        </Link>
      </div>
    </main>
  );
}
