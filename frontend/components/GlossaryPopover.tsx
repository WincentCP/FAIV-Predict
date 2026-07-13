"use client";

import { BookOpen } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const TERMS = [
  ["Current", "A prediction whose saved inputs still match the draft."],
  ["Provisional", "A prediction made without a confirmed publish time."],
  ["Stale", "A prediction that needs to be run again after relevant inputs changed."],
  ["Superseded", "An earlier immutable version replaced by a newer prediction."],
  ["Validated", "A model that passed the scientific evidence gate."],
  ["Exploratory", "A usable model with evidence limits that restrict its claims."],
  ["Evidence level", "A sample-size guard: limited, early, or consistent; not statistical significance."],
  ["OOD", "An input outside the range observed in the model's training history."],
] as const;

export function GlossaryPopover({ compact = false }: { compact?: boolean }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={compact
            ? "inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-primary outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/40"
            : "grid h-10 w-10 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"}
          aria-label="Open FAIV terminology glossary"
        >
          <BookOpen aria-hidden="true" className="h-[18px] w-[18px]" />
          {compact && <span>Glossary</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl p-4">
        <h2 className="font-semibold text-foreground">FAIV glossary</h2>
        <dl className="mt-3 space-y-3">
          {TERMS.map(([term, definition]) => (
            <div key={term}>
              <dt className="text-sm font-semibold text-foreground">{term}</dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{definition}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
