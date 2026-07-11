"use client";

import { useState } from "react";
import { Sparkles, Loader2, Check, ArrowRight } from "lucide-react";
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
 * Gemini-powered read of a free-form visual concept (scripts, dialogue, shot
 * lists — any format). Pure creative guidance: it feeds zero model features
 * and never changes the score, which is why it lives in the optional AI
 * assistant section.
 */
export function ConceptAssistant({
  visualConcept,
  setVisualConcept,
  caption,
  brandName,
  format,
}: {
  visualConcept: string;
  setVisualConcept: (v: string) => void;
  caption: string;
  brandName?: string;
  format: string;
}) {
  const [conceptState, setConceptState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [conceptAnalysis, setConceptAnalysis] = useState<ConceptAnalysis | null>(null);
  const [conceptError, setConceptError] = useState("");

  const analyzeConcept = async () => {
    setConceptState("loading");
    setConceptAnalysis(null);
    try {
      const res = await fetch("/api/analyze-concept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concept: visualConcept, caption, brand: brandName, format }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.status === "success" && data.analysis) {
        setConceptAnalysis(data.analysis);
        setConceptState("done");
      } else {
        setConceptError(data?.message || "Concept analysis is unavailable.");
        setConceptState("error");
      }
    } catch {
      setConceptError("Concept analysis is unavailable.");
      setConceptState("error");
    }
  };

  return (
    <div>
      <Label htmlFor="visual-concept">Visual Concept</Label>
      <div className="rounded-xl border border-border bg-surface transition-all focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 overflow-hidden shadow-inner">
        <textarea
          id="visual-concept"
          aria-describedby="visual-concept-help"
          value={visualConcept}
          onChange={(e) => setVisualConcept(e.target.value)}
          rows={3}
          className="w-full resize-none bg-transparent p-4 text-xs font-mono leading-relaxed outline-none placeholder:text-muted-foreground/45 text-foreground/90"
          placeholder={`Paste anything — a full script, dialogue, camera notes, or loose ideas. Messy is fine, e.g.\n• Carousel (5 slides) about "5 Marketing Mistakes"\n• POV skit with 2 people, product in last scene`}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p id="visual-concept-help" className="text-xs text-muted-foreground">
          AI reads scripts, dialogue, and shot lists in any format.
        </p>
        <button
          type="button"
          onClick={analyzeConcept}
          disabled={conceptState === "loading" || visualConcept.trim().length < 10}
          title={visualConcept.trim().length < 10 ? "Write at least a short concept first" : undefined}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-bold text-foreground transition-colors hover:bg-surface-2 disabled:opacity-50 active:scale-[0.98]"
        >
          {conceptState === "loading" ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Reading concept…
            </>
          ) : (
            <>
              <Sparkles className="h-3 w-3 text-primary" />
              Analyze Concept
            </>
          )}
        </button>
      </div>

      {conceptState === "error" && (
        <div role="alert" className="mt-2 rounded-lg border border-warning/30 bg-warning/[0.03] px-3 py-2 text-xs text-muted-foreground">
          {conceptError}
        </div>
      )}

      {conceptState === "done" && conceptAnalysis && (
        <div className="mt-3 rounded-xl border border-border bg-surface-2/50 p-4 space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
            <Sparkles className="h-3 w-3" />
            AI Concept Read
          </div>
          <div className="flex flex-wrap gap-1.5">
            <ConceptChip label={conceptAnalysis.content_type} highlight />
            {conceptAnalysis.tone && <ConceptChip label={conceptAnalysis.tone} />}
            {conceptAnalysis.pov_format && <ConceptChip label="POV format" />}
            {conceptAnalysis.dialogue_heavy && <ConceptChip label="Dialogue-heavy" />}
            {conceptAnalysis.scene_count !== null && (
              <ConceptChip label={`${conceptAnalysis.scene_count} scenes`} />
            )}
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
            <p className="text-xs text-muted-foreground">
              <span className="font-bold text-foreground">Hook:</span> &quot;{conceptAnalysis.hook}&quot;
            </p>
          )}
          {(conceptAnalysis.strengths.length > 0 || conceptAnalysis.suggestions.length > 0) && (
            <ul className="space-y-1">
              {conceptAnalysis.strengths.map((s, i) => (
                <li key={`s${i}`} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Check className="h-3 w-3 shrink-0 text-emerald-500 mt-px" />
                  {s}
                </li>
              ))}
              {conceptAnalysis.suggestions.map((s, i) => (
                <li key={`i${i}`} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <ArrowRight className="h-3 w-3 shrink-0 text-primary mt-px" />
                  {s}
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
