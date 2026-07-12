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
            "group flex h-11 w-full items-center gap-2.5 rounded-[10px] border border-border-strong bg-surface px-3 text-left text-sm outline-none transition-[border-color,box-shadow] hover:border-foreground/30 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20",
            className
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
          <span className="font-semibold text-foreground/80 truncate">
            {format(value, "EEE, MMM d, yyyy")}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="z-50 w-auto overflow-hidden rounded-2xl border border-border bg-surface p-0 shadow-[var(--shadow-elevated)]"
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
        className="h-11 w-full rounded-[10px] border border-border-strong bg-surface px-3 pr-28 font-mono text-sm font-semibold text-foreground outline-none transition-[border-color,box-shadow] hover:border-foreground/30 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
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
