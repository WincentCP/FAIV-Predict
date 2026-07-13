"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { type ContentFormat } from "@/lib/types";
import { ConceptAssistant, type CreativeReviewSnapshot } from "./ConceptAssistant";
import { CaptionRefine } from "./CaptionRefine";

/**
 * The Creative Brief and AI writing support are secondary disclosures. Blank
 * new drafts start collapsed; an existing saved brief opens when it is loaded.
 * Neither semantic brief content nor AI output enters the Random Forest.
 */
export function AiToolsAccordion({
  visualConcept,
  setVisualConcept,
  caption,
  brandId,
  format,
  onChangeFormat,
  onReplaceCaption,
  reviewSnapshot,
  onReviewComplete,
}: {
  visualConcept: string;
  setVisualConcept: (v: string) => void;
  caption: string;
  brandId: string | null;
  format: ContentFormat;
  onChangeFormat: (format: ContentFormat) => void;
  onReplaceCaption: (text: string) => void;
  reviewSnapshot: CreativeReviewSnapshot | null;
  onReviewComplete: (review: CreativeReviewSnapshot) => void;
}) {
  const [writingOpen, setWritingOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(() => Boolean(visualConcept.trim()));
  const briefManuallyToggled = useRef(false);

  useEffect(() => {
    if (visualConcept.trim() && !briefManuallyToggled.current) setBriefOpen(true);
  }, [visualConcept]);

  const toggleBrief = () => {
    briefManuallyToggled.current = true;
    setBriefOpen((open) => !open);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-soft)]" aria-labelledby="creative-brief-title">
      <button
        type="button"
        onClick={toggleBrief}
        aria-expanded={briefOpen}
        aria-controls="creative-brief-fields"
        className="flex min-h-16 w-full items-center justify-between gap-4 px-5 py-4 text-left outline-none hover:bg-surface-2/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 sm:px-6"
      >
        <span>
          <span id="creative-brief-title" className="block text-base font-semibold text-foreground">Creative Brief <span className="font-normal text-muted-foreground">(recommended)</span></span>
          <span className="mt-1 block max-w-2xl text-sm leading-relaxed text-muted-foreground">Shape the idea before production. It guides creative feedback, not the ML tier.</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="hidden text-xs font-semibold text-muted-foreground sm:inline">{visualConcept.trim() ? "Brief added" : "Add brief"}</span>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", briefOpen && "rotate-180")} aria-hidden="true" />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {briefOpen && (
          <motion.div
            id="creative-brief-fields"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            className="overflow-hidden border-t border-border"
          >
            <div className="px-5 py-5 sm:px-6">
              <ConceptAssistant
                visualConcept={visualConcept}
                setVisualConcept={setVisualConcept}
                caption={caption}
                brandId={brandId}
                format={format}
                onChangeFormat={onChangeFormat}
                reviewSnapshot={reviewSnapshot}
                onReviewComplete={onReviewComplete}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="border-t border-border">
        <button
          type="button"
          onClick={() => setWritingOpen((open) => !open)}
          aria-expanded={writingOpen}
          aria-controls="ai-writing-assistant"
          className="flex min-h-14 w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-surface-2/50 sm:px-6"
        >
          <span className="text-sm font-semibold text-foreground">Caption help</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", writingOpen && "rotate-180")} />
        </button>
        <AnimatePresence initial={false}>
          {writingOpen && (
            <motion.div
              id="ai-writing-assistant"
              key="ai-writing-assistant"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
              className="overflow-hidden"
            >
              <div className="border-t border-border px-5 py-5 sm:px-6">
                <CaptionRefine
                  caption={caption}
                  visualConcept={visualConcept}
                  brandId={brandId}
                  format={format}
                  onReplaceCaption={onReplaceCaption}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
