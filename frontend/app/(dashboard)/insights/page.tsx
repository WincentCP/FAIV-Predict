"use client";

import { fetchWithRetry } from "@/lib/fetch-retry";
import { useState, useEffect, useCallback } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { TierBadge } from "@/components/TierBadge";
import { type Tier, type Brand } from "@/lib/types";
import { Heart, MessageCircle, ExternalLink, AlertTriangle, Film, LayoutGrid, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type IgPost = {
  caption: string;
  media_type: "IMAGE" | "CAROUSEL_ALBUM" | "VIDEO";
  media_url: string | null;
  thumbnail_url: string | null;
  permalink: string | null;
  timestamp: string;
  likes: number;
  comments: number;
  er: number;
  tier: Tier | null;
};

const MEDIA_BADGE: Record<IgPost["media_type"], { label: string; icon: typeof Film }> = {
  VIDEO: { label: "Reels", icon: Film },
  CAROUSEL_ALBUM: { label: "Carousel", icon: LayoutGrid },
  IMAGE: { label: "Image", icon: ImageIcon },
};

export default function InsightsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandName, setBrandName] = useState<string | null>(null);
  const [posts, setPosts] = useState<IgPost[] | null>(null);
  const [followers, setFollowers] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchWithRetry("/api/brands");
        if (res.ok) {
          const data = await res.json();
          setBrands(data || []);
          if (data?.length > 0) setBrandName(data[0].name);
        } else {
          setError("Brand accounts could not be loaded.");
        }
      } catch {
        setError("Brand accounts could not be loaded.");
      }
    })();
  }, []);

  const loadPosts = useCallback(async (name: string) => {
    setLoading(true);
    setError(null);
    setPosts(null);
    try {
      const res = await fetch(`/api/instagram-posts?brand=${encodeURIComponent(name)}`);
      const data = await res.json().catch(() => null);
      if (res.ok && Array.isArray(data?.posts)) {
        setPosts(data.posts);
        setFollowers(typeof data.followers === "number" ? data.followers : null);
      } else {
        setError(data?.message || "Post insights are unavailable for this brand.");
      }
    } catch {
      setError("Post insights are unavailable right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (brandName) loadPosts(brandName);
  }, [brandName, loadPosts]);

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-[1400px] mx-auto space-y-6 min-h-screen">
      <SectionHeader
        eyebrow="Post Insights"
        title="Published Post Performance"
        description="Live engagement for every published post, graded against this brand's own history — the same tiers the prediction model is trained on."
        actions={
          brands.length > 0 ? (
            <select
              value={brandName ?? ""}
              onChange={(e) => setBrandName(e.target.value)}
              className="h-10 rounded-xl border border-border bg-surface px-3 text-xs font-semibold outline-none focus:border-primary"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />

      {followers !== null && (
        <p className="text-xs text-muted-foreground">
          Engagement rate = (likes + comments) ÷ {followers.toLocaleString()} current followers.
          Data comes live from the Instagram API on every visit.
        </p>
      )}

      {error && (
        <div className="rounded-xl border border-warning/30 bg-warning/[0.03] p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground">
            <span className="font-bold text-foreground block mb-0.5">Insights unavailable</span>
            {error} Post insights need a linked Instagram account (see Model Health → Data
            Connections) and the ML service running.
          </div>
        </div>
      )}

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-surface overflow-hidden">
              <div className="aspect-square animate-pulse bg-muted/40" />
              <div className="p-4 space-y-2">
                <div className="h-3 w-2/3 animate-pulse rounded bg-muted/40" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted/40" />
              </div>
            </div>
          ))}
        </div>
      )}

      {posts && posts.length === 0 && !loading && (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-xs text-muted-foreground">
          No published posts found for this account yet.
        </div>
      )}

      {posts && posts.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {posts.map((p, i) => {
            const preview = p.media_type === "VIDEO" ? p.thumbnail_url || p.media_url : p.media_url;
            const media = MEDIA_BADGE[p.media_type] ?? MEDIA_BADGE.IMAGE;
            const MediaIcon = media.icon;
            return (
              <article
                key={p.permalink ?? i}
                className="group rounded-2xl border border-border bg-surface overflow-hidden transition-all hover:border-border-strong hover:shadow-[var(--shadow-soft)]"
              >
                <div className="relative aspect-square bg-surface-2">
                  {/* Icon fallback sits behind the image: if the short-lived
                      Instagram CDN URL expires or fails, the broken <img> is
                      hidden and this shows instead. */}
                  <div className="absolute inset-0 grid place-items-center text-muted-foreground/50">
                    <MediaIcon className="h-8 w-8" />
                  </div>
                  {preview && (
                    // Instagram CDN URLs are short-lived and cross-origin;
                    // plain <img> avoids next/image domain allow-listing.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={preview}
                      alt={p.caption ? p.caption.slice(0, 80) : "Instagram post"}
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                      className="relative h-full w-full object-cover"
                    />
                  )}
                  <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-background/85 backdrop-blur px-2 py-0.5 text-[9px] font-bold text-foreground">
                    <MediaIcon className="h-2.5 w-2.5" />
                    {media.label}
                  </span>
                  {p.tier && (
                    <span className="absolute right-2.5 top-2.5">
                      <TierBadge tier={p.tier} />
                    </span>
                  )}
                </div>
                <div className="p-4 space-y-2.5">
                  <div className="flex items-center gap-3 text-xs font-semibold text-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Heart className="h-3.5 w-3.5 text-rose-500" />
                      {p.likes.toLocaleString()}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
                      {p.comments.toLocaleString()}
                    </span>
                    <span className="ml-auto font-mono tabular-nums text-[11px]">
                      ER {p.er.toFixed(2)}%
                    </span>
                  </div>
                  {p.caption && (
                    <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
                      {p.caption}
                    </p>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] text-muted-foreground/80">
                      {new Date(p.timestamp).toLocaleDateString()}
                    </span>
                    {p.permalink && (
                      <a
                        href={p.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          "inline-flex items-center gap-1 text-[10px] font-bold text-primary",
                          "opacity-70 transition-opacity hover:opacity-100"
                        )}
                      >
                        View on Instagram
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
