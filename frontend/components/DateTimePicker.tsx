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
}

// ─── Hours and minute slots for the wheel ────────────────────────────────────
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 15, 30, 45];
const ITEM_H = 36; // px — height of each wheel row

// ─── DatePicker ──────────────────────────────────────────────────────────────
export function DatePicker({ value, onChange, className }: PickerProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
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
function WheelColumn({
  items,
  selectedIndex,
  onSelect,
  format: fmt,
}: {
  items: number[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  format: (v: number) => string;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const isMounting = React.useRef(true);

  // Scroll to selected item
  React.useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const target = selectedIndex * ITEM_H;
    el.scrollTo({ top: target, behavior: isMounting.current ? "instant" : "smooth" });
    isMounting.current = false;
  }, [selectedIndex]);

  const handleScroll = React.useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollTop / ITEM_H);
    if (idx !== selectedIndex && idx >= 0 && idx < items.length) {
      onSelect(idx);
    }
  }, [selectedIndex, items.length, onSelect]);

  return (
    <div className="relative flex-1 overflow-hidden">
      {/* Fade masks top & bottom */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[36px] z-10 bg-gradient-to-b from-surface to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[36px] z-10 bg-gradient-to-t from-surface to-transparent" />
      {/* Selection highlight */}
      <div
        className="pointer-events-none absolute inset-x-0 z-10 rounded-md border border-primary/20 bg-primary/5"
        style={{ top: ITEM_H, height: ITEM_H }}
      />
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="h-full overflow-y-scroll scrollbar-none"
        style={{ scrollSnapType: "y mandatory" }}
      >
        {/* Padding rows so first/last items can center */}
        <div style={{ height: ITEM_H }} />
        {items.map((v, i) => (
          <div
            key={v}
            onClick={() => onSelect(i)}
            style={{ height: ITEM_H, scrollSnapAlign: "center" }}
            className={cn(
              "flex cursor-pointer items-center justify-center font-mono text-sm font-semibold transition-colors select-none",
              i === selectedIndex ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {fmt(v)}
          </div>
        ))}
        <div style={{ height: ITEM_H }} />
      </div>
    </div>
  );
}

// ─── TimePicker ──────────────────────────────────────────────────────────────
export function TimePicker({ value, onChange, className }: PickerProps) {
  const [open, setOpen] = React.useState(false);

  const currentHour = value.getHours();
  const currentMin = value.getMinutes();

  // Find nearest minute slot
  const nearestMinIdx = React.useMemo(() => {
    let best = 0;
    let bestDiff = Infinity;
    MINUTES.forEach((m, i) => {
      const diff = Math.abs(m - currentMin);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    });
    return best;
  }, [currentMin]);

  const handleHourSelect = (idx: number) => {
    const next = new Date(value);
    next.setHours(HOURS[idx], value.getMinutes(), 0, 0);
    onChange(next);
  };

  const handleMinSelect = (idx: number) => {
    const next = new Date(value);
    next.setHours(value.getHours(), MINUTES[idx], 0, 0);
    onChange(next);
  };

  const displayTime = `${String(currentHour).padStart(2, "0")}:${String(
    MINUTES[nearestMinIdx]
  ).padStart(2, "0")} WIB`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group flex h-10 w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-3 text-left text-xs outline-none transition-all hover:border-border-strong focus-visible:border-ring",
            className
          )}
        >
          {/* Clock icon */}
          <svg className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
          <span className="font-semibold font-mono text-foreground/80">{displayTime}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[160px] overflow-hidden rounded-xl border border-border-strong bg-surface shadow-md z-50 p-0"
      >
        <div className="px-3 pt-2.5 pb-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60 border-b border-border/40">
          Time (WIB)
        </div>
        {/* Wheel drum */}
        <div className="flex items-stretch gap-0" style={{ height: ITEM_H * 3 }}>
          <WheelColumn
            items={HOURS}
            selectedIndex={currentHour}
            onSelect={handleHourSelect}
            format={(v) => String(v).padStart(2, "0")}
          />
          {/* Divider */}
          <div className="flex items-center justify-center text-muted-foreground font-bold text-sm select-none w-4">
            :
          </div>
          <WheelColumn
            items={MINUTES}
            selectedIndex={nearestMinIdx}
            onSelect={handleMinSelect}
            format={(v) => String(v).padStart(2, "0")}
          />
        </div>
        {/* Done button */}
        <div className="border-t border-border/40 p-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full rounded-lg bg-primary py-1.5 text-[10px] font-bold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Done
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
