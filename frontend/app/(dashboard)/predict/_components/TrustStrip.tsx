"use client";

import { Cpu, Check, Database, Tag } from "lucide-react";

/**
 * One quiet row stating exactly what this score is based on — model scope,
 * training-set size, validated accuracy, and version. Trust through
 * disclosure, not decoration.
 */
export function TrustStrip({
  isPersonalModel,
  trainedSamples,
  modelAccuracy,
  modelVersion,
}: {
  isPersonalModel: boolean;
  trainedSamples: number | null;
  modelAccuracy: number | null;
  modelVersion: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface/50 p-4 text-[10px] font-bold backdrop-blur">
      <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        Scored by:
      </span>
      <Chip icon={<Cpu className="h-3 w-3" />}>
        {isPersonalModel ? "Personal model (this brand's own history)" : "Niche model (shared industry patterns)"}
      </Chip>
      {trainedSamples !== null && (
        <Chip icon={<Database className="h-3 w-3" />}>
          trained on {trainedSamples} real posts
        </Chip>
      )}
      {modelAccuracy !== null && (
        <Chip
          icon={<Check className="h-3 w-3" />}
          title="How often this model's tier predictions matched reality when validated on the newest 20% of its training data"
        >
          {modelAccuracy}% validated accuracy
        </Chip>
      )}
      {modelVersion && (
        <Chip icon={<Tag className="h-3 w-3" />} title="Models retrain automatically every week on freshly synced posts">
          v{modelVersion}
        </Chip>
      )}
    </div>
  );
}

function Chip({
  icon,
  children,
  title,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-muted-foreground"
    >
      {icon}
      {children}
    </span>
  );
}
