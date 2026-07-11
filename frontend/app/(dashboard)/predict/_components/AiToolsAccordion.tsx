"use client";

import { useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ConceptAssistant } from "./ConceptAssistant";
import { CaptionRefine } from "./CaptionRefine";

/**
 * Optional AI tools, collapsed by default so the compose flow stays focused
 * on the inputs that actually feed the model.
 */
export function AiToolsAccordion({
  visualConcept,
  setVisualConcept,
  caption,
  brandName,
  format,
  onReplaceCaption,
}: {
  visualConcept: string;
  setVisualConcept: (v: string) => void;
  caption: string;
  brandName?: string;
  format: string;
  onReplaceCaption: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-2/40"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-bold text-foreground">AI Assistant</div>
            <div className="text-xs text-muted-foreground truncate">
              Visual concepts are not scored directly. Applied caption rewrites require a new prediction.
            </div>
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="ai-tools"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-5 border-t border-border/60 px-5 py-5">
              <ConceptAssistant
                visualConcept={visualConcept}
                setVisualConcept={setVisualConcept}
                caption={caption}
                brandName={brandName}
                format={format}
              />
              <div className="border-t border-border/40 pt-4">
                <CaptionRefine
                  caption={caption}
                  visualConcept={visualConcept}
                  brandName={brandName}
                  format={format}
                  onReplaceCaption={onReplaceCaption}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

