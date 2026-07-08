"use client";

import * as React from "react";
import { HelpCircle } from "lucide-react";

export function PostingHeatmap() {
  return (
    <div className="relative">
      <div className="mb-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Posting performance
        </div>
        <h3 className="mt-1 font-display text-xl font-semibold tracking-tight">
          When your audience shows up
        </h3>
      </div>

      <div className="h-64 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-2/40 p-6 text-center">
        <HelpCircle className="h-8 w-8 text-muted-foreground/60 mb-2.5" />
        <p className="text-sm font-semibold text-foreground">Meta Graph API Integration Pending</p>
        <p className="text-xs text-muted-foreground mt-1.5 max-w-sm leading-relaxed">
          Syncing audience hourly activity statistics requires establishing an active Meta Business account connection. This feature is currently not connected to prevent fake projections.
        </p>
      </div>
    </div>
  );
}
