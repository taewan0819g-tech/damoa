"use client";

import { useState, useTransition } from "react";
import { Star, ThumbsUp, Flag, EyeOff } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { toggleReviewReaction, reportReview } from "@/app/actions/reviews";
import { TAG_LABELS, REVISIT_LABELS } from "@/lib/i18n/labels";
import { cn } from "@/lib/utils/cn";
import type { SafeReview } from "@/types/domain";

/**
 * Renders a review using only the SafeReview shape the server hands back —
 * for anonymous reviews there is no author id/avatar to render in the first
 * place, so this component can't accidentally leak identity (spec #30/#84).
 */
export function ReviewCard({ review }: { review: SafeReview }) {
  const [helpful, setHelpful] = useState(review.viewerFoundHelpful);
  const [count, setCount] = useState(review.helpfulCount);
  const [reported, setReported] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleHelpful() {
    const next = !helpful;
    setHelpful(next);
    setCount((c) => (next ? c + 1 : Math.max(0, c - 1)));
    startTransition(async () => {
      try {
        await toggleReviewReaction(review.id);
      } catch {
        setHelpful(!next);
        setCount((c) => (next ? Math.max(0, c - 1) : c + 1));
      }
    });
  }

  function handleReport() {
    if (reported) return;
    setReported(true);
    startTransition(async () => {
      try {
        await reportReview({ reviewId: review.id, reason: "other", details: null });
      } catch {
        setReported(false);
      }
    });
  }

  return (
    <article className="space-y-2.5 border-b border-border py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {review.isAnonymous ? (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-muted text-foreground-muted">
              <EyeOff className="h-4 w-4" />
            </div>
          ) : (
            <Avatar src={review.author?.avatarUrl} alt={review.author?.displayName ?? review.displayIdentity} size={36} />
          )}
          <div>
            <p className="text-sm font-medium text-foreground">{review.displayIdentity}</p>
            <p className="text-xs text-foreground-muted">{review.approximateTime}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-accent">
          <Star className="h-4 w-4 fill-accent" />
          <span className="text-sm font-semibold">{review.rating.toFixed(1)}</span>
        </div>
      </div>

      {review.text ? <p className="text-sm leading-relaxed text-foreground">{review.text}</p> : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{REVISIT_LABELS[review.revisitIntention]}</Badge>
        {review.tags.map((tag) => (
          <Badge key={tag}>{TAG_LABELS[tag]}</Badge>
        ))}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={handleHelpful}
          disabled={isPending}
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium transition-colors",
            helpful ? "text-accent" : "text-foreground-muted hover:text-foreground"
          )}
        >
          <ThumbsUp className={cn("h-3.5 w-3.5", helpful && "fill-accent")} />
          도움돼요{count > 0 ? ` ${count}` : ""}
        </button>
        <button
          type="button"
          onClick={handleReport}
          disabled={isPending || reported}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground-muted hover:text-danger"
        >
          <Flag className="h-3.5 w-3.5" />
          {reported ? "신고됨" : "신고"}
        </button>
      </div>
    </article>
  );
}
