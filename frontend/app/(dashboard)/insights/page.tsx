"use client";

/* Instagram CDN URLs are short-lived and cannot be safely placed in Next
   Image's static remote allowlist. Native img is intentional on this page. */
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { TierBadge } from "@/components/TierBadge";
import { type Tier, type Brand } from "@/lib/types";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bookmark,
  CalendarDays,
  Database,
  ExternalLink,
  Film,
  Heart,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  MessageCircle,
  RefreshCw,
  Share2,
  TrendingDown,
  TrendingUp,
  Users,
  Eye,
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
  { key: "reach", label: "Reach", icon: Users },
  { key: "impressions", label: "Impressions", icon: Eye },
  { key: "views", label: "Views", icon: Eye },
  { key: "saved", label: "Saves", icon: Bookmark },
  { key: "shares", label: "Shares", icon: Share2 },
  { key: "accounts_engaged", label: "Accounts engaged", icon: Activity },
  { key: "total_interactions", label: "Total interactions", icon: BarChart3 },
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
        return loadedBrands[0]?.id ?? null;
      });
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
      setSelected(data.posts[0] ?? null);
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
    const ers = posts
      .map((post) => post.er)
      .filter((value): value is number => typeof value === "number")
      .sort((a, b) => a - b);
    return {
      count: posts.length,
      syncedCount: ers.length,
      medianEr: median(ers),
      avgLikes: averageKnown(posts.map((post) => post.likes)),
      avgComments: averageKnown(posts.map((post) => post.comments)),
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
    <div className="mx-auto min-h-dvh max-w-[1500px] space-y-6 px-4 py-6 md:px-8 md:py-8">
      <SectionHeader
        eyebrow="Insights"
        title="Published Content Analytics"
        description="Inspect verified Instagram performance, compare synced outcomes with brand history, and trace predictions without fabricated metrics."
        actions={brandSelector}
      />

      {brandsLoading && <InsightsSkeleton />}

      {!brandsLoading && brandsError && (
        <ErrorState title="Brands unavailable" message={brandsError} onRetry={loadBrands} />
      )}

      {!brandsLoading && !brandsError && brands.length === 0 && (
        <EmptyState
          icon={Database}
          title="No brand workspace yet"
          description="Register a brand before reviewing published Instagram content. No example accounts or posts are inserted."
          action={<Link href="/niches" className={primaryButtonClass}>Register a brand</Link>}
        />
      )}

      {!brandsLoading && !brandsError && brands.length > 0 && (
        <>
          {summary && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loaded post summary">
              <SummaryMetric label="Latest posts loaded" value={summary.count.toLocaleString()} helper={`${summary.syncedCount} with verified ER`} />
              <SummaryMetric label="Loaded-post median synced ER" value={formatPercent(summary.medianEr)} helper="Descriptive only · mixed post ages" />
              <SummaryMetric label="Live average likes" value={formatRounded(summary.avgLikes)} helper="Instagram Graph API" />
              <SummaryMetric label="Live average comments" value={formatRounded(summary.avgComments)} helper="Instagram Graph API" />
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
              icon={ImageIcon}
              title="No published posts returned"
              description="This connected account has no accessible Instagram media yet. Nothing is substituted with demo content."
              action={brandId ? <button type="button" onClick={() => loadPosts(brandId)} className={secondaryButtonClass}><RefreshCw className="h-4 w-4" />Refresh</button> : undefined}
            />
          )}

          {posts && posts.length > 0 && (
            <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
              <aside aria-label="Published posts" className="overflow-hidden rounded-2xl border border-border bg-surface">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold">Published posts</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">Choose a post to inspect verified metrics.</p>
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
          ? "border-primary bg-primary/[0.06]"
          : "border-transparent hover:border-border hover:bg-surface-2/60"
      )}
    >
      <MediaPreview post={post} src={preview} compact />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <media.icon aria-hidden="true" className="h-3.5 w-3.5" />{media.label}
          </span>
          {post.tier ? (
            <TierBadge tier={post.tier} className="origin-right scale-95" />
          ) : !post.comparison_eligible && post.er !== null ? (
            <span
              title={post.comparison_unavailable_reason || undefined}
              className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted-foreground"
            >
              Not comparable
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-foreground">{post.caption || "Post without caption"}</p>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <time dateTime={post.timestamp}>{dateLabel}</time>
          <span className="font-mono">ER {formatPercent(post.er)}</span>
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
  const media = mediaBadge(post);
  const preview = post.media_type === "VIDEO" ? post.thumbnail_url || post.media_url : post.media_url;
  const brandMedian = detail?.historical?.brand_median_er;
  const availableMetrics = METRICS.filter((metric) => detail?.metrics?.[metric.key] !== undefined);
  const unavailableLabels = detail?.unavailable_metrics
    .map((metric) => METRIC_LABELS[metric])
    .filter(Boolean) ?? [];

  useEffect(() => {
    setLinkingPublication(false);
    setPublicationLinkError(null);
  }, [post.id]);

  const confirmPublicationLink = async () => {
    const predictionId = detail?.prediction?.prediction_id;
    if (!predictionId || linkingPublication) return;
    const confirmed = window.confirm(
      "Confirm that this exact Instagram post is the content represented by the prediction. This stores an immutable media-ID link; caption similarity alone is not proof."
    );
    if (!confirmed) return;
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
    } catch (caught: unknown) {
      setPublicationLinkError(
        caught instanceof Error ? caught.message : "Publication link could not be saved."
      );
    } finally {
      setLinkingPublication(false);
    }
  };

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="grid border-b border-border md:grid-cols-[minmax(260px,0.8fr)_1.2fr]">
        <div className="min-h-[280px] md:min-h-[360px]">
          <MediaPreview post={post} src={preview} />
        </div>
        <div className="space-y-5 p-5 md:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <MediaTypeChip post={post} />
            {post.tier && <TierBadge tier={post.tier} />}
            {post.permalink && (
              <a
                href={post.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-primary outline-none transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                Open Instagram <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold">Post performance</h2>
            <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />
              Published <time dateTime={post.timestamp}>{formatDateTime(post.timestamp)}</time>
            </p>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-foreground">Caption</h3>
            <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{post.caption || "No caption supplied."}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {post.likes !== null ? <MetricCard label="Likes" value={post.likes} icon={Heart} /> : <UnavailableMetric label="Likes" message="Not returned by Meta." />}
            {post.comments !== null ? <MetricCard label="Comments" value={post.comments} icon={MessageCircle} /> : <UnavailableMetric label="Comments" message="Not returned by Meta." />}
            {post.er !== null ? (
              <MetricCard label="Synced ER" value={post.er} suffix="%" decimals={2} icon={Activity} />
            ) : (
              <UnavailableMetric label="Synced ER" message="Awaiting verified sync." />
            )}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Likes and comments are fetched live. ER and tier use the follower snapshot preserved at the verified sync shown below.
          </p>
        </div>
      </div>

      <div className="space-y-6 p-5 md:p-6" aria-busy={loading}>
        {loading && <DetailSkeleton />}
        {error && <ErrorState title="Detailed metrics unavailable" message={error} onRetry={onRetry} compact />}

        {detail && !loading && (
          <>
            {availableMetrics.length > 0 ? (
              <section aria-labelledby="verified-metrics-heading">
                <h3 id="verified-metrics-heading" className="text-sm font-semibold">Verified Meta metrics</h3>
                <p className="mt-1 text-xs text-muted-foreground">Lifetime fields appear only when Meta supports them for this media type.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {availableMetrics.map((metric) => (
                    <MetricCard key={metric.key} label={metric.label} value={detail.metrics[metric.key]} icon={metric.icon} />
                  ))}
                </div>
              </section>
            ) : (
              <p className="rounded-xl border border-border bg-surface-2/40 p-4 text-sm text-muted-foreground">
                Meta returned no additional lifetime metrics for this media type. No values were filled with zero or estimates.
              </p>
            )}

            {(unavailableLabels.length > 0 || detail.not_attributable_metrics.length > 0) && (
              <div className="flex items-start gap-2 rounded-xl border border-border bg-surface-2/30 p-4 text-xs leading-relaxed text-muted-foreground">
                <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  {unavailableLabels.length > 0 && <>Not returned for this post: {unavailableLabels.join(", ")}. </>}
                  {detail.not_attributable_metrics.length > 0 && <>Profile visits and follows are account-level actions, so they are not attributed to this organic post.</>}
                </p>
              </div>
            )}

            <InteractionBreakdown post={post} detail={detail} />

            <section aria-labelledby="comparison-heading">
              <h3 id="comparison-heading" className="text-sm font-semibold">Historical comparison</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                The baseline uses other mature, model-supported, verified brand posts and preserved follower snapshots.
              </p>
              {detail.historical.comparison_eligible && post.er !== null ? (
                <div className="mt-3 max-w-xl">
                  <ComparisonCard
                    label={`Eligible brand history · n=${detail.historical.brand_baseline_posts}`}
                    current={post.er}
                    baseline={brandMedian}
                    unavailableMessage={
                      detail.historical.brand_baseline_unavailable_reason ||
                      "No eligible brand-history baseline is available."
                    }
                  />
                </div>
              ) : (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-surface-2/30 p-4 text-sm text-muted-foreground">
                  <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    Brand-history comparison unavailable. {detail.historical.comparison_unavailable_reason || post.comparison_unavailable_reason || "Eligibility could not be verified."}
                  </p>
                </div>
              )}
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/[0.03] p-4 text-xs leading-relaxed text-muted-foreground">
                <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p>
                  <strong className="text-foreground">Recent performance trend unavailable.</strong>{" "}
                  {detail.historical.recent_performance.reason}
                </p>
              </div>
            </section>

            <EvidenceSection post={post} detail={detail} />

            <section className="rounded-xl border border-border p-5" aria-labelledby="prediction-trace-heading">
              <h3 id="prediction-trace-heading" className="text-sm font-semibold">Prediction trace</h3>
              {detail.prediction ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                  <TierBadge tier={detail.prediction.tier} />
                  {detail.prediction.linked && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                      Verified media-ID link
                    </span>
                  )}
                  <span>{detail.prediction.confidence !== null ? `${Math.round(detail.prediction.confidence)}/100 raw score` : "Raw score unavailable"}</span>
                  {detail.prediction.actual_er !== null && <span>Observed ER: <strong>{detail.prediction.actual_er.toFixed(2)}%</strong></span>}
                  {detail.prediction.model_version && <span className="font-mono text-xs text-muted-foreground">Model {detail.prediction.model_version}</span>}
                  <p className="w-full text-xs leading-relaxed text-muted-foreground">
                    {detail.prediction.linked
                      ? "This outcome is attached through a user-confirmed immutable Instagram media ID."
                      : detail.prediction.linked_elsewhere
                        ? "This prediction already has an immutable link to another Instagram media ID, so it cannot be attached to this post."
                      : "Operator-assisted candidate using the exact caption returned by Meta. Caption equality is not proof; verify the post before creating an immutable media-ID link."}
                  </p>
                  {!detail.prediction.linked &&
                    !detail.prediction.linked_elsewhere &&
                    detail.prediction.prediction_id &&
                    detail.prediction_match_status === "unique_verified_caption" && (
                      <button
                        type="button"
                        onClick={confirmPublicationLink}
                        disabled={linkingPublication}
                        className="inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/92 disabled:opacity-50"
                      >
                        {linkingPublication ? "Saving verified link…" : "Confirm this publication"}
                      </button>
                    )}
                  {publicationLinkError && (
                    <p role="alert" className="w-full text-xs font-semibold text-destructive">
                      {publicationLinkError}
                    </p>
                  )}
                </div>
              ) : detail.prediction_match_status === "ambiguous_duplicate_caption" ? (
                <p className="mt-2 text-sm text-muted-foreground">More than one prediction has this exact Meta-verified caption, so no score is assigned to the post without an immutable media-ID link.</p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No prediction with the exact Meta-verified caption was found in this user&apos;s history.</p>
              )}
            </section>

            <DetailProvenance post={post} provenance={detail.provenance} />
          </>
        )}
      </div>
    </article>
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
      <h3 id="interaction-breakdown-heading" className="text-sm font-semibold">Known interaction mix</h3>
      <p className="mt-1 text-xs text-muted-foreground">Breakdown of the returned likes, comments, saves, and shares; it is not a unique-person count.</p>
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
        "the mature, model-eligible brand median (excluding this post)"
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
      <h3 id="observations-heading" className="text-sm font-semibold">Calculated observations</h3>
      <p className="mt-1 text-xs text-muted-foreground">Deterministic comparisons from verified values, not generative AI claims or causal recommendations.</p>
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
  const fetched = provenance?.fetched_at ? formatDateTime(provenance.fetched_at) : "time unavailable";
  const storedOnly = provenance?.stored_only === true || provenance?.live_source !== "instagram_graph_api";
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-start">
      <Database aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 leading-relaxed">
        <p><strong className="text-foreground">Data origin:</strong> {storedOnly
          ? `Instagram Graph was unavailable at ${fetched}; this list uses the latest verified records preserved by synchronization. Live previews and current per-post counters may be unavailable.`
          : `previews, captions, likes, comments, and the current account follower count were fetched live from Instagram Graph at ${fetched}.`}</p>
        <p className="mt-1">ER is synced likes plus comments divided by the follower snapshot preserved when that media was first verified. Tiers and brand-history comparisons require mature, model-supported posts{sync ? ` from sync records updated as recently as ${formatDateTime(sync)}` : " and remain unavailable until a sync completes"}. Recent performance is not inferred from unequal-age cumulative ER.</p>
        {provenance?.post_limit && <p className="mt-1">This view requests up to {provenance.post_limit} of the account&apos;s latest posts.</p>}
      </div>
      <span className="shrink-0 font-mono text-foreground">{followers === null ? "Followers unavailable" : `${followers.toLocaleString()} current followers`}</span>
    </div>
  );
}

function DetailProvenance({ post, provenance }: { post: IgPost; provenance: Provenance }) {
  return (
    <footer className="flex items-start gap-2 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        Detailed metrics fetched from Instagram Graph{provenance.fetched_at ? ` at ${formatDateTime(provenance.fetched_at)}` : ""}.
        {post.synced_at ? ` Historical ER snapshot captured ${formatDateTime(post.synced_at)}.` : " Historical ER snapshot is not yet available."}
        {provenance.prediction_source ? " Prediction trace is scoped to the authenticated user's history." : ""}
      </p>
    </footer>
  );
}

function SummaryMetric({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
    </div>
  );
}

function MetricCard({ label, value, suffix = "", decimals = 0, icon: Icon }: { label: string; value: number; suffix?: string; decimals?: number; icon: typeof Activity }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Icon aria-hidden="true" className="h-3.5 w-3.5" />{label}</div>
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

function EmptyState({ icon: Icon, title, description, action }: { icon: typeof Database; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-8 text-center sm:p-12">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-muted-foreground"><Icon aria-hidden="true" className="h-5 w-5" /></div>
      <h2 className="mt-4 font-display text-lg font-semibold">{title}</h2>
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

const primaryButtonClass = "inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none transition-transform duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/40 active:translate-y-px";
const secondaryButtonClass = "inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary/40 active:translate-y-px";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function averageKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => typeof value === "number");
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
}

function formatRounded(value: number | null): string {
  return value === null ? "Unavailable" : Math.round(value).toLocaleString();
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
