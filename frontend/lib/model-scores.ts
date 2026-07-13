export function formatModelScore(
  value: number | null | undefined,
  unavailable = "Model score unavailable",
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return unavailable;
  const normalized = Math.max(0, Math.min(100, Math.round(value)));
  return `${normalized}/100 relative model score (uncalibrated)`;
}
