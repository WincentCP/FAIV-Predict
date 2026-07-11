"use client";

import { Cpu, Check, Database, Tag, AlertTriangle } from "lucide-react";

const OOD_LABELS: Record<string, string> = {
  post_hour: "Posting time",
  caption_length: "Caption length",
  hashtag_count: "Hashtag count",
  emoji_count: "Emoji count",
};

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
  outOfRange,
}: {
  isPersonalModel: boolean;
  trainedSamples: number | null;
  modelAccuracy: number | null;
  modelVersion: string | null;
  outOfRange: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface/50 p-4 text-xs font-bold backdrop-blur">
      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
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
      {trainedSamples !== null && trainedSamples < 50 && (
        <WarningChip>
          early model — trained on under 50 posts; treat scores as directional
        </WarningChip>
      )}
      {outOfRange.map((feature) => (
        <WarningChip key={feature}>
          {OOD_LABELS[feature] || feature} is outside anything this model trained on
        </WarningChip>
      ))}
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

function WarningChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-700 dark:text-amber-300">
      <AlertTriangle className="h-3 w-3" />
      {children}
    </span>
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

