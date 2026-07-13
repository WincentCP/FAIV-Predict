"use client";

/* Instagram CDN URLs are short-lived and cannot be safely placed in Next
   Image's static remote allowlist. Native img is intentional on this page. */
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { TierBadge } from "@/components/TierBadge";
import { OutcomeComparison } from "@/components/OutcomeComparison";
import { type Tier, type Brand } from "@/lib/types";
import { formatModelScore } from "@/lib/model-scores";
import type { RealizedClassBasis } from "@/lib/realized-outcomes";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Link2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type IgPost = {
  id: string;
  caption: string;
  media_type: "IMAGE" | "CAROUSEL_ALBUM" | "VIDEO";
  media_product_type: "FEED" | "REELS" | "STORY" | "AD" | "UNKNOWN" | null;
  media_url: string | null;
  thumbnail_url: string | null;
  permalink: string | null;
  timestamp: string;
  likes: number | null;
  comments: number | null;
  /** ER captured by a verified Instagram sync, never rebased to today's followers. */
  er: number | null;
  tier: Tier | null;
  comparison_eligible: boolean;
  comparison_unavailable_code: "not_synced" | "immature" | "unmodeled_format" | "incomplete_features" | "lookup_unavailable" | null;
  comparison_unavailable_reason: string | null;
  synced_at: string | null;
};

type Provenance = {
  live_source: "instagram_graph_api" | null;
  synced_source?: "production_database_instagram_graph_sync" | null;
  historical_source?: "production_database_instagram_graph_sync" | null;
  prediction_source?: "authenticated_user_prediction_history" | null;
  stored_only?: boolean;
  degraded_reason_code?: string | null;
  fetched_at: string | null;
  post_limit?: number | null;
};

type PostDetail = {
  metrics: Record<string, number>;
  unavailable_metrics: string[];
  not_attributable_metrics: string[];
  historical: {
    brand_median_er: number | null;
    brand_baseline_posts: number;
    brand_baseline_unavailable_reason: string | null;
    comparison_eligible: boolean;
    comparison_unavailable_code: IgPost["comparison_unavailable_code"];
    comparison_unavailable_reason: string | null;
    recent_performance: {
      available: false;
      reason_code: "fixed_horizon_snapshots_unavailable";
      reason: string;
    };
  };
  prediction: {
    prediction_id: string | null;
    tier: Tier;
    actual_er: number | null;
    realized_tier: Tier | null;
    realized_class_basis: RealizedClassBasis | null;
    tier_error: 0 | 1 | 2 | null;
    verification_badge: "match" | "one_off" | "miss" | null;
    confidence: number | null;
    model_version: string | null;
    match_method: "verified_media_id" | "verified_graph_caption_candidate" | null;
    linked: boolean;
    linked_elsewhere: boolean;
  } | null;
  prediction_match_status: "not_found" | "verified_publication_link" | "unique_verified_caption" | "ambiguous_duplicate_caption";
  provenance: Provenance;
};

function mediaBadge(post: IgPost): { label: string; icon: typeof Film; modeled: boolean } {
  if (post.media_product_type === "STORY") {
    return { label: "Story media (not modeled)", icon: Film, modeled: false };
  }
  if (post.media_product_type === "AD") {
    return { label: "Ad media (not modeled)", icon: Film, modeled: false };
  }
  if (post.media_type === "IMAGE") {
    return { label: "Image", icon: ImageIcon, modeled: true };
  }
  if (post.media_type === "CAROUSEL_ALBUM") {
    return { label: "Carousel", icon: LayoutGrid, modeled: true };
  }
  if (post.media_product_type === "REELS") {
    return { label: "Reels", icon: Film, modeled: true };
  }
  if (post.media_product_type === "FEED") {
    return { label: "Feed Video (not modeled)", icon: Film, modeled: false };
  }
  return { label: "Video (type unverified)", icon: Film, modeled: false };
}

const METRICS = [
  { key: "reach", label: "Reach" },
  { key: "impressions", label: "Impressions" },
  { key: "views", label: "Views" },
  { key: "saved", label: "Saves" },
  { key: "shares", label: "Shares" },
  { key: "accounts_engaged", label: "Accounts engaged" },
  { key: "total_interactions", label: "Total interactions" },
] as const;

const METRIC_LABELS: Record<string, string> = Object.fromEntries(
  METRICS.map((metric) => [metric.key, metric.label])
);

