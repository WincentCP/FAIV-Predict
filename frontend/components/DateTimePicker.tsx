"use client";

import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface PickerProps {
  value: Date;
  onChange: (date: Date) => void;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

// ─── DatePicker ──────────────────────────────────────────────────────────────
export function DatePicker({ value, onChange, className, id, "aria-label": ariaLabel }: PickerProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          aria-label={ariaLabel}
          type="button"
          className={cn(
            "group flex h-10 w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-3 text-left text-xs outline-none transition-all hover:border-border-strong focus-visible:border-ring",
            className
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
          <span className="font-semibold text-foreground/80 truncate">
            {format(value, "EEE, MMM d, yyyy")}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-auto overflow-hidden rounded-2xl border border-border-strong p-0 shadow-md bg-surface z-50"
      >
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => {
            if (!d) return;
            const next = new Date(value);
            next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
            onChange(next);
            setOpen(false);
          }}
          className="p-4.5 pointer-events-auto"
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

// ─── WheelColumn ─────────────────────────────────────────────────────────────
export function TimePicker({ value, onChange, className, id, "aria-label": ariaLabel }: PickerProps) {
  const hourValue = String(value.getHours());

  return (
    <div className={cn("relative", className)}>
      <select
        id={id}
        aria-label={ariaLabel}
        value={hourValue}
        onChange={(event) => {
          const hour = Number(event.target.value);
          if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;
          const next = new Date(value);
          // Inference accepts an hourly bucket, so minutes must not imply
          // precision the model does not use.
          next.setHours(hour, 0, 0, 0);
          onChange(next);
        }}
        className="h-10 w-full rounded-lg border border-border bg-surface px-3 pr-28 font-mono text-xs font-semibold text-foreground outline-none transition-colors hover:border-border-strong focus-visible:border-ring"
      >
        {Array.from({ length: 24 }, (_, hour) => (
          <option key={hour} value={hour}>
            {String(hour).padStart(2, "0")}:00
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
        WIB · hourly
      </span>
    </div>
  );
}
