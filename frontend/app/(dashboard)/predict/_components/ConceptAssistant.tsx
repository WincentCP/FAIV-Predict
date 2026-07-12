"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  CREATIVE_CTAS,
  CREATIVE_OBJECTIVES,
  STORYTELLING_STYLES,
  hasCreativeBriefContent,
  parseCreativeBrief,
  serializeCreativeBrief,
  type CreativeBrief,
} from "@/lib/creative-brief";
import { type ContentFormat } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BriefImporter } from "./BriefImporter";
import { Label } from "./Panel";

export interface ConceptAnalysis {
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
  brand_alignment: string | null;
  trend_adaptation: string | null;
}

export interface CreativeReviewSnapshot {
  analysis: ConceptAnalysis;
  inputSignature: string;
  historicalContextUsed: boolean;
  userTrendContextUsed: boolean;
}

const OBJECTIVE_LABELS: Record<(typeof CREATIVE_OBJECTIVES)[number], string> = {
  awareness: "Build awareness",
  engagement: "Start conversation",
  education: "Teach something",
  conversion: "Drive action",
  community: "Build community",
};

const STORY_LABELS: Record<(typeof STORYTELLING_STYLES)[number], string> = {
  problem_solution: "Problem → solution",
  story_journey: "Story or journey",
  list_tips: "List or tips",
  demo_tutorial: "Demo or tutorial",
  before_after: "Before and after",
  testimonial: "Testimonial",
  behind_the_scenes: "Behind the scenes",
  pov_skit: "POV or skit",
  other: "Other",
};

const CTA_LABELS: Record<(typeof CREATIVE_CTAS)[number], string> = {
  none: "No CTA",
  comment: "Comment",
  save: "Save",
  share: "Share",
  follow: "Follow",
  visit_profile: "Visit profile",
  visit_link: "Visit link",
  buy_book: "Buy or book",
  other: "Other",
};

const FORMAT_FIELDS: Record<ContentFormat, {
  guidance: string;
  hookLabel: string;
  hookPlaceholder: string;
  directionLabel: string;
  directionPlaceholder: string;
}> = {
  Reels: {
    guidance: "Plan the first seconds, flow, and pacing.",
    hookLabel: "Opening hook",
    hookPlaceholder: "What happens or is said in the first three seconds?",
    directionLabel: "Video flow and visual direction",
    directionPlaceholder: "Summarize scenes, dialogue, pacing, camera style, product visibility, or ending…",
  },
  Carousel: {
    guidance: "Plan the cover, slide flow, and takeaway.",
    hookLabel: "Cover hook",
    hookPlaceholder: "What should make someone swipe past the cover?",
    directionLabel: "Slide flow and design direction",
    directionPlaceholder: "Describe the cover, key slides, visual system, proof points, and final slide…",
  },
  "Single Image": {
    guidance: "Plan one clear message and focal point.",
    hookLabel: "Headline or key message",
    hookPlaceholder: "What should someone understand at a glance?",
    directionLabel: "Design direction",
    directionPlaceholder: "Describe the focal subject, composition, text density, visual style, and product placement…",
  },
};

const fieldClass = "h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/15";

