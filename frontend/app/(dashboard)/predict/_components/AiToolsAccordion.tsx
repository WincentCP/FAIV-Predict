"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ConceptAssistant } from "./ConceptAssistant";
import { CaptionRefine } from "./CaptionRefine";

/**
 * Creative direction remains visible because it helps a specialist make a
 * coherent plan. AI writing support is secondary and collapsed by default.
 * Neither semantic brief content nor AI output enters the Random Forest.
 */
export function AiToolsAccordion({
  visualConcept,
  setVisualConcept,
  caption,
  brandId,
  format,
  onReplaceCaption,
}: {
  visualConcept: string;
  setVisualConcept: (v: string) => void;
  caption: string;
  brandId: string | null;
  format: string;
  onReplaceCaption: (text: string) => void;
}) {
  const [writingOpen, setWritingOpen] = useState(false);

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-soft)]" aria-labelledby="creative-direction-title">
      <div className="border-b border-border px-5 py-5 sm:px-6">
        <h2 id="creative-direction-title" className="text-base font-semibold text-foreground">Creative direction <span className="font-normal text-muted-foreground">(optional)</span></h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">Brief the AI review. This does not affect the prediction score.</p>
      </div>

      <div className="px-5 py-5 sm:px-6">
        <ConceptAssistant
          visualConcept={visualConcept}
          setVisualConcept={setVisualConcept}
          caption={caption}
          brandId={brandId}
          format={format}
        />
      </div>

      <div className="border-t border-border">
        <button
          type="button"
          onClick={() => setWritingOpen((open) => !open)}
          aria-expanded={writingOpen}
          aria-controls="ai-writing-assistant"
          className="flex min-h-14 w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-surface-2/50 sm:px-6"
        >
          <span className="text-sm font-semibold text-foreground">AI caption assistant</span>
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
