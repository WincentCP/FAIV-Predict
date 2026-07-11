"use client";

/* Instagram CDN hosts and URLs are short-lived and cannot be safely placed in
   Next Image's static remote allowlist. Native img is intentional here. */
/* eslint-disable @next/next/no-img-element */

import { fetchWithRetry } from "@/lib/fetch-retry";
import { useState, useEffect, useCallback, useMemo } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { TierBadge } from "@/components/TierBadge";
import { type Tier, type Brand } from "@/lib/types";
import {
  Heart, MessageCircle, ExternalLink, AlertTriangle, Film, LayoutGrid,
  Image as ImageIcon, Eye, Bookmark, Share2, Users, UserPlus,
  MousePointer2, TrendingUp, TrendingDown, Activity, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type IgPost = {
  id: string;
  caption: string;
  media_type: "IMAGE" | "CAROUSEL_ALBUM" | "VIDEO";
  media_url: string | null;
  thumbnail_url: string | null;
  permalink: string | null;
  timestamp: string;
  likes: number | null;
  comments: number | null;
  er: number | null;
  tier: Tier | null;
};

type PostDetail = {
  metrics: Record<string, number>;
  unavailable_metrics?: string[];
  not_attributable_metrics?: string[];
  historical: { brand_median_er: number | null; recent_median_er: number | null };
  prediction: {
    tier: Tier;
    actual_tier: Tier | null;
    confidence: number | null;
    model_version: string | null;
    match_method: "exact_caption";
  } | null;
};

const MEDIA_BADGE: Record<IgPost["media_type"], { label: string; icon: typeof Film }> = {
  VIDEO: { label: "Reels", icon: Film },
  CAROUSEL_ALBUM: { label: "Carousel", icon: LayoutGrid },
  IMAGE: { label: "Image", icon: ImageIcon },
};

const METRICS = [
  { key: "reach", label: "Reach", icon: Users },
  { key: "impressions", label: "Impressions", icon: Eye },
  { key: "views", label: "Views", icon: Eye },
  { key: "saved", label: "Saves", icon: Bookmark },
  { key: "shares", label: "Shares", icon: Share2 },
  { key: "accounts_engaged", label: "Accounts Engaged", icon: Activity },
  { key: "profile_visits", label: "Profile Visits", icon: MousePointer2 },
  { key: "follows", label: "Follows", icon: UserPlus },
  { key: "total_interactions", label: "Total Interactions", icon: Activity },
] as const;

export default function InsightsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [posts, setPosts] = useState<IgPost[] | null>(null);
  const [followers, setFollowers] = useState<number | null>(null);
  const [selected, setSelected] = useState<IgPost | null>(null);
  const [detail, setDetail] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchWithRetry("/api/brands");
        const data = await res.json().catch(() => null);
        if (!res.ok || !Array.isArray(data)) throw new Error();
        setBrands(data);
        setBrandId(data[0]?.id || null);
      } catch {
        setError("Brand accounts could not be loaded.");
      }
    })();
  }, []);

  const loadPosts = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setPosts(null);
    setSelected(null);
    setDetail(null);
    try {
      const res = await fetch(`/api/instagram-posts?brand_id=${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data?.posts)) {
        throw new Error(data?.message || "Published post data is unavailable.");
      }
      setPosts(data.posts);
      setFollowers(typeof data.followers === "number" ? data.followers : null);
      setSelected(data.posts[0] || null);
    } catch (err: any) {
      setError(err.message || "Published post data is unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (brandId) loadPosts(brandId);
  }, [brandId, loadPosts]);

  useEffect(() => {
    if (!selected || !brandId) {
      setDetail(null);
      return;
    }
    (async () => {
      setDetailLoading(true);
      setDetailError(null);
      setDetail(null);
      try {
        const res = await fetch("/api/instagram-post-insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brand_id: brandId, media_id: selected.id, caption: selected.caption }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.message || "Detailed metrics are unavailable.");
        setDetail(data);
      } catch (err: any) {
        setDetailError(err.message || "Detailed metrics are unavailable.");
      } finally {
        setDetailLoading(false);
      }
    })();
  }, [selected, brandId]);

  const summary = useMemo(() => {
    if (!posts?.length) return null;
    const ers = posts
      .map((post) => post.er)
      .filter((value): value is number => typeof value === "number")
      .sort((a, b) => a - b);
    const medianEr = ers.length > 0 ? ers[Math.floor(ers.length / 2)] : null;
    return {
      count: posts.length,
      medianEr,
      avgLikes: averageKnown(posts.map((post) => post.likes)),
      avgComments: averageKnown(posts.map((post) => post.comments)),
    };
  }, [posts]);

  return (
    <div className="mx-auto min-h-screen max-w-[1500px] space-y-6 px-4 py-6 md:px-8 md:py-8">
      <SectionHeader
        eyebrow="Insights"
        title="Published Content Analytics"
        description="Analyze verified Instagram performance, compare posts with brand history, and inspect prediction outcomes without fabricated metrics."
        actions={brands.length > 0 ? (
          <select value={brandId || ""} onChange={(event) => setBrandId(event.target.value)} className="h-10 rounded-xl border border-border bg-surface px-3 text-xs font-semibold outline-none focus:border-primary">
            {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
          </select>
        ) : undefined}
      />

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryMetric label="Posts loaded" value={summary.count.toLocaleString()} />
          <SummaryMetric label="Loaded-post median ER" value={summary.medianEr === null ? "—" : `${summary.medianEr.toFixed(2)}%`} />
          <SummaryMetric label="Loaded-post avg. likes" value={summary.avgLikes === null ? "—" : Math.round(summary.avgLikes).toLocaleString()} />
          <SummaryMetric label="Loaded-post avg. comments" value={summary.avgComments === null ? "—" : Math.round(summary.avgComments).toLocaleString()} />
        </div>
      )}

      {followers !== null && followers > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Engagement rate uses likes and comments divided by {followers.toLocaleString()} current followers.
          Additional metrics appear only when Meta returns them for the selected media type.
        </p>
      )}
      {followers === 0 && (
        <p className="text-[11px] text-muted-foreground">
          Instagram returned a zero follower denominator, so engagement-rate metrics are shown as unavailable rather than 0%.
        </p>
      )}

      {error && <ErrorState title="Insights unavailable" message={error} />}

      {loading && (
        <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-border bg-surface">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {posts?.length === 0 && !loading && (
        <div className="rounded-2xl border border-border bg-surface p-10 text-center text-sm text-muted-foreground">
          No published Instagram posts were returned for this connected account.
        </div>
      )}

      {posts && posts.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="max-h-[760px] space-y-2 overflow-y-auto rounded-2xl border border-border bg-surface p-3">
            {posts.map((post) => (
              <PostListItem key={post.id} post={post} active={selected?.id === post.id} onSelect={() => setSelected(post)} />
            ))}
          </aside>

          {selected && (
            <PostAnalysis
              post={selected}
              detail={detail}
              loading={detailLoading}
              error={detailError}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PostListItem({ post, active, onSelect }: { post: IgPost; active: boolean; onSelect: () => void }) {
  const media = MEDIA_BADGE[post.media_type] || MEDIA_BADGE.IMAGE;
  const MediaIcon = media.icon;
  const preview = post.media_type === "VIDEO" ? post.thumbnail_url || post.media_url : post.media_url;
  return (
    <button type="button" onClick={onSelect} className={cn("flex w-full gap-3 rounded-xl border p-2.5 text-left transition", active ? "border-primary bg-primary/[0.04]" : "border-transparent hover:border-border hover:bg-surface-2/50")}>
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-2">
        {preview ? <img src={preview} alt="" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <MediaIcon className="m-5 h-6 w-6 text-muted-foreground" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold text-muted-foreground">{media.label}</span>
          {post.tier && <TierBadge tier={post.tier} className="scale-90 origin-right" />}
        </div>
        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-foreground">{post.caption || "Post without caption"}</p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">ER {post.er === null ? "—" : `${post.er.toFixed(2)}%`}</p>
      </div>
    </button>
  );
}

function PostAnalysis({ post, detail, loading, error }: { post: IgPost; detail: PostDetail | null; loading: boolean; error: string | null }) {
  const media = MEDIA_BADGE[post.media_type] || MEDIA_BADGE.IMAGE;
  const MediaIcon = media.icon;
  const preview = post.media_type === "VIDEO" ? post.thumbnail_url || post.media_url : post.media_url;
  const brandMedian = detail?.historical?.brand_median_er;
  const recentMedian = detail?.historical?.recent_median_er;
  const availableMetrics = METRICS.filter((metric) => detail?.metrics?.[metric.key] !== undefined);

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="grid border-b border-border md:grid-cols-[minmax(280px,0.8fr)_1.2fr]">
        <div className="relative min-h-[320px] bg-surface-2">
          {preview ? <img src={preview} alt={post.caption?.slice(0, 80) || "Instagram post"} className="absolute inset-0 h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <MediaIcon className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 text-muted-foreground" />}
        </div>
        <div className="space-y-5 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[10px] font-bold">{media.label}</span>
            {post.tier && <TierBadge tier={post.tier} />}
            {post.permalink && <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-primary">Instagram <ExternalLink className="h-3 w-3" /></a>}
          </div>
          <div>
            <h2 className="font-display text-lg font-bold">Post performance</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">{new Date(post.timestamp).toLocaleString()}</p>
          </div>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{post.caption || "No caption supplied."}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {post.likes !== null ? <MetricCard label="Likes" value={post.likes} icon={Heart} /> : <UnavailableMetric label="Likes" message="Meta did not return this field." />}
            {post.comments !== null ? <MetricCard label="Comments" value={post.comments} icon={MessageCircle} /> : <UnavailableMetric label="Comments" message="Meta did not return this field." />}
            {post.er !== null ? (
              <MetricCard label="Engagement Rate" value={post.er} suffix="%" decimals={2} icon={Activity} />
            ) : (
              <UnavailableMetric label="Engagement Rate" message="Follower count is zero or unavailable." />
            )}
          </div>
        </div>
      </div>

      <div className="space-y-6 p-6">
        {loading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading supported Meta metrics…</div>}
        {error && <ErrorState title="Detailed metrics unavailable" message={error} compact />}

        {detail && (
          <>
            {availableMetrics.length > 0 ? (
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Verified Meta metrics</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {availableMetrics.map((metric) => <MetricCard key={metric.key} label={metric.label} value={detail.metrics[metric.key]} icon={metric.icon} />)}
                </div>
              </section>
            ) : (
              <p className="rounded-xl border border-border bg-surface-2/40 p-4 text-xs text-muted-foreground">Meta returned no additional lifetime metrics for this media type. Basic likes, comments, and engagement rate remain available.</p>
            )}

            {((detail.unavailable_metrics?.length ?? 0) > 0 || (detail.not_attributable_metrics?.length ?? 0) > 0) && (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Metrics not shown are unavailable for this media/API version. Profile visits and follows are account-level metrics and are not attributed to a single organic post.
              </p>
            )}

            {post.er !== null ? (
              <section className="grid gap-4 md:grid-cols-2">
                <ComparisonCard label="Brand history" current={post.er} baseline={brandMedian} />
                <ComparisonCard label="Recent 10-post trend" current={post.er} baseline={recentMedian} />
              </section>
            ) : (
              <p className="rounded-xl border border-border p-4 text-xs text-muted-foreground">Historical ER comparisons are unavailable because the current follower denominator is unavailable.</p>
            )}

            <section className="rounded-xl border border-border bg-surface-2/30 p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Evidence-based observations</h3>
              <div className="mt-3 space-y-2 text-xs text-foreground">
                {post.er !== null && <Observation current={post.er} baseline={brandMedian} label="the brand median" />}
                {post.er !== null && <Observation current={post.er} baseline={recentMedian} label="the recent 10-post median" />}
                {detail.metrics.saved !== undefined && detail.metrics.reach > 0 && (
                  <p>Saves equal {((detail.metrics.saved / detail.metrics.reach) * 100).toFixed(2)}% of reached accounts.</p>
                )}
                {detail.metrics.shares !== undefined && detail.metrics.reach > 0 && (
                  <p>Shares equal {((detail.metrics.shares / detail.metrics.reach) * 100).toFixed(2)}% of reached accounts.</p>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-border p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Prediction trace</h3>
              {detail.prediction ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  <TierBadge tier={detail.prediction.tier} />
                  <span>{detail.prediction.confidence !== null ? `${Math.round(detail.prediction.confidence)}% confidence` : "Confidence unavailable"}</span>
                  {detail.prediction.actual_tier && <span>Actual: <strong>{detail.prediction.actual_tier}</strong></span>}
                  {detail.prediction.model_version && <span className="font-mono text-muted-foreground">v{detail.prediction.model_version}</span>}
                  <span className="w-full text-[10px] text-muted-foreground">Matched to the newest prediction with the exact normalized caption; media-ID linkage was not inferred.</span>
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">No prediction with an exactly matching normalized caption was found. No association was guessed.</p>
              )}
            </section>
          </>
        )}
      </div>
    </article>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-surface p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-2 font-display text-xl font-black">{value}</p></div>;
}

function MetricCard({ label, value, suffix = "", decimals = 0, icon: Icon }: { label: string; value: number; suffix?: string; decimals?: number; icon: typeof Activity }) {
  return <div className="rounded-xl border border-border bg-surface p-3"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div><p className="mt-2 font-mono text-lg font-black tabular-nums">{value.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}{suffix}</p></div>;
}

function UnavailableMetric({ label, message }: { label: string; message: string }) {
  return <div className="rounded-xl border border-border bg-surface p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-2 text-[10px] text-muted-foreground">{message}</p></div>;
}

function ComparisonCard({ label, current, baseline }: { label: string; current: number; baseline: number | null | undefined }) {
  if (baseline === null || baseline === undefined) return <div className="rounded-xl border border-border p-4 text-xs text-muted-foreground">{label} comparison is unavailable.</div>;
  const delta = current - baseline;
  const positive = delta >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return <div className="rounded-xl border border-border p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p><div className="mt-2 flex items-center gap-2"><Icon className={cn("h-4 w-4", positive ? "text-emerald-500" : "text-rose-500")} /><span className="font-mono text-lg font-black">{positive ? "+" : ""}{delta.toFixed(2)}pp</span><span className="text-[10px] text-muted-foreground">vs {baseline.toFixed(2)}%</span></div></div>;
}

function Observation({ current, baseline, label }: { current: number; baseline: number | null | undefined; label: string }) {
  if (baseline === null || baseline === undefined) return null;
  const delta = current - baseline;
  return <p>Engagement rate is <strong>{Math.abs(delta).toFixed(2)} percentage points {delta >= 0 ? "above" : "below"}</strong> {label}.</p>;
}

function ErrorState({ title, message, compact = false }: { title: string; message: string; compact?: boolean }) {
  return <div className={cn("rounded-xl border border-warning/30 bg-warning/[0.03] p-4", !compact && "flex items-start gap-3")}><AlertTriangle className="h-4 w-4 shrink-0 text-warning" /><div className="text-xs text-muted-foreground"><span className="block font-bold text-foreground">{title}</span>{message}</div></div>;
}

function averageKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => typeof value === "number");
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
}
