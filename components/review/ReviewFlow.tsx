"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RatingStars } from "@/components/review/RatingStars";
import { VisibilityPicker } from "@/components/review/VisibilityPicker";
import { Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createVisit } from "@/app/actions/visits";
import { createReview } from "@/app/actions/reviews";
import { REVIEW_TEXT_MAX_LENGTH } from "@/config/constants";
import { REVISIT_LABELS, TAG_LABELS } from "@/lib/i18n/labels";
import { cn } from "@/lib/utils/cn";
import type { Place, ReviewTag, RevisitIntention, Visibility } from "@/types/domain";

const STEPS = ["rating", "revisit", "tags", "text", "visibility"] as const;
const REVISIT_OPTIONS: RevisitIntention[] = ["definitely", "maybe", "probably_not", "no"];
const TAG_OPTIONS = Object.keys(TAG_LABELS) as ReviewTag[];

export function ReviewFlow({ place }: { place: Place }) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [rating, setRating] = useState(0);
  const [revisitIntention, setRevisitIntention] = useState<RevisitIntention | null>(null);
  const [tags, setTags] = useState<ReviewTag[]>([]);
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("friends");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const step = STEPS[stepIndex];
  const canProceed = step === "rating" ? rating > 0 : step === "revisit" ? revisitIntention !== null : true;

  function toggleTag(tag: ReviewTag) {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : prev.length >= 6 ? prev : [...prev, tag]));
  }

  function next() {
    if (!canProceed) return;
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }
  function back() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  function handleSubmit() {
    if (!revisitIntention) return;
    setError(null);
    startTransition(async () => {
      try {
        const visit = await createVisit({ placeId: place.id, visitedAt: new Date().toISOString(), visibility });
        await createReview({
          placeId: place.id,
          visitId: visit.id,
          rating,
          revisitIntention,
          tags,
          reviewText: text.trim() || null,
          visibility,
        });
        router.push(`/place/${place.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "후기를 저장하지 못했어요.");
      }
    });
  }

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
      <div className="mb-8 flex gap-1.5">
        {STEPS.map((s, i) => (
          <div key={s} className={cn("h-1 flex-1 rounded-full", i <= stepIndex ? "bg-accent" : "bg-surface-muted")} />
        ))}
      </div>

      <div className="flex-1">
        {step === "rating" ? (
          <div className="flex flex-col items-center gap-4 pt-6 text-center">
            <p className="text-sm text-foreground-muted">{place.name}, 어떠셨어요?</p>
            <RatingStars value={rating} onChange={setRating} size={44} />
            {rating > 0 ? <p className="text-lg font-semibold text-foreground">{rating.toFixed(1)}점</p> : null}
          </div>
        ) : null}

        {step === "revisit" ? (
          <div>
            <h2 className="text-lg font-bold text-foreground">다시 갈 의향이 있으세요?</h2>
            <div className="mt-6 space-y-2.5">
              {REVISIT_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setRevisitIntention(opt)}
                  className={cn(
                    "w-full rounded-2xl border px-4 py-3.5 text-left text-sm font-medium transition-colors",
                    revisitIntention === opt ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-foreground hover:border-accent/40"
                  )}
                >
                  {REVISIT_LABELS[opt]}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === "tags" ? (
          <div>
            <h2 className="text-lg font-bold text-foreground">어떤 상황이었나요?</h2>
            <p className="mt-1 text-sm text-foreground-muted">최대 6개까지 선택할 수 있어요. (선택사항)</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {TAG_OPTIONS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                    tags.includes(tag)
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-border bg-surface text-foreground-muted hover:border-accent/40"
                  )}
                >
                  {TAG_LABELS[tag]}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === "text" ? (
          <div>
            <h2 className="text-lg font-bold text-foreground">한 줄로 남겨보세요</h2>
            <p className="mt-1 text-sm text-foreground-muted">솔직한 한마디면 충분해요. (선택사항)</p>
            <div className="mt-6 space-y-1.5">
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, REVIEW_TEXT_MAX_LENGTH))}
                rows={4}
                placeholder="예: 분위기는 좋은데 웨이팅이 긴 편이에요."
              />
              <p className="text-right text-xs text-foreground-muted">
                {text.length}/{REVIEW_TEXT_MAX_LENGTH}
              </p>
            </div>
          </div>
        ) : null}

        {step === "visibility" ? (
          <div>
            <h2 className="text-lg font-bold text-foreground">누구에게 공유할까요?</h2>
            <p className="mt-1 text-sm text-foreground-muted">언제든 다시 바꿀 수 있어요.</p>
            <div className="mt-6">
              <VisibilityPicker value={visibility} onChange={setVisibility} />
            </div>
            {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="mt-8 flex gap-2">
        {stepIndex > 0 ? (
          <Button type="button" variant="secondary" onClick={back} disabled={isPending}>
            이전
          </Button>
        ) : null}
        {step === "visibility" ? (
          <Button type="button" className="flex-1" onClick={handleSubmit} disabled={isPending}>
            {isPending ? "저장하는 중..." : "후기 남기기"}
          </Button>
        ) : (
          <Button type="button" className="flex-1" onClick={next} disabled={!canProceed}>
            다음
          </Button>
        )}
      </div>
    </div>
  );
}
