"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  hasCreativeBriefContent,
  type CreativeBrief,
  type CreativeMaterialType,
} from "@/lib/creative-brief";
import { type ContentFormat } from "@/lib/types";
import { cn } from "@/lib/utils";

const MATERIAL_LABELS: Record<CreativeMaterialType, string> = {
  video_script: "Video script",
  storyboard: "Storyboard",
  design_notes: "Design notes",
  creative_brief: "Creative brief",
  bullet_ideas: "Bullet-point ideas",
  rough_idea: "Rough idea",
  other: "Planning notes",
};

interface NormalizationResult {
  material_type: CreativeMaterialType;
  suggested_format: ContentFormat | null;
  format_note: string | null;
  brief: CreativeBrief;
  extraction_notes: string[];
}

export function BriefImporter({
  brandId,
  format,
  currentBrief,
  onApply,
  onUseFormat,
}: {
  brandId: string | null;
  format: ContentFormat;
  currentBrief: CreativeBrief;
  onApply: (brief: CreativeBrief) => void;
  onUseFormat: (format: ContentFormat) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rawInput, setRawInput] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error" | "applied">("idle");
  const [result, setResult] = useState<NormalizationResult | null>(null);
  const [message, setMessage] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const signature = JSON.stringify([rawInput, brandId, format]);
  const lastRequestSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastRequestSignatureRef.current && lastRequestSignatureRef.current !== signature) {
      requestRef.current?.abort();
      requestRef.current = null;
      setResult(null);
      setState("idle");
      setMessage("");
      lastRequestSignatureRef.current = null;
    }
  }, [signature]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const organize = async () => {
    if (!brandId || rawInput.trim().length < 5 || state === "loading") return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const requestSignature = signature;
    lastRequestSignatureRef.current = requestSignature;
    setState("loading");
    setMessage("");
    setResult(null);
    try {
      const response = await fetch("/api/normalize-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand_id: brandId, format, raw_input: rawInput }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (requestRef.current !== controller || lastRequestSignatureRef.current !== requestSignature) return;
      if (!response.ok || payload?.status !== "success" || !payload.brief) {
        setMessage(payload?.message || "The material could not be organized.");
        setState("error");
        return;
      }
      setResult(payload as NormalizationResult);
      setState("done");
    } catch (caught: unknown) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (requestRef.current !== controller) return;
      setMessage("The material could not be organized. Try again.");
      setState("error");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const applyResult = (formatOverride?: ContentFormat) => {
    if (!result) return;
    const proposed = result.brief;
    onApply({
      ...currentBrief,
      objective: currentBrief.objective || proposed.objective,
      contentPillar: currentBrief.contentPillar || proposed.contentPillar,
      hook: currentBrief.hook || proposed.hook,
      storytellingStyle: currentBrief.storytellingStyle || proposed.storytellingStyle,
      visualDirection: currentBrief.visualDirection || proposed.visualDirection,
      cta: currentBrief.cta || proposed.cta,
      durationSeconds: currentBrief.durationSeconds ?? proposed.durationSeconds,
      slideCount: currentBrief.slideCount ?? proposed.slideCount,
    });
    if (formatOverride) onUseFormat(formatOverride);
    setState("applied");
  };

  const preview = result ? briefPreview(result.brief) : [];

  return (
    <details
      className="group rounded-xl border border-border bg-surface-2/35"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
        <div>
          <p className="text-sm font-semibold text-foreground">Already have a script or notes?</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Paste any planning material and AI will organize it for your review.</p>
        </div>
        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-semibold text-muted-foreground">Optional</span>
      </summary>

      <div className="space-y-4 border-t border-border p-4">
        <div>
          <label htmlFor="brief-source-material" className="mb-2 block text-sm font-semibold text-foreground">Paste your material</label>
          <textarea
            id="brief-source-material"
            value={rawInput}
            onChange={(event) => setRawInput(event.target.value)}
            rows={7}
            maxLength={12_000}
            className="w-full resize-y rounded-lg border border-border bg-surface p-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/15"
            placeholder="Paste a script, dialogue, storyboard, design notes, bullet points, or a rough idea…"
          />
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">Used only to propose brief fields. The pasted source is not saved.</p>
            <span className="text-xs tabular-nums text-muted-foreground">{rawInput.length.toLocaleString()}/12,000</span>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed text-muted-foreground">AI suggestions never overwrite existing answers and never enter the prediction model.</p>
          <button
            type="button"
            onClick={organize}
            disabled={!brandId || rawInput.trim().length < 5 || state === "loading"}
            title={!brandId ? "Select a brand first" : rawInput.trim().length < 5 ? "Paste a short idea first" : undefined}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-2 disabled:opacity-45"
            aria-busy={state === "loading"}
          >
            {state === "loading" && <Loader2 className="h-4 w-4 animate-spin" />}
            {state === "loading" ? "Organizing…" : "Organize into brief"}
          </button>
        </div>

        {state === "error" && <p role="alert" className="rounded-lg border border-warning/25 bg-warning/[0.04] px-3 py-2 text-sm text-muted-foreground">{message}</p>}

        {result && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-muted-foreground">Detected input</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{MATERIAL_LABELS[result.material_type]}</p>
              </div>
              {result.suggested_format && result.suggested_format !== format && (
                <button type="button" onClick={() => applyResult(result.suggested_format as ContentFormat)} className="min-h-9 rounded-lg border border-primary/20 bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground">
                  Use {formatLabel(result.suggested_format)} and fill brief
                </button>
              )}
            </div>

            {result.format_note && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{result.format_note}</p>}

            {preview.length > 0 ? (
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                {preview.map((item) => (
                  <div key={item.label} className="rounded-lg bg-surface-2/60 p-3">
                    <dt className="text-xs font-semibold text-muted-foreground">{item.label}</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-foreground">{item.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">No reliable brief details were found. Add them manually below.</p>
            )}

            {result.extraction_notes.length > 0 && (
              <div className="mt-4 border-t border-border pt-3">
                <p className="text-xs font-semibold text-foreground">Still unclear</p>
                <ul className="mt-2 space-y-1">
                  {result.extraction_notes.map((note, index) => <li key={index} className="text-xs leading-relaxed text-muted-foreground">{note}</li>)}
                </ul>
              </div>
            )}

            <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">Review and edit every field after applying.</p>
              <button
                type="button"
                onClick={() => applyResult()}
                disabled={!hasCreativeBriefContent(result.brief) || state === "applied"}
                className={cn(
                  "min-h-10 rounded-lg px-4 text-sm font-semibold disabled:opacity-50",
                  state === "applied" ? "bg-surface-2 text-muted-foreground" : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                {state === "applied" ? "Added to brief" : "Fill empty fields"}
              </button>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function briefPreview(brief: CreativeBrief): Array<{ label: string; value: string }> {
  const items = [
    { label: "Goal", value: humanize(brief.objective) },
    { label: "Content pillar", value: brief.contentPillar },
    { label: "Hook", value: brief.hook },
    { label: "Story approach", value: humanize(brief.storytellingStyle) },
    { label: "Execution direction", value: brief.visualDirection },
    { label: "Call to action", value: humanize(brief.cta) },
    { label: "Duration", value: brief.durationSeconds ? `${brief.durationSeconds} seconds` : "" },
    { label: "Slides", value: brief.slideCount ? String(brief.slideCount) : "" },
  ];
  return items.filter((item) => item.value).slice(0, 6);
}

function humanize(value: string): string {
  if (!value) return "";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatLabel(format: ContentFormat): string {
  return format === "Single Image" ? "Feed image" : format === "Reels" ? "Reel" : format;
}
