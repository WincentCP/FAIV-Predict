"use client";

import { Cpu, Database, Tag, AlertTriangle, ChevronDown, FlaskConical } from "lucide-react";

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
  const scopeLabel = isPersonalModel ? "Personal brand model" : "Shared niche model";
  const scientificLabel = evaluationStatus === "validated"
    ? "Validated for thesis use"
    : evaluationStatus === "exploratory"
      ? "Exploratory evidence"
      : "Status unavailable";

  return (
    <section aria-labelledby="prediction-evidence-title" className="rounded-2xl border border-border bg-surface shadow-[var(--shadow-soft)]">
      {(outOfRange.length > 0 || (trainedSamples !== null && trainedSamples < 50) || heldOutClassesComplete === false) && (
        <div className="space-y-2 border-b border-border p-4">
          {trainedSamples !== null && trainedSamples < 50 && (
            <WarningLine>Limited training set: fewer than 50 eligible posts. Treat this score as exploratory.</WarningLine>
          )}
          {heldOutClassesComplete === false && (
            <WarningLine>The chronological holdout is missing at least one performance tier.</WarningLine>
          )}
          {outOfRange.map((feature) => (
            <WarningLine key={feature}>{OOD_LABELS[feature] || feature} is outside the model&apos;s training range.</WarningLine>
          ))}
        </div>
      )}

      <details className="group">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:hidden">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="prediction-evidence-title" className="text-sm font-semibold text-foreground">Model evidence</h3>
              <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {scientificLabel}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {scopeLabel}{trainedSamples !== null ? ` · ${trainedSamples} training posts` : ""}{testSamples !== null ? ` · ${testSamples} holdout posts` : ""}
            </p>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
        </summary>

        <div className="border-t border-border px-5 py-5">
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            These are chronological holdout metrics for the saved model artifact. They describe model evaluation—not the certainty of this individual post and not guaranteed business outcomes.
          </p>

          <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <EvidenceItem icon={<Cpu className="h-4 w-4" />} label="Model scope" value={scopeLabel} />
            <EvidenceItem
              icon={<Database className="h-4 w-4" />}
              label="Training evidence"
              value={trainedSamples !== null ? `${trainedSamples} eligible posts` : "Unavailable"}
            />
            <EvidenceItem
              icon={<FlaskConical className="h-4 w-4" />}
              label="Chronological holdout"
              value={testSamples !== null ? `${testSamples} posts` : "Unavailable"}
            />
            <EvidenceItem
              icon={<Tag className="h-4 w-4" />}
              label="Artifact version"
              value={modelVersion ? `v${modelVersion}` : "Unavailable"}
            />
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

function EvidenceItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/50 p-3">
      <div className="flex items-center gap-2 text-muted-foreground">{icon}<dt className="text-xs font-semibold">{label}</dt></div>
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

