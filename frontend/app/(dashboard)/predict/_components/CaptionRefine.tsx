"use client";

import { useState } from "react";
import { PenTool, Loader2, FileText, AlertTriangle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

type AiState = "idle" | "loading" | "enriched" | "unavailable";

/**
 * Optional Gemini caption rewrite. Reports itself unavailable honestly when
 * the server has no LLM configured. Never changes the score by itself — the
 * user chooses whether to replace their draft.
 */
export function CaptionRefine({
  caption,
  visualConcept,
  brandName,
  format,
  onReplaceCaption,
}: {
  caption: string;
  visualConcept: string;
  brandName?: string;
  format: string;
  onReplaceCaption: (text: string) => void;
}) {
  const [aiState, setAiState] = useState<AiState>("idle");
  const [aiMessage, setAiMessage] = useState("");
  const [suggestedCaption, setSuggestedCaption] = useState("");

  const enrichWithAI = async () => {
    setAiState("loading");
    setSuggestedCaption("");
    try {
      const res = await fetch("/api/refine-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visual_concept: visualConcept,
          caption,
          brand: brandName,
          format,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.status === "success" && data.suggestions) {
        setAiState("enriched");
        setSuggestedCaption(data.suggestions);
        return;
      }
      setAiState("unavailable");
      setAiMessage(data?.message || "AI caption refinement is unavailable.");
    } catch {
      setAiState("unavailable");
      setAiMessage("AI caption refinement is unavailable.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={enrichWithAI}
          disabled={aiState === "loading" || caption.trim() === ""}
          title={
            caption.trim() === ""
              ? "Write a caption first. AI refinement rewrites your draft instead of starting from scratch."
              : undefined
          }
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground transition-colors duration-200 hover:bg-primary/95 disabled:opacity-50 active:scale-[0.98] shadow-sm shrink-0"
          aria-busy={aiState === "loading"}
        >
          {aiState === "loading" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Refining…
            </>
          ) : (
            <>
              <PenTool className="h-3.5 w-3.5" />
              AI Refine Caption
            </>
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
            className="rounded-2xl border border-border bg-surface-2/60 p-5 space-y-4 shadow-sm relative overflow-hidden text-left"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-bold text-primary uppercase tracking-wider">
                  AI Suggested Caption
                </span>
              </div>
              {suggestedCaption && (
                <button
                  type="button"
                  onClick={() => onReplaceCaption(suggestedCaption)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 border border-primary/20 px-2.5 py-1.5 text-xs font-bold text-primary transition-colors duration-200 hover:bg-primary hover:text-primary-foreground"
                >
                  Replace Draft Caption
                </button>
              )}
            </div>
            <div className="p-4 rounded-xl border border-border bg-surface text-sm font-medium leading-relaxed text-foreground/90 min-h-[60px] shadow-inner whitespace-pre-wrap">
              {suggestedCaption}
            </div>
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
            className="rounded-xl border border-warning/30 bg-warning/[0.02] p-4 flex items-start gap-3 text-left"
          >
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">{aiMessage}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