export default function InsightsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [brandsError, setBrandsError] = useState<string | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [posts, setPosts] = useState<IgPost[] | null>(null);
  const [followers, setFollowers] = useState<number | null>(null);
  const [postProvenance, setPostProvenance] = useState<Provenance | null>(null);
  const [selected, setSelected] = useState<IgPost | null>(null);
  const [detail, setDetail] = useState<PostDetail | null>(null);
  const [postsLoading, setPostsLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [requestedPredictionId, setRequestedPredictionId] = useState<string | null>(null);
  const postsRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);

  const loadBrands = useCallback(async () => {
    setBrandsLoading(true);
    setBrandsError(null);
    try {
      const res = await fetchWithRetry("/api/brands", { cache: "no-store" }, 1);
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data)) {
        throw new Error("Brand accounts could not be loaded.");
      }
      const loadedBrands = data as Brand[];
      setBrands(loadedBrands);
      setBrandId((current) => {
        if (current && loadedBrands.some((brand) => brand.id === current)) return current;
        const requestedBrand = new URLSearchParams(window.location.search).get("brand_id");
        if (requestedBrand && loadedBrands.some((brand) => brand.id === requestedBrand)) return requestedBrand;
        return loadedBrands[0]?.id ?? null;
      });
      setRequestedPredictionId(new URLSearchParams(window.location.search).get("prediction_id"));
    } catch (error: unknown) {
      setBrandsError(errorMessage(error, "Brand accounts could not be loaded."));
    } finally {
      setBrandsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBrands();
  }, [loadBrands]);

  const loadPosts = useCallback(async (id: string) => {
    postsRequest.current?.abort();
    const controller = new AbortController();
    postsRequest.current = controller;
    setPostsLoading(true);
    setPostsError(null);
    setPosts(null);
    setFollowers(null);
    setPostProvenance(null);
    setSelected(null);
    setDetail(null);
    try {
      const res = await fetch(`/api/instagram-posts?brand_id=${encodeURIComponent(id)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data?.posts)) {
        throw new Error(data?.message || "Published post data is unavailable.");
      }
      if (postsRequest.current !== controller) return;
      setPosts(data.posts);
      setFollowers(typeof data.followers === "number" ? data.followers : null);
      setPostProvenance(data.provenance ?? null);
      const requestedMedia = new URLSearchParams(window.location.search).get("media_id");
      setSelected(data.posts.find((post: IgPost) => post.id === requestedMedia) ?? data.posts[0] ?? null);
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      setPostsError(errorMessage(error, "Published post data is unavailable."));
    } finally {
      if (postsRequest.current === controller) setPostsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!brandId) return;
    void loadPosts(brandId);
    return () => postsRequest.current?.abort();
  }, [brandId, loadPosts]);

  const loadDetail = useCallback(async (currentBrandId: string, post: IgPost) => {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const res = await fetch("/api/instagram-post-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({ brand_id: currentBrandId, media_id: post.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Detailed metrics are unavailable.");
      if (detailRequest.current !== controller) return;
      setDetail(data);
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      setDetailError(errorMessage(error, "Detailed metrics are unavailable."));
    } finally {
      if (detailRequest.current === controller) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selected || !brandId) {
      setDetail(null);
      return;
    }
    void loadDetail(brandId, selected);
    return () => detailRequest.current?.abort();
  }, [selected, brandId, loadDetail]);

  const summary = useMemo(() => {
    if (!posts?.length) return null;
    const matureErs = posts
      .filter((post) => post.comparison_eligible)
      .map((post) => post.er)
      .filter((value): value is number => typeof value === "number")
      .sort((a, b) => a - b);
    return {
      count: posts.length,
      syncedCount: posts.filter((post) => post.er !== null).length,
      matureCount: matureErs.length,
      medianEr: median(matureErs),
      modeledCount: posts.filter((post) => mediaBadge(post).modeled).length,
    };
  }, [posts]);

  const brandSelector = !brandsLoading && brands.length > 0 ? (
    <label className="flex min-w-[220px] flex-col gap-1.5 text-xs font-semibold text-muted-foreground">
      Brand account
      <select
        value={brandId ?? ""}
        onChange={(event) => setBrandId(event.target.value)}
        className="h-10 rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-foreground outline-none transition-colors duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
      >
        {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
      </select>
    </label>
  ) : undefined;

  return (
    <div className="mx-auto min-h-dvh max-w-[1500px] space-y-7 px-4 py-6 md:px-8 md:py-8">
      <SectionHeader
        title="Results"
        description="See how published posts performed against earlier predictions."
        actions={brandSelector}
      />

      {brandsLoading && <InsightsSkeleton />}

      {!brandsLoading && brandsError && (
        <ErrorState title="Brands unavailable" message={brandsError} onRetry={loadBrands} />
      )}

      {!brandsLoading && !brandsError && brands.length === 0 && (
        <EmptyState
          title="No brand workspace yet"
          description="Add a brand before reviewing Instagram content."
          action={<Link href="/niches" className={primaryButtonClass}>Add brand</Link>}
        />
      )}

      {!brandsLoading && !brandsError && brands.length > 0 && (
        <>
          {summary && (
            <div className="overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-soft)]" aria-label="Published result summary">
              <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
                <SummaryMetric label="Published posts" value={summary.count.toLocaleString()} helper="Recent Instagram posts" />
                <SummaryMetric label="Engagement available" value={summary.syncedCount.toLocaleString()} helper="Posts with synchronized data" />
                <SummaryMetric label="7-day results" value={summary.matureCount.toLocaleString()} helper="Ready to compare" />
                <SummaryMetric label="Typical engagement" value={formatPercent(summary.medianEr)} helper={`${summary.modeledCount} comparable posts`} />
              </div>
            </div>
          )}

          {requestedPredictionId && (
            <div role="status" className="flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/[0.04] p-4 text-sm sm:flex-row sm:items-center">
              <Link2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <p className="flex-1 leading-relaxed text-muted-foreground">
                Select the Instagram post that matches this prediction. We will link it after you confirm.
              </p>
              <button type="button" onClick={() => setRequestedPredictionId(null)} className="min-h-10 rounded-lg px-3 font-semibold text-foreground hover:bg-surface-2">Dismiss</button>
            </div>
          )}

          {posts && (
            <ProvenanceNotice
              followers={followers}
              provenance={postProvenance}
              latestSync={latestSync(posts)}
            />
          )}

          {postsError && (
            <ErrorState
              title="Insights unavailable"
              message={postsError}
              onRetry={brandId ? () => loadPosts(brandId) : undefined}
            />
          )}

          {postsLoading && <InsightsSkeleton />}

          {posts?.length === 0 && !postsLoading && !postsError && (
            <EmptyState
              title="No published posts returned"
              description="This account has no accessible Instagram media yet."
              action={brandId ? <button type="button" onClick={() => loadPosts(brandId)} className={secondaryButtonClass}><RefreshCw className="h-4 w-4" />Refresh</button> : undefined}
            />
          )}

          {posts && posts.length > 0 && (
            <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
              <aside aria-label="Published posts" className="overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-soft)]">
                <div className="border-b border-border px-5 py-4">
                  <h2 className="font-semibold">Choose a post</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Select an Instagram post to review.</p>
                </div>
                <div className="grid auto-cols-[minmax(260px,82vw)] grid-flow-col gap-2 overflow-x-auto p-3 lg:max-h-[720px] lg:auto-cols-auto lg:grid-flow-row lg:overflow-y-auto">
                  {posts.map((post) => (
                    <PostListItem
                      key={post.id}
                      post={post}
                      active={selected?.id === post.id}
                      onSelect={() => setSelected(post)}
                    />
                  ))}
                </div>
              </aside>

              {selected && (
                <PostAnalysis
                  post={selected}
                  detail={detail}
                  loading={detailLoading}
                  error={detailError}
                  onRetry={brandId ? () => loadDetail(brandId, selected) : undefined}
                  onLinked={brandId ? () => loadDetail(brandId, selected) : undefined}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PostListItem({ post, active, onSelect }: { post: IgPost; active: boolean; onSelect: () => void }) {
  const media = mediaBadge(post);
  const preview = post.media_type === "VIDEO" ? post.thumbnail_url || post.media_url : post.media_url;
  const dateLabel = formatDate(post.timestamp);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-label={`View ${media.label} published ${dateLabel}`}
      className={cn(
        "flex w-full gap-3 rounded-xl border p-3 text-left outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary/40 active:translate-y-px",
        active
          ? "border-primary bg-primary/[0.04] shadow-sm"
          : "border-transparent hover:border-border hover:bg-surface-2/60"
      )}
    >
      <MediaPreview post={post} src={preview} compact />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <media.icon aria-hidden="true" className="h-3.5 w-3.5" />{media.label}
          </span>
          {post.comparison_eligible && post.er !== null ? (
            <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">7-day result</span>
          ) : !post.comparison_eligible ? (
            <span
              title={post.comparison_unavailable_reason || undefined}
              className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted-foreground"
            >
              {post.comparison_unavailable_code === "immature" ? "Collecting results" : "Cannot compare"}
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-foreground">{post.caption || "Post without caption"}</p>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <time dateTime={post.timestamp}>{dateLabel}</time>
          <span>{post.er === null ? "Engagement pending" : `Engagement ${formatPercent(post.er)}`}</span>
        </div>
      </div>
    </button>
  );
}

function PostAnalysis({
  post,
  detail,
  loading,
  error,
  onRetry,
  onLinked,
}: {
  post: IgPost;
  detail: PostDetail | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  onLinked?: () => Promise<void> | void;
}) {
  const [linkingPublication, setLinkingPublication] = useState(false);
  const [publicationLinkError, setPublicationLinkError] = useState<string | null>(null);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkAcknowledged, setLinkAcknowledged] = useState(false);
  const linkButtonRef = useRef<HTMLButtonElement>(null);
  const media = mediaBadge(post);
  const preview = post.media_type === "VIDEO" ? post.thumbnail_url || post.media_url : post.media_url;
  const availableMetrics = METRICS.filter((metric) => detail?.metrics?.[metric.key] !== undefined);
  const unavailableLabels = detail?.unavailable_metrics
    .map((metric) => METRIC_LABELS[metric])
    .filter(Boolean) ?? [];

  useEffect(() => {
    setLinkingPublication(false);
    setPublicationLinkError(null);
    setShowLinkDialog(false);
    setLinkAcknowledged(false);
  }, [post.id]);

  useEffect(() => {
    if (!showLinkDialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !linkingPublication) setShowLinkDialog(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [linkingPublication, showLinkDialog]);

  const confirmPublicationLink = async () => {
    const predictionId = detail?.prediction?.prediction_id;
    if (!predictionId || linkingPublication || !linkAcknowledged) return;
    let linked = false;
    setLinkingPublication(true);
    setPublicationLinkError(null);
    try {
      const response = await fetch("/api/publication-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prediction_id: predictionId,
          media_id: post.id,
          confirmed: true,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || "Publication link could not be saved.");
      await onLinked?.();
      linked = true;
      setShowLinkDialog(false);
      setLinkAcknowledged(false);
    } catch (caught: unknown) {
      setPublicationLinkError(
        caught instanceof Error ? caught.message : "Publication link could not be saved."
      );
    } finally {
      setLinkingPublication(false);
      if (linked) window.requestAnimationFrame(() => linkButtonRef.current?.focus());
    }
  };

  const closeLinkDialog = () => {
    if (linkingPublication) return;
    setShowLinkDialog(false);
    setLinkAcknowledged(false);
    window.requestAnimationFrame(() => linkButtonRef.current?.focus());
  };

  return (
    <article className="relative overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-soft)]">
      <div className="grid border-b border-border md:grid-cols-[minmax(260px,0.75fr)_1.25fr]">
        <div className="min-h-[260px] md:min-h-[340px]">
          <MediaPreview post={post} src={preview} />
        </div>
        <div className="space-y-5 p-5 md:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <MediaTypeChip post={post} />
            {post.comparison_eligible && post.er !== null && (
              <span className="inline-flex min-h-7 items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">7-day result</span>
            )}
            {post.permalink && (
              <a
                href={post.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-foreground outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                Open Instagram <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Published content</h2>
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarDays aria-hidden="true" className="h-4 w-4" />
              Published <time dateTime={post.timestamp}>{formatDateTime(post.timestamp)}</time>
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Caption</h3>
            <p className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{post.caption || "No caption supplied."}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {post.likes !== null ? <MetricCard label="Likes" value={post.likes} /> : <UnavailableMetric label="Likes" message="Not returned by Meta." />}
            {post.comments !== null ? <MetricCard label="Comments" value={post.comments} /> : <UnavailableMetric label="Comments" message="Not returned by Meta." />}
            {post.er !== null ? (
              <MetricCard label="Engagement rate" value={post.er} suffix="%" decimals={2} />
            ) : (
              <UnavailableMetric label="Engagement rate" message="Waiting for an Instagram update." />
            )}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Likes and comments may still change. Engagement rate uses the follower count saved during synchronization.
          </p>
        </div>
      </div>

      <div className="space-y-6 p-5 md:p-7" aria-busy={loading}>
        {loading && <DetailSkeleton />}
        {error && <ErrorState title="Detailed metrics unavailable" message={error} onRetry={onRetry} compact />}

        {detail && !loading && (
          <>
            <OutcomeSummary post={post} detail={detail} />

            <section className="rounded-2xl border border-border bg-surface p-5" aria-labelledby="prediction-trace-heading">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 id="prediction-trace-heading" className="font-semibold">Before vs after</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Compare the earlier prediction with this published post.</p>
                </div>
                <Link href={detail.prediction?.prediction_id ? `/history?prediction_id=${encodeURIComponent(detail.prediction.prediction_id)}` : "/history"} className="inline-flex min-h-10 items-center self-start rounded-lg px-2 text-sm font-semibold text-foreground hover:bg-surface-2">
                  Prediction history
                </Link>
              </div>
              {detail.prediction ? (
                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                  <TierBadge tier={detail.prediction.tier} />
                  {detail.prediction.linked && (
                    <span className="inline-flex min-h-7 items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Instagram post linked
                    </span>
                  )}
                  <span>{formatModelScore(detail.prediction.confidence)}</span>
                  {detail.prediction.actual_er !== null && <span>Published engagement: <strong>{detail.prediction.actual_er.toFixed(2)}%</strong></span>}
                  {detail.prediction.model_version && <span className="font-mono text-xs text-muted-foreground">Model {detail.prediction.model_version}</span>}
                  <p className="w-full text-sm leading-relaxed text-muted-foreground">
                    {detail.prediction.linked
                      ? "This result is linked to the Instagram post you confirmed."
                      : detail.prediction.linked_elsewhere
                        ? "This prediction is already linked to another Instagram post."
                      : "Possible match based on the caption. Check the post and publication date before linking."}
                  </p>
                  {detail.prediction.realized_tier && (
                    <div className="w-full rounded-xl border border-border bg-surface-2/35 p-4">
                      <OutcomeComparison
                        predictedTier={detail.prediction.tier}
                        realizedTier={detail.prediction.realized_tier}
                        basis={detail.prediction.realized_class_basis}
                      />
                    </div>
                  )}
                  {!detail.prediction.linked &&
                    !detail.prediction.linked_elsewhere &&
                    detail.prediction.prediction_id &&
                    detail.prediction_match_status === "unique_verified_caption" && (
                      <button
                        ref={linkButtonRef}
                        type="button"
                        onClick={() => setShowLinkDialog(true)}
                        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                      >
                        Link post
                      </button>
                    )}
                  {publicationLinkError && (
                    <p role="alert" className="w-full text-xs font-semibold text-destructive">
                      {publicationLinkError}
                    </p>
                  )}
                </div>
              ) : detail.prediction_match_status === "ambiguous_duplicate_caption" ? (
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">More than one prediction uses this caption. Choose the correct prediction before linking.</p>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">No prediction with this caption was found in your history.</p>
              )}
            </section>

            <EvidenceSection post={post} detail={detail} />

            <details className="group rounded-2xl border border-border bg-surface">
              <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 px-5 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
                Detailed metrics and methodology
                <span className="ml-auto text-sm font-normal text-muted-foreground group-open:hidden">{availableMetrics.length} additional metrics</span>
              </summary>
              <div className="space-y-6 border-t border-border p-5">
                {availableMetrics.length > 0 ? (
                  <section aria-labelledby="verified-metrics-heading">
                    <h3 id="verified-metrics-heading" className="font-semibold">Instagram metrics</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Available metrics depend on the post format.</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {availableMetrics.map((metric) => <MetricCard key={metric.key} label={metric.label} value={detail.metrics[metric.key]} />)}
                    </div>
                  </section>
                ) : (
                  <p className="rounded-xl bg-surface-2/50 p-4 text-sm text-muted-foreground">No additional Instagram metrics are available for this post.</p>
                )}

                {(unavailableLabels.length > 0 || detail.not_attributable_metrics.length > 0) && (
                  <div className="flex items-start gap-2 rounded-xl bg-surface-2/50 p-4 text-sm leading-relaxed text-muted-foreground">
                    <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>{unavailableLabels.length > 0 && <>Not returned: {unavailableLabels.join(", ")}. </>}{detail.not_attributable_metrics.length > 0 && <>Profile visits and follows are account-level actions and are not attributed to this post.</>}</p>
                  </div>
                )}

                <InteractionBreakdown post={post} detail={detail} />
                <div className="rounded-xl border border-border p-4 text-sm leading-relaxed text-muted-foreground">
                  <strong className="text-foreground">Trend data unavailable.</strong> {detail.historical.recent_performance.reason}
                </div>
                <DetailProvenance post={post} provenance={detail.provenance} />
              </div>
            </details>

            <div className="flex flex-col gap-3 rounded-2xl bg-primary p-5 text-primary-foreground sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">Use this result in your next post</p>
                <p className="mt-1 text-sm text-primary-foreground/75">Treat it as guidance, not a guarantee.</p>
              </div>
              <Link href="/predict" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-primary-foreground px-4 text-sm font-semibold text-primary">
                Predict next draft
              </Link>
            </div>
          </>
        )}
      </div>

      {showLinkDialog && detail?.prediction?.prediction_id && (
        <PublicationLinkDialog
          post={post}
          prediction={detail.prediction}
          acknowledged={linkAcknowledged}
          onAcknowledged={setLinkAcknowledged}
          saving={linkingPublication}
          error={publicationLinkError}
          onCancel={closeLinkDialog}
          onConfirm={confirmPublicationLink}
        />
      )}
    </article>
  );
}

// Verified publications expose continuous Observed ER without inventing an outcome tier.
function OutcomeSummary({ post, detail }: { post: IgPost; detail: PostDetail }) {
  const brandMedian = detail.historical.brand_median_er;
  const ageDays = Math.max(0, Math.floor((Date.now() - new Date(post.timestamp).getTime()) / 86_400_000));

  if (detail.historical.comparison_eligible && post.er !== null) {
    return (
      <section aria-labelledby="outcome-summary-title" className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.045] p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-5 w-5" aria-hidden="true" />7-day result ready</div>
            <h3 id="outcome-summary-title" className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">{post.er.toFixed(2)}% engagement rate</h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">Calculated from synchronized likes, comments, and follower count.</p>
          </div>
          <div className="min-w-[220px] rounded-xl border border-border bg-surface p-4">
            <ComparisonCard
              label={`Comparable brand posts · ${detail.historical.brand_baseline_posts}`}
              current={post.er}
              baseline={brandMedian}
              unavailableMessage={detail.historical.brand_baseline_unavailable_reason || "No eligible brand-history baseline is available."}
            />
          </div>
        </div>
      </section>
    );
  }

  if (post.comparison_unavailable_code === "immature") {
    const remaining = Math.max(1, 7 - ageDays);
    return (
      <section aria-labelledby="outcome-summary-title" className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-5">
        <div className="flex items-start gap-3">
          <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <h3 id="outcome-summary-title" className="font-semibold">Collecting results</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">The 7-day result will be ready in {remaining} day{remaining === 1 ? "" : "s"}. Engagement can still change.</p>
            <div className="mt-3 h-1.5 max-w-sm overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="Publication maturity" aria-valuemin={0} aria-valuemax={7} aria-valuenow={Math.min(ageDays, 7)}><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (ageDays / 7) * 100)}%` }} /></div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="outcome-summary-title" className="rounded-2xl border border-border bg-surface-2/40 p-5">
      <h3 id="outcome-summary-title" className="font-semibold">Not ready to compare</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail.historical.comparison_unavailable_reason || post.comparison_unavailable_reason || "This post cannot be compared yet."}</p>
    </section>
  );
}

