"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "./Panel";

interface ConceptAnalysis {
  content_type: string;
  tone: string | null;
  pov_format: boolean;
  dialogue_heavy: boolean;
  scene_count: number | null;
  hook: string | null;
  product_visibility: "prominent" | "subtle" | "none";
  cta_present: boolean;
  strengths: string[];
  suggestions: string[];
}

/**
 * Gemini-powered read of a user-supplied planning brief. It can use a safe,
 * descriptive brand-history summary as context, but never feeds unreviewed
 * semantic labels into the Random Forest.
 */
export function ConceptAssistant({
  visualConcept,
  setVisualConcept,
  caption,
  brandId,
  format,
}: {
  visualConcept: string;
  setVisualConcept: (v: string) => void;
  caption: string;
  brandId: string | null;
  format: string;
}) {
  const [conceptState, setConceptState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [conceptAnalysis, setConceptAnalysis] = useState<ConceptAnalysis | null>(null);
  const [conceptError, setConceptError] = useState("");
  const [isStale, setIsStale] = useState(false);
  const [historicalContextUsed, setHistoricalContextUsed] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const completedSignatureRef = useRef<string | null>(null);
  const inputSignature = JSON.stringify([visualConcept, caption, brandId, format]);
  const latestInputSignatureRef = useRef(inputSignature);

  useEffect(() => {
    latestInputSignatureRef.current = inputSignature;
    if (completedSignatureRef.current && completedSignatureRef.current !== inputSignature) {
      setIsStale(true);
    }
    if (requestRef.current) {
      requestRef.current.abort();
      requestRef.current = null;
      setConceptState((state) => (state === "loading" ? "idle" : state));
    }
  }, [inputSignature]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const analyzeConcept = async () => {
    if (!brandId) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const requestSignature = inputSignature;
    setConceptState("loading");
    setConceptError("");
    setIsStale(false);
    try {
      const res = await fetch("/api/analyze-concept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_id: brandId,
          concept: visualConcept,
          caption,
          format,
        }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (requestRef.current !== controller || latestInputSignatureRef.current !== requestSignature) return;
      if (res.ok && data?.status === "success" && data.analysis) {
        setConceptAnalysis(data.analysis);
        setHistoricalContextUsed(data.analysis_context?.historical_patterns_used === true);
        completedSignatureRef.current = requestSignature;
        setConceptState("done");
      } else {
        setConceptError(data?.message || "Concept analysis is unavailable.");
        setConceptState("error");
      }
    } catch (caught: unknown) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (requestRef.current !== controller) return;
      setConceptError("Concept analysis is unavailable.");
      setConceptState("error");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  return (
    <div>
      <Label htmlFor="visual-concept">Describe the direction</Label>
      <div className="overflow-hidden rounded-xl border border-border bg-surface transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15">
        <textarea
          id="visual-concept"
          aria-describedby="visual-concept-help"
          value={visualConcept}
          onChange={(event) => setVisualConcept(event.target.value)}
          rows={5}
          maxLength={4000}
          className="w-full resize-y bg-transparent p-4 text-base leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 sm:text-sm"
          placeholder={`Content pillar, visual style, opening hook, story flow, shots, CTA, campaign or seasonal context…\nExample: Educational Reel · close-up demo · two-second problem hook · before/after story · Ramadan campaign.`}
        />
      </div>
      <div className="mt-2 flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
        <p id="visual-concept-help" className="max-w-xl text-sm leading-relaxed text-muted-foreground">
          This user-supplied context can guide the optional AI review. It does not change the Random Forest score and is not treated as a measured audience preference.
        </p>
        <button
          type="button"
          onClick={analyzeConcept}
          disabled={conceptState === "loading" || visualConcept.trim().length < 10 || !brandId}
          title={
            !brandId
              ? "Select a brand first"
              : visualConcept.trim().length < 10
                ? "Write at least a short concept first"
                : undefined
          }
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-foreground transition-colors hover:bg-surface-2 disabled:opacity-50"
          aria-busy={conceptState === "loading"}
        >
          {conceptState === "loading" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reviewing…
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {conceptState === "done" ? "Review again" : "Review direction"}
            </>
          )}
        </button>
      </div>

      {conceptState === "error" && (
        <div role="alert" className="mt-3 rounded-lg border border-warning/30 bg-warning/[0.03] px-3 py-2 text-sm text-muted-foreground">
          {conceptError}
        </div>
      )}

      {conceptState === "done" && conceptAnalysis && (
        <div className={cn("mt-4 space-y-3 rounded-xl border border-border bg-surface-2/50 p-4", isStale && "opacity-75")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
              <Sparkles className="h-3 w-3" /> AI Creative Review
            </div>
            <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-bold text-muted-foreground">
              {historicalContextUsed ? "Brand-history context used" : "Brief-only context"}
            </span>
          </div>
          {isStale && (
            <div role="status" className="flex items-start gap-1.5 rounded-lg border border-warning/25 bg-warning/[0.04] px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              The brief, caption, brand, or format changed. Analyze again before relying on this review.
            </div>
          )}
          <p className="text-sm leading-relaxed text-muted-foreground">
            Creative guidance is a planning hypothesis, not part of the ML score. It does not use audience demographics or a live external trend feed.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <ConceptChip label={conceptAnalysis.content_type} highlight />
            {conceptAnalysis.tone && <ConceptChip label={conceptAnalysis.tone} />}
            {conceptAnalysis.pov_format && <ConceptChip label="POV format" />}
            {conceptAnalysis.dialogue_heavy && <ConceptChip label="Dialogue-heavy" />}
            {conceptAnalysis.scene_count !== null && <ConceptChip label={`${conceptAnalysis.scene_count} scenes`} />}
            <ConceptChip
              label={`Product: ${conceptAnalysis.product_visibility}`}
              warn={conceptAnalysis.product_visibility === "none"}
            />
            <ConceptChip
              label={conceptAnalysis.cta_present ? "CTA planned" : "No CTA planned"}
              warn={!conceptAnalysis.cta_present}
            />
          </div>
          {conceptAnalysis.hook && (
            <p className="text-sm text-muted-foreground">
              <span className="font-bold text-foreground">Hook:</span> &quot;{conceptAnalysis.hook}&quot;
            </p>
          )}
          {(conceptAnalysis.strengths.length > 0 || conceptAnalysis.suggestions.length > 0) && (
            <ul className="space-y-1">
              {conceptAnalysis.strengths.map((strength, index) => (
                <li key={`s${index}`} className="flex items-start gap-1.5 text-sm leading-relaxed text-muted-foreground">
                  <Check className="mt-px h-3 w-3 shrink-0 text-emerald-500" /> {strength}
                </li>
              ))}
              {conceptAnalysis.suggestions.map((suggestion, index) => (
                <li key={`i${index}`} className="flex items-start gap-1.5 text-sm leading-relaxed text-muted-foreground">
                  <ArrowRight className="mt-px h-3 w-3 shrink-0 text-primary" /> {suggestion}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ConceptChip({ label, highlight, warn }: { label: string; highlight?: boolean; warn?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold uppercase tracking-wide",
        highlight
          ? "bg-primary/10 border-primary/20 text-primary"
          : warn
            ? "bg-warning/10 border-warning/25 text-warning"
            : "bg-surface-2 border-border text-muted-foreground"
      )}
    >
      {label}
    </span>
  );
}
