"use client";

import { AlertTriangle, ChevronDown } from "lucide-react";

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
  const scopeLabel = isPersonalModel ? "Personalized model" : "Niche model";
  const qualityLabel = evaluationStatus === "validated"
    ? "Ready"
    : evaluationStatus === "exploratory"
      ? "Use with caution"
      : "Not ready";

  return (
    <section aria-labelledby="prediction-evidence-title" className="rounded-2xl border border-border bg-surface shadow-[var(--shadow-soft)]">
      {(outOfRange.length > 0 || (trainedSamples !== null && trainedSamples < 50) || heldOutClassesComplete === false) && (
        <div className="space-y-2 border-b border-border p-4">
          {trainedSamples !== null && trainedSamples < 50 && (
            <WarningLine>Fewer than 50 comparable posts are available. Use this estimate with caution.</WarningLine>
          )}
          {heldOutClassesComplete === false && (
            <WarningLine>The test data does not include every performance level.</WarningLine>
          )}
          {outOfRange.map((feature) => (
          <WarningLine key={feature}>{OOD_LABELS[feature] || feature} is outside the range seen in past posts.</WarningLine>
          ))}
        </div>
      )}

      <details className="group">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:hidden">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="prediction-evidence-title" className="text-sm font-semibold text-foreground">Prediction reliability</h3>
              <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {qualityLabel}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {scopeLabel}{trainedSamples !== null ? ` · ${trainedSamples} past posts` : ""}{testSamples !== null ? ` · tested on ${testSamples} later posts` : ""}
            </p>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
        </summary>

        <div className="border-t border-border px-5 py-5">
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            These technical metrics show how the saved model performed on later posts. They do not measure certainty for this draft or guarantee business results.
          </p>

          <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <EvidenceItem label="Model scope" value={scopeLabel} />
            <EvidenceItem label="Past data" value={trainedSamples !== null ? `${trainedSamples} comparable posts` : "Unavailable"} />
            <EvidenceItem label="Test data" value={testSamples !== null ? `${testSamples} later posts` : "Unavailable"} />
            <EvidenceItem label="Model version" value={modelVersion ? `v${modelVersion}` : "Unavailable"} />
          </dl>

          <div className="mt-4 grid gap-x-8 gap-y-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
            <Metric label="Accuracy" value={modelAccuracy} />
            <Metric label="Macro F1" value={modelMacroF1} />
            <Metric label="Balanced accuracy" value={modelBalancedAccuracy} />
            <Metric
              label="Gain vs majority baseline"
              value={accuracyGainOverBaseline}
              suffix=" pp"
              signed
              title={baselineAccuracy !== null ? `Majority baseline: ${formatMetric(baselineAccuracy)}%` : undefined}
            />
          </div>
        </div>
      </details>
    </section>
  );
}

function EvidenceItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/50 p-3">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-2 text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function Metric({
  label,
  value,
  suffix = "%",
  signed = false,
  title,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  signed?: boolean;
  title?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3" title={title}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums text-foreground">
        {value === null ? "Unavailable" : `${signed && value >= 0 ? "+" : ""}${formatMetric(value)}${suffix}`}
      </span>
    </div>
  );
}

function WarningLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm leading-relaxed text-warning">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/* Kept local so evidence formatting remains consistent across the disclosure. */
function formatMetric(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