function PublicationLinkDialog({ post, prediction, acknowledged, onAcknowledged, saving, error, onCancel, onConfirm }: {
  post: IgPost;
  prediction: NonNullable<PostDetail["prediction"]>;
  acknowledged: boolean;
  onAcknowledged: (value: boolean) => void;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href]'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => dialog.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/75 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="publication-link-title" aria-describedby="publication-link-description" className="max-h-[95dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-border bg-surface shadow-[var(--shadow-elevated)] sm:max-h-[90dvh] sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-border p-5 md:p-6">
          <div><h2 id="publication-link-title" className="text-xl font-semibold tracking-tight">Link Instagram post</h2><p id="publication-link-description" className="mt-1 text-sm leading-relaxed text-muted-foreground">Connect this prediction to the selected Instagram post.</p></div>
          <button type="button" onClick={onCancel} disabled={saving} aria-label="Close publication verification" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-surface-2 disabled:opacity-50"><X className="h-5 w-5" aria-hidden="true" /></button>
        </div>
        <div className="space-y-5 p-5 md:p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Prediction</p><div className="mt-3 flex flex-wrap items-center gap-2"><TierBadge tier={prediction.tier} /><span className="text-sm text-muted-foreground">{formatModelScore(prediction.confidence)}</span></div></div>
            <div className="rounded-2xl border border-border p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Instagram post</p><p className="mt-3 text-sm font-semibold">{mediaBadge(post).label} · {formatDate(post.timestamp)}</p><p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{post.caption || "Post without caption"}</p></div>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning/[0.04] p-4 text-sm leading-relaxed text-muted-foreground"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" /><p>This match is based on the caption. Check the post and publication date before continuing.</p></div>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border p-4 hover:bg-surface-2/40"><input autoFocus type="checkbox" checked={acknowledged} onChange={(event) => onAcknowledged(event.target.checked)} className="mt-1 h-4 w-4 accent-current" /><span className="text-sm leading-relaxed"><strong className="block text-foreground">This is the correct Instagram post.</strong><span className="text-muted-foreground">Once linked, it cannot be changed.</span></span></label>
          {error && <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/[0.04] p-3 text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={saving} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold hover:bg-surface-2 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={!acknowledged || saving} aria-label="Verify this publication and link it" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{saving && <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />}{saving ? "Linking…" : "Link post"}</button>
        </div>
      </div>
    </div>
  );
}

