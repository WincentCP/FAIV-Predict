// Locked product vocabulary for non-technical users. Every surface must use
// these labels instead of the internal state names so the same state never
// appears under two different words.

export type PredictionLifecycleStatus = "current" | "provisional" | "stale" | "superseded";

export const PREDICTION_STATUS_LABELS: Record<PredictionLifecycleStatus, string> = {
  current: "Current",
  provisional: "No time set yet",
  stale: "Outdated — re-analyze",
  superseded: "Replaced by a newer version",
};

export function predictionStatusLabel(status: string | null | undefined): string {
  if (!status) return "Current";
  return PREDICTION_STATUS_LABELS[status as PredictionLifecycleStatus] ?? status;
}

/** Chip tone for a lifecycle status, mapped onto existing design tokens. */
export function predictionStatusTone(status: string | null | undefined): "neutral" | "warning" | "muted" {
  if (status === "provisional" || status === "stale") return "warning";
  if (status === "superseded") return "muted";
  return "neutral";
}

export function evaluationStatusLabel(status: "validated" | "exploratory" | null | undefined): string {
  if (status === "validated") return "Reliable";
  if (status === "exploratory") return "Still learning";
  return "Not evaluated yet";
}

export function evaluationStatusDetail(status: "validated" | "exploratory" | null | undefined): string {
  if (status === "validated") {
    return "This model passed every internal evaluation gate for this brand's history.";
  }
  if (status === "exploratory") {
    return "This model is usable but its evaluation evidence is still limited. Treat estimates as directional.";
  }
  return "No evaluation evidence is recorded for this model yet.";
}

export const SCORE_DISCLAIMER = "Relative model score — not a probability or a guarantee.";

export const OOD_LABEL = "New territory for your data";
