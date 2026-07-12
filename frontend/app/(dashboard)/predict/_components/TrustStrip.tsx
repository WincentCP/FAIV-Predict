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
 * training and holdout size, class-aware evaluation metrics, baseline gain,
 * and version. Trust through disclosure, not decoration.
 */
export function TrustStrip({
  isPersonalModel,
  trainedSamples,
  modelAccuracy,
  modelMacroF1,
  modelBalancedAccuracy,
  baselineAccuracy,
  accuracyGainOverBaseline,
  testSamples,
  heldOutClassesComplete,
  evaluationStatus,
  modelVersion,
  outOfRange,
}: {
  isPersonalModel: boolean;
  trainedSamples: number | null;
  modelAccuracy: number | null;
  modelMacroF1: number | null;
  modelBalancedAccuracy: number | null;
  baselineAccuracy: number | null;
  accuracyGainOverBaseline: number | null;
  testSamples: number | null;
  heldOutClassesComplete: boolean | null;
  evaluationStatus: "validated" | "exploratory" | null;
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
          limited training set — under 50 posts; treat scores as exploratory
        </WarningChip>
      )}
      {outOfRange.map((feature) => (
        <WarningChip key={feature}>
          {OOD_LABELS[feature] || feature} is outside anything this model trained on
        </WarningChip>
      ))}
      {(modelAccuracy !== null || testSamples !== null) && (
        <Chip
          icon={<Check className="h-3 w-3" />}
          title="Held-out evaluation uses the newest chronological 20% of eligible posts"
        >
          holdout: {modelAccuracy !== null ? `${formatMetric(modelAccuracy)}% accuracy` : "accuracy unavailable"}
          {testSamples !== null ? ` · n=${testSamples}` : ""}
        </Chip>
      )}
      {modelMacroF1 !== null && (
        <Chip
          icon={<Check className="h-3 w-3" />}
          title="Macro-F1 gives Low, Average, and High tiers equal weight, regardless of how frequent each tier is"
        >
          macro-F1 {formatMetric(modelMacroF1)}%
        </Chip>
      )}
      {modelBalancedAccuracy !== null && (
        <Chip
          icon={<Check className="h-3 w-3" />}
          title="Balanced accuracy is the average recall across the three engagement tiers"
        >
          balanced accuracy {formatMetric(modelBalancedAccuracy)}%
        </Chip>
      )}
      {accuracyGainOverBaseline !== null && (
        <Chip
          icon={<Check className="h-3 w-3" />}
          title={
            baselineAccuracy !== null
              ? `Compared with a majority-class baseline accuracy of ${formatMetric(baselineAccuracy)}%`
              : "Compared with the majority-class baseline"
          }
        >
          {accuracyGainOverBaseline >= 0 ? "+" : ""}{formatMetric(accuracyGainOverBaseline)} pp vs majority baseline
        </Chip>
      )}
      {heldOutClassesComplete === true && (
        <Chip icon={<Check className="h-3 w-3" />} title="Low, Average, and High all occur in the chronological holdout">
          all 3 tiers represented in holdout
        </Chip>
      )}
      {heldOutClassesComplete === false && (
        <WarningChip>
          holdout is missing at least one tier; evaluation is exploratory
        </WarningChip>
      )}
      {evaluationStatus === "validated" && (
        <Chip icon={<Check className="h-3 w-3" />} title="This model passed the configured thesis scientific gate">
          scientific gate passed
        </Chip>
      )}
      {evaluationStatus === "exploratory" && heldOutClassesComplete !== false && (
        <WarningChip>
          evaluation is exploratory; do not treat this score as established accuracy
        </WarningChip>
      )}
      {modelVersion && (
        <Chip icon={<Tag className="h-3 w-3" />} title="Models retrain automatically every week on freshly synced posts">
          v{modelVersion}
        </Chip>
      )}
    </div>
  );
}

function formatMetric(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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