function MediaPreview({ post, src, compact = false }: { post: IgPost; src: string | null; compact?: boolean }) {
  const media = mediaBadge(post);
  const Icon = media.icon;
  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-surface-2", compact && "h-16 w-16 shrink-0 rounded-lg")}>
      <Icon aria-hidden="true" className={cn("absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-muted-foreground", compact ? "h-6 w-6" : "h-12 w-12")} />
      {src && (
        <img
          src={src}
          alt={compact ? "" : (post.caption?.slice(0, 100) || `${media.label} preview`)}
          loading={compact ? "lazy" : "eager"}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          onError={(event) => { event.currentTarget.style.display = "none"; }}
        />
      )}
    </div>
  );
}

function MediaTypeChip({ post }: { post: IgPost }) {
  const media = mediaBadge(post);
  const Icon = media.icon;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold">
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />{media.label}
    </span>
  );
}

function InteractionBreakdown({ post, detail }: { post: IgPost; detail: PostDetail }) {
  const items = [
    { label: "Likes", value: post.likes },
    { label: "Comments", value: post.comments },
    { label: "Saves", value: detail.metrics.saved ?? null },
    { label: "Shares", value: detail.metrics.shares ?? null },
  ].filter((item): item is { label: string; value: number } => typeof item.value === "number");
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="interaction-breakdown-heading">
      <h3 id="interaction-breakdown-heading" className="text-sm font-semibold">Interactions</h3>
      <p className="mt-1 text-xs text-muted-foreground">Likes, comments, saves, and shares returned by Instagram.</p>
      <div className="mt-3 space-y-3 rounded-xl border border-border p-4">
        {items.map((item) => {
          const share = total > 0 ? (item.value / total) * 100 : 0;
          return (
            <div key={item.label}>
              <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                <span className="font-medium">{item.label}</span>
                <span className="font-mono text-muted-foreground">{item.value.toLocaleString()} · {share.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                <div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${share}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EvidenceSection({ post, detail }: { post: IgPost; detail: PostDetail }) {
  const observations: string[] = [];
  if (
    detail.historical.comparison_eligible &&
    post.er !== null &&
    detail.historical.brand_median_er !== null
  ) {
    observations.push(
      comparisonSentence(
        post.er,
        detail.historical.brand_median_er,
        "comparable brand posts (excluding this post)"
      )
    );
  }
  if (typeof detail.metrics.saved === "number" && typeof detail.metrics.reach === "number" && detail.metrics.reach > 0) {
    observations.push(`Saves equal ${((detail.metrics.saved / detail.metrics.reach) * 100).toFixed(2)} per 100 reached accounts.`);
  }
  if (typeof detail.metrics.shares === "number" && typeof detail.metrics.reach === "number" && detail.metrics.reach > 0) {
    observations.push(`Shares equal ${((detail.metrics.shares / detail.metrics.reach) * 100).toFixed(2)} per 100 reached accounts.`);
  }

  return (
    <section className="rounded-xl border border-border bg-surface-2/30 p-5" aria-labelledby="observations-heading">
      <h3 id="observations-heading" className="text-sm font-semibold">Key observations</h3>
      <p className="mt-1 text-xs text-muted-foreground">Calculated from available Instagram data.</p>
      {observations.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm text-foreground">
          {observations.map((observation) => <li key={observation} className="flex gap-2"><span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />{observation}</li>)}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Not enough verified values are available for a meaningful comparison.</p>
      )}
    </section>
  );
}

function ProvenanceNotice({ followers, provenance, latestSync: sync }: { followers: number | null; provenance: Provenance | null; latestSync: string | null }) {
  // unequal-age cumulative ER is not presented as a recent trend.
  const fetched = provenance?.fetched_at ? formatDateTime(provenance.fetched_at) : "time unavailable";
  const storedOnly = provenance?.stored_only === true || provenance?.live_source !== "instagram_graph_api";
  return (
    <div className={cn("rounded-2xl border p-4", storedOnly ? "border-warning/25 bg-warning/[0.035]" : "border-border bg-surface")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Database aria-hidden="true" className={cn("h-5 w-5 shrink-0", storedOnly ? "text-warning" : "text-primary")} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{storedOnly ? "Saved Instagram data" : "Live Instagram data"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{storedOnly ? `Live data was unavailable at ${fetched}; the latest saved update is shown.` : `Updated from Instagram at ${fetched}.`}</p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{followers === null ? "Followers unavailable" : `${followers.toLocaleString()} followers`}</span>
          <span>{sync ? `Last updated ${formatDateTime(sync)}` : "Update pending"}</span>
        </div>
      </div>
      <details className="group mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
        <summary className="cursor-pointer list-none font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/40">How engagement rate is calculated</summary>
        <p className="mt-2">Engagement rate uses synchronized likes and comments divided by the saved follower count. Comparisons use supported posts that are at least 7 days old.</p>
        {provenance?.post_limit && <p className="mt-1">This view requests up to {provenance.post_limit} recent posts.</p>}
      </details>
    </div>
  );
}

function DetailProvenance({ post, provenance }: { post: IgPost; provenance: Provenance }) {
  return (
    <footer className="flex items-start gap-2 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        Instagram metrics updated{provenance.fetched_at ? ` at ${formatDateTime(provenance.fetched_at)}` : ""}.
        {post.synced_at ? ` Engagement rate saved ${formatDateTime(post.synced_at)}.` : " Saved engagement rate is not available yet."}
      </p>
    </footer>
  );
}

function SummaryMetric({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="min-h-32 bg-surface p-5">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{helper}</p>
    </div>
  );
}

function MetricCard({ label, value, suffix = "", decimals = 0 }: { label: string; value: number; suffix?: string; decimals?: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <p className="mt-2 font-mono text-lg font-semibold tabular-nums">{value.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}{suffix}</p>
    </div>
  );
}

function UnavailableMetric({ label, message }: { label: string; message: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-2 text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function ComparisonCard({
  label,
  current,
  baseline,
  unavailableMessage,
}: {
  label: string;
  current: number;
  baseline: number | null | undefined;
  unavailableMessage?: string;
}) {
  if (baseline === null || baseline === undefined) {
    return <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">{unavailableMessage || `${label} is unavailable.`}</div>;
  }
  const delta = current - baseline;
  const positive = delta >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Icon aria-hidden="true" className={cn("h-4 w-4", positive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")} />
        <span className="font-mono text-lg font-semibold">{positive ? "+" : ""}{delta.toFixed(2)}pp</span>
        <span className="text-xs text-muted-foreground">from {baseline.toFixed(2)}%</span>
      </div>
    </div>
  );
}

function ErrorState({ title, message, compact = false, onRetry }: { title: string; message: string; compact?: boolean; onRetry?: () => void }) {
  return (
    <div role="alert" className={cn("rounded-xl border border-warning/30 bg-warning/[0.04] p-4", !compact && "flex items-start gap-3")}>
      <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-warning" />
      <div className={cn("flex-1 text-sm text-muted-foreground", compact && "mt-2")}>
        <span className="block font-semibold text-foreground">{title}</span>
        <p className="mt-1">{message}</p>
        {onRetry && <button type="button" onClick={onRetry} className={cn(secondaryButtonClass, "mt-3")}><RefreshCw aria-hidden="true" className="h-4 w-4" />Try again</button>}
      </div>
    </div>
  );
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-8 text-center sm:p-12">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">{description}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div aria-label="Loading insights" role="status" className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
      <div className="h-[420px] rounded-2xl border border-border bg-surface motion-safe:animate-pulse" />
      <div className="h-[580px] rounded-2xl border border-border bg-surface motion-safe:animate-pulse" />
      <span className="sr-only">Loading Instagram insights</span>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading detailed metrics" className="space-y-3">
      <div className="h-4 w-44 rounded bg-surface-2 motion-safe:animate-pulse" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((item) => <div key={item} className="h-24 rounded-xl bg-surface-2 motion-safe:animate-pulse" />)}
      </div>
      <span className="sr-only">Loading detailed post metrics</span>
    </div>
  );
}

const primaryButtonClass = "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none transition-colors duration-150 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/40 active:translate-y-px";
const secondaryButtonClass = "inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary/40 active:translate-y-px";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
}

function formatPercent(value: number | null): string {
  return value === null ? "Unavailable" : `${value.toFixed(2)}%`;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Date unavailable" : parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "time unavailable" : parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function latestSync(posts: IgPost[]): string | null {
  const timestamps = posts
    .map((post) => post.synced_at)
    .filter((value): value is string => typeof value === "string")
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function comparisonSentence(current: number, baseline: number, label: string): string {
  const delta = current - baseline;
  if (Math.abs(delta) < 0.005) return `Engagement rate matches ${label} to two decimal places.`;
  return `Engagement rate is ${Math.abs(delta).toFixed(2)} percentage points ${delta > 0 ? "above" : "below"} ${label}.`;
}