export function ConceptAssistant({
  visualConcept,
  setVisualConcept,
  caption,
  brandId,
  format,
  onChangeFormat,
  reviewSnapshot,
  onReviewComplete,
}: {
  visualConcept: string;
  setVisualConcept: (v: string) => void;
  caption: string;
  brandId: string | null;
  format: ContentFormat;
  onChangeFormat: (format: ContentFormat) => void;
  reviewSnapshot: CreativeReviewSnapshot | null;
  onReviewComplete: (review: CreativeReviewSnapshot) => void;
}) {
  const inputSignature = JSON.stringify([visualConcept, caption, brandId, format]);
  const [brief, setBrief] = useState<CreativeBrief>(() => parseCreativeBrief(visualConcept));
  const [trendOpen, setTrendOpen] = useState(() => Boolean(parseCreativeBrief(visualConcept).trendContext));
  const lastEmittedBriefRef = useRef(visualConcept);
  const [conceptState, setConceptState] = useState<"idle" | "loading" | "done" | "error">(reviewSnapshot ? "done" : "idle");
  const [conceptAnalysis, setConceptAnalysis] = useState<ConceptAnalysis | null>(reviewSnapshot?.analysis ?? null);
  const [conceptError, setConceptError] = useState("");
  const [isStale, setIsStale] = useState(Boolean(reviewSnapshot && reviewSnapshot.inputSignature !== inputSignature));
  const [historicalContextUsed, setHistoricalContextUsed] = useState(reviewSnapshot?.historicalContextUsed ?? false);
  const [userTrendContextUsed, setUserTrendContextUsed] = useState(reviewSnapshot?.userTrendContextUsed ?? false);
  const requestRef = useRef<AbortController | null>(null);
  const completedSignatureRef = useRef<string | null>(reviewSnapshot?.inputSignature ?? null);
  const latestInputSignatureRef = useRef(inputSignature);

  const coreFields = [
    brief.objective,
    brief.contentPillar,
    brief.hook,
    brief.storytellingStyle,
    brief.visualDirection,
    brief.cta,
  ];
  const completedFields = coreFields.filter(Boolean).length;
  const completion = Math.round((completedFields / coreFields.length) * 100);
  const currentContextComplete = !brief.trendContext.trim() || Boolean(brief.trendSource.trim() && brief.trendObservedAt);
  const reviewReady = hasCreativeBriefContent(brief) && Boolean(brandId) && currentContextComplete;
  const formatFields = FORMAT_FIELDS[format];

  useEffect(() => {
    latestInputSignatureRef.current = inputSignature;
    if (completedSignatureRef.current && completedSignatureRef.current !== inputSignature) setIsStale(true);
    if (requestRef.current) {
      requestRef.current.abort();
      requestRef.current = null;
      setConceptState((state) => (state === "loading" ? "idle" : state));
    }
  }, [inputSignature]);

  useEffect(() => {
    if (visualConcept !== lastEmittedBriefRef.current) {
      const incoming = parseCreativeBrief(visualConcept);
      setBrief(incoming);
      if (incoming.trendContext) setTrendOpen(true);
      lastEmittedBriefRef.current = visualConcept;
    }
  }, [visualConcept]);

  useEffect(() => {
    if ((format !== "Reels" && brief.durationSeconds !== null) || (format !== "Carousel" && brief.slideCount !== null)) {
      const next = {
        ...brief,
        durationSeconds: format === "Reels" ? brief.durationSeconds : null,
        slideCount: format === "Carousel" ? brief.slideCount : null,
      };
      setBrief(next);
      const serialized = serializeCreativeBrief(next);
      lastEmittedBriefRef.current = serialized;
      setVisualConcept(serialized);
    }
  }, [brief, format, setVisualConcept]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const updateBrief = (patch: Partial<CreativeBrief>) => {
    const next = { ...brief, ...patch };
    if (typeof patch.trendContext === "string" && patch.trendContext.trim() === "") {
      next.trendSource = "";
      next.trendObservedAt = "";
    }
    setBrief(next);
    const serialized = serializeCreativeBrief(next);
    lastEmittedBriefRef.current = serialized;
    setVisualConcept(serialized);
  };

  const applyImportedBrief = (next: CreativeBrief) => {
    setBrief(next);
    const serialized = serializeCreativeBrief(next);
    lastEmittedBriefRef.current = serialized;
    setVisualConcept(serialized);
  };

  const analyzeConcept = async () => {
    if (!brandId || !reviewReady) return;
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
        body: JSON.stringify({ brand_id: brandId, brief, concept: visualConcept, caption, format }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (requestRef.current !== controller || latestInputSignatureRef.current !== requestSignature) return;
      if (res.ok && data?.status === "success" && data.analysis) {
        setConceptAnalysis(data.analysis);
        setHistoricalContextUsed(data.analysis_context?.historical_patterns_used === true);
        setUserTrendContextUsed(data.analysis_context?.user_trend_context_used === true);
        completedSignatureRef.current = requestSignature;
        onReviewComplete({
          analysis: data.analysis,
          inputSignature: requestSignature,
          historicalContextUsed: data.analysis_context?.historical_patterns_used === true,
          userTrendContextUsed: data.analysis_context?.user_trend_context_used === true,
        });
        setConceptState("done");
      } else {
        setConceptError(data?.message || "Creative review is unavailable.");
        setConceptState("error");
      }
    } catch (caught: unknown) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (requestRef.current !== controller) return;
      setConceptError("Creative review is unavailable. Try again.");
      setConceptState("error");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  return (
    <div className="space-y-5">
      <BriefImporter
        brandId={brandId}
        format={format}
        currentBrief={brief}
        onApply={applyImportedBrief}
        onUseFormat={onChangeFormat}
      />

      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Guided essentials</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Add only what you know. You can refine the rest later.</p>
        </div>
        <p className="text-xs font-medium text-primary">{formatFields.guidance}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div>
          <Label htmlFor="brief-objective">Goal</Label>
          <select id="brief-objective" value={brief.objective} onChange={(event) => updateBrief({ objective: event.target.value as CreativeBrief["objective"] })} className={fieldClass}>
            <option value="">Choose a goal</option>
            {CREATIVE_OBJECTIVES.map((value) => <option key={value} value={value}>{OBJECTIVE_LABELS[value]}</option>)}
          </select>
        </div>

        <div>
          <Label htmlFor="brief-pillar">Content pillar</Label>
          <input id="brief-pillar" value={brief.contentPillar} onChange={(event) => updateBrief({ contentPillar: event.target.value })} maxLength={120} className={fieldClass} placeholder="Education, product, community…" />
        </div>

        <div>
          <Label htmlFor="brief-story">Story approach</Label>
          <select id="brief-story" value={brief.storytellingStyle} onChange={(event) => updateBrief({ storytellingStyle: event.target.value as CreativeBrief["storytellingStyle"] })} className={fieldClass}>
            <option value="">Choose an approach</option>
            {STORYTELLING_STYLES.map((value) => <option key={value} value={value}>{STORY_LABELS[value]}</option>)}
          </select>
        </div>

        <div className="md:col-span-2">
          <Label htmlFor="brief-hook">{formatFields.hookLabel}</Label>
          <input id="brief-hook" value={brief.hook} onChange={(event) => updateBrief({ hook: event.target.value })} maxLength={240} className={fieldClass} placeholder={formatFields.hookPlaceholder} />
        </div>

        <div>
          <Label htmlFor="brief-cta">Call to action</Label>
          <select id="brief-cta" value={brief.cta} onChange={(event) => updateBrief({ cta: event.target.value as CreativeBrief["cta"] })} className={fieldClass}>
            <option value="">Choose an action</option>
            {CREATIVE_CTAS.map((value) => <option key={value} value={value}>{CTA_LABELS[value]}</option>)}
          </select>
        </div>

        <div className="md:col-span-2 xl:col-span-2">
          <Label htmlFor="brief-visual">{formatFields.directionLabel}</Label>
          <textarea id="brief-visual" value={brief.visualDirection} onChange={(event) => updateBrief({ visualDirection: event.target.value })} rows={4} maxLength={1600} className="w-full resize-y rounded-lg border border-border bg-surface p-3 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/15" placeholder={formatFields.directionPlaceholder} />
        </div>

        <div>
          {format === "Reels" ? (
            <>
              <Label htmlFor="brief-duration">Video duration</Label>
              <div className="relative">
                <input id="brief-duration" type="number" min={1} max={600} value={brief.durationSeconds ?? ""} onChange={(event) => updateBrief({ durationSeconds: event.target.value ? Number(event.target.value) : null, slideCount: null })} className={`${fieldClass} pr-20`} placeholder="30" />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">seconds</span>
              </div>
            </>
          ) : format === "Carousel" ? (
            <>
              <Label htmlFor="brief-slides">Number of slides</Label>
              <input id="brief-slides" type="number" min={2} max={20} value={brief.slideCount ?? ""} onChange={(event) => updateBrief({ slideCount: event.target.value ? Number(event.target.value) : null, durationSeconds: null })} className={fieldClass} placeholder="6" />
            </>
          ) : (
            <div className="rounded-xl border border-border bg-surface-2/50 p-4 text-sm leading-relaxed text-muted-foreground">For a single image, describe the focal subject and text density above.</div>
          )}
        </div>
      </div>

      <details className="group rounded-xl border border-border bg-surface-2/35" open={trendOpen} onToggle={(event) => setTrendOpen(event.currentTarget.open)}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
          <div>
            <p className="text-sm font-semibold text-foreground">Current context <span className="font-normal text-muted-foreground">(optional)</span></p>
            <p className="mt-0.5 text-xs text-muted-foreground">Add a trend, event, or audience shift you found.</p>
          </div>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", brief.trendContext.trim() && currentContextComplete ? "bg-primary/10 text-primary" : brief.trendContext.trim() ? "bg-warning/10 text-warning" : "bg-surface text-muted-foreground")}>{brief.trendContext.trim() ? currentContextComplete ? "Ready" : "Add source and date" : "Not added"}</span>
        </summary>
        <div className="grid gap-4 border-t border-border p-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.45fr)]">
          <div className="md:row-span-2">
            <Label htmlFor="brief-trend">What is changing?</Label>
            <textarea id="brief-trend" value={brief.trendContext} onChange={(event) => updateBrief({ trendContext: event.target.value })} rows={4} maxLength={700} className="w-full resize-y rounded-lg border border-border bg-surface p-3 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/15" placeholder="Example: short tutorial Reels using quick before-and-after cuts…" />
          </div>
          <div>
            <Label htmlFor="brief-trend-source">Source</Label>
            <input id="brief-trend-source" value={brief.trendSource} onChange={(event) => updateBrief({ trendSource: event.target.value })} maxLength={500} disabled={!brief.trendContext.trim()} className={fieldClass} placeholder="URL or source name" />
          </div>
          <div>
            <Label htmlFor="brief-trend-date">Observed on</Label>
            <input id="brief-trend-date" type="date" max={new Date().toISOString().slice(0, 10)} value={brief.trendObservedAt} onChange={(event) => updateBrief({ trendObservedAt: event.target.value })} disabled={!brief.trendContext.trim()} className={fieldClass} />
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground md:col-span-2">This context is provided by you and used only for creative feedback. FAIV does not claim a live trend feed.</p>
        </div>
      </details>

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold text-foreground">Brief completeness</span>
            <span className="text-muted-foreground">{completedFields}/{coreFields.length} essentials</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="Creative Brief completeness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${completion}%` }} />
          </div>
        </div>
        <button type="button" onClick={analyzeConcept} disabled={conceptState === "loading" || !reviewReady} title={!brandId ? "Select a brand first" : !hasCreativeBriefContent(brief) ? "Add at least one brief detail" : !currentContextComplete ? "Add a source and observed date for the current context" : undefined} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-45" aria-busy={conceptState === "loading"}>
          {conceptState === "loading" && <Loader2 className="h-4 w-4 animate-spin" />}
          {conceptState === "loading" ? "Reviewing…" : conceptState === "done" ? "Review again" : "Review creative"}
        </button>
      </div>

      {conceptState === "error" && <div role="alert" className="rounded-lg border border-warning/30 bg-warning/[0.03] px-3 py-2 text-sm text-muted-foreground">{conceptError}</div>}

      {conceptState === "done" && conceptAnalysis && (
        <div className={cn("space-y-4 rounded-xl border border-border bg-surface-2/50 p-4", isStale && "opacity-75")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">Creative review</p>
            <div className="flex flex-wrap gap-1.5">
              <StatusChip label={historicalContextUsed ? "Brand history used" : "Brief only"} active={historicalContextUsed} />
              {userTrendContextUsed && <StatusChip label="Your current context used" active />}
            </div>
          </div>
          {isStale && <div role="status" className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/[0.04] px-3 py-2 text-xs text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />The draft changed. Review the creative again.</div>}
          <div className="flex flex-wrap gap-1.5">
            <StatusChip label={conceptAnalysis.content_type} active />
            {conceptAnalysis.tone && <StatusChip label={conceptAnalysis.tone} />}
            {conceptAnalysis.pov_format && <StatusChip label="POV" />}
            {conceptAnalysis.dialogue_heavy && <StatusChip label="Dialogue-led" />}
            {conceptAnalysis.scene_count !== null && <StatusChip label={`${conceptAnalysis.scene_count} scenes`} />}
          </div>
          {(conceptAnalysis.brand_alignment || conceptAnalysis.trend_adaptation) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {conceptAnalysis.brand_alignment && <ReviewNote label="Brand fit" value={conceptAnalysis.brand_alignment} />}
              {conceptAnalysis.trend_adaptation && <ReviewNote label="Trend adaptation" value={conceptAnalysis.trend_adaptation} />}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <ReviewList label="Strong points" items={conceptAnalysis.strengths} empty="No clear strength identified yet." />
            <ReviewList label="Try next" items={conceptAnalysis.suggestions} empty="No change suggested." />
          </div>
          <p className="text-xs text-muted-foreground">Creative guidance only. Finished visuals, audience demographics, and live platform trends are not analyzed.</p>
        </div>
      )}
    </div>
  );
}

function StatusChip({ label, active = false }: { label: string; active?: boolean }) {
  return <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold", active ? "border-primary/20 bg-primary/10 text-primary" : "border-border bg-surface text-muted-foreground")}>{label}</span>;
}

function ReviewNote({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border bg-surface p-3"><p className="text-xs font-semibold text-foreground">{label}</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{value}</p></div>;
}

function ReviewList({ label, items, empty }: { label: string; items: string[]; empty: string }) {
  return <div><p className="text-xs font-semibold text-foreground">{label}</p>{items.length ? <ul className="mt-2 space-y-1.5">{items.map((item, index) => <li key={`${label}-${index}`} className="text-sm leading-relaxed text-muted-foreground">{item}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">{empty}</p>}</div>;
}
