"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

type AiState = "idle" | "loading" | "enriched" | "unavailable";

/** Optional Gemini caption rewrite. The user must explicitly apply it. */
export function CaptionRefine({
  caption,
  visualConcept,
  brandId,
  format,
  onReplaceCaption,
}: {
  caption: string;
  visualConcept: string;
  brandId: string | null;
  format: string;
  onReplaceCaption: (text: string) => void;
}) {
  const [aiState, setAiState] = useState<AiState>("idle");
  const [aiMessage, setAiMessage] = useState("");
  const [suggestedCaption, setSuggestedCaption] = useState("");
  const [isStale, setIsStale] = useState(false);
  const [historicalContextUsed, setHistoricalContextUsed] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const completedSignatureRef = useRef<string | null>(null);
  const inputSignature = JSON.stringify([caption, visualConcept, brandId, format]);
  const latestInputSignatureRef = useRef(inputSignature);

  useEffect(() => {
    latestInputSignatureRef.current = inputSignature;
    if (completedSignatureRef.current && completedSignatureRef.current !== inputSignature) {
      setIsStale(true);
    }
    if (requestRef.current) {
      requestRef.current.abort();
      requestRef.current = null;
      setAiState((state) => (state === "loading" ? "idle" : state));
    }
  }, [inputSignature]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const enrichWithAI = async () => {
    if (!brandId) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const requestSignature = inputSignature;
    setAiState("loading");
    setSuggestedCaption("");
    setAiMessage("");
    setIsStale(false);
    try {
      const res = await fetch("/api/refine-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_id: brandId,
          visual_concept: visualConcept,
          caption,
          format,
        }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (requestRef.current !== controller || latestInputSignatureRef.current !== requestSignature) return;
      if (res.ok && data?.status === "success" && data.suggestions) {
        completedSignatureRef.current = requestSignature;
        setAiState("enriched");
        setSuggestedCaption(data.suggestions);
        setHistoricalContextUsed(data.analysis_context?.historical_patterns_used === true);
        return;
      }
      setAiState("unavailable");
      setAiMessage(data?.message || "AI caption refinement is unavailable.");
    } catch (caught: unknown) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (requestRef.current !== controller) return;
      setAiState("unavailable");
      setAiMessage("AI caption refinement is unavailable.");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Rewrite the current caption with the creative brief and brand context.
        </p>
        <button
          type="button"
          onClick={enrichWithAI}
          disabled={aiState === "loading" || caption.trim() === "" || !brandId}
          title={
            !brandId
              ? "Select a brand first"
              : caption.trim() === ""
                ? "Write a caption first. AI refinement rewrites your draft instead of starting from scratch."
                : undefined
          }
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors duration-200 hover:bg-primary/90 disabled:opacity-50"
          aria-busy={aiState === "loading"}
        >
          {aiState === "loading" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Refining…
            </>
          ) : (
            "Refine caption"
          )}
        </button>
      </div>

      <AnimatePresence mode="wait">
        {aiState === "enriched" && (
          <motion.div
            key="enriched"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
            role="status"
            className="relative space-y-4 overflow-hidden rounded-2xl border border-border bg-surface-2/60 p-5 text-left shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-primary">Suggested caption</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-bold text-muted-foreground">
                  {historicalContextUsed ? "Brand-history context used" : "Brief-only context"}
                </span>
                {suggestedCaption && (
                  <button
                    type="button"
                    onClick={() => onReplaceCaption(suggestedCaption)}
                    disabled={isStale}
                    title={isStale ? "Inputs changed; refine again before replacing the draft" : undefined}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-3 text-sm font-semibold text-primary transition-colors duration-200 hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Use this caption
                  </button>
                )}
              </div>
            </div>
            {isStale && (
              <div className="flex items-start gap-1.5 rounded-lg border border-warning/25 bg-warning/[0.04] px-3 py-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                Inputs changed. Refine again before applying this suggestion.
              </div>
            )}
            <div className="min-h-[60px] whitespace-pre-wrap rounded-xl border border-border bg-surface p-4 text-sm font-medium leading-relaxed text-foreground/90 shadow-inner">
              {suggestedCaption}
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Applying this changes the caption. Predict again for an updated result.
            </p>
          </motion.div>
        )}

        {aiState === "unavailable" && (
          <motion.div
            key="unavailable"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/[0.02] p-4 text-left"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-sm leading-relaxed text-muted-foreground">{aiMessage}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
