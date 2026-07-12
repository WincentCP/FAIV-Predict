import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background px-5 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center shadow-[var(--shadow-soft)] sm:p-10">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-foreground text-sm font-bold text-background">F</div>
        <p className="mt-8 text-xs font-semibold text-primary">404 · Page not found</p>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-[-0.035em] text-foreground">This decision path ends here.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">The page may have moved, or the link is no longer available.</p>
        <Link href="/dashboard" className={`${buttonVariants({ size: "lg" })} mt-7`}>
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Return to overview
        </Link>
      </div>
    </main>
  );
}
