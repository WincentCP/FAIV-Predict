import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton replacement for the spinner shown while a prediction runs. */
export function ResultSkeleton() {
  return (
    <div className="rounded-3xl bg-gradient-to-br from-surface via-surface-2 to-surface p-8 md:p-12 shadow-[var(--shadow-elevated)]">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
        <div className="flex justify-center">
          <Skeleton className="h-[220px] w-[220px] rounded-full" />
        </div>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-3 w-44" />
          </div>
          <Skeleton className="h-10 w-[90%]" />
          <Skeleton className="h-10 w-[70%]" />
          <Skeleton className="h-4 w-[80%]" />
          <Skeleton className="h-4 w-[60%]" />
          <div className="flex gap-3 pt-3">
            <Skeleton className="h-11 w-44 rounded-xl" />
            <Skeleton className="h-11 w-40 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
