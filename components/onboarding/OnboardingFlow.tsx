"use client";

import { useState, useTransition } from "react";
import { UserPlus, Check, Sparkles } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { completeOnboarding } from "@/app/actions/auth";
import { addFriend } from "@/app/actions/social";
import { CATEGORY_LABELS } from "@/lib/i18n/labels";
import { APP_NAME } from "@/config/constants";
import { cn } from "@/lib/utils/cn";
import type { PlaceCategory } from "@/types/domain";
import type { UserProfile } from "@/types/domain";

const DISCOVERY_STYLES = [
  { value: "trust", label: "친구가 간 곳 위주로", desc: "신뢰할 수 있는 사람들의 선택을 먼저 볼래요" },
  { value: "balanced", label: "적당히 섞어서", desc: "친구 취향과 새로운 곳을 골고루 볼래요" },
  { value: "explore", label: "새로운 곳 위주로", desc: "아직 안 가본 곳을 더 많이 발견하고 싶어요" },
] as const;

const STEPS = ["intro", "interests", "style", "friends"] as const;

/**
 * Interests/discovery-style answers are collected for a warmer first-run
 * feel but the MVP recommendation model (config/ranking.ts) doesn't yet take
 * an explicit onboarding taste vector as input — taste is inferred instead
 * from real visits/reviews (lib/recommendations/tasteProfile.ts). Documented
 * assumption: these two steps are UX warm-up, not persisted server-side.
 */
export function OnboardingFlow({ suggestions }: { suggestions: UserProfile[] }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [interests, setInterests] = useState<PlaceCategory[]>([]);
  const [style, setStyle] = useState<(typeof DISCOVERY_STYLES)[number]["value"] | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const step = STEPS[stepIndex];

  function next() {
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }

  function toggleInterest(cat: PlaceCategory) {
    setInterests((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  }

  function handleAddFriend(id: string) {
    setAddedIds((prev) => new Set(prev).add(id));
    startTransition(async () => {
      try {
        await addFriend(id);
      } catch {
        setAddedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    });
  }

  return (
    <div className="flex min-h-[calc(100dvh-5rem)] flex-col">
      <div className="mb-8 flex gap-1.5">
        {STEPS.map((s, i) => (
          <div key={s} className={cn("h-1 flex-1 rounded-full", i <= stepIndex ? "bg-accent" : "bg-surface-muted")} />
        ))}
      </div>

      <div className="flex-1">
        {step === "intro" ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft">
              <Sparkles className="h-7 w-7 text-accent" />
            </div>
            <h1 className="text-xl font-bold text-foreground">{APP_NAME}에 오신 걸 환영해요</h1>
            <p className="text-sm leading-relaxed text-foreground-muted">
              광고나 낯선 사람의 별점 대신, 실제로 아는 사람들이 어디에 가고 무엇을 좋아했는지부터 보여드릴게요.
            </p>
          </div>
        ) : null}

        {step === "interests" ? (
          <div>
            <h2 className="text-lg font-bold text-foreground">어떤 곳에 관심이 많으세요?</h2>
            <p className="mt-1 text-sm text-foreground-muted">관심사에 맞는 친구 활동을 먼저 보여드려요.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {(Object.keys(CATEGORY_LABELS) as PlaceCategory[]).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleInterest(cat)}
                  className={cn(
                    "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                    interests.includes(cat)
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-border bg-surface text-foreground-muted hover:border-accent/40"
                  )}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === "style" ? (
          <div>
            <h2 className="text-lg font-bold text-foreground">어떻게 발견하고 싶으세요?</h2>
            <p className="mt-1 text-sm text-foreground-muted">언제든 홈 화면에서 필터로 바꿀 수 있어요.</p>
            <div className="mt-6 space-y-2.5">
              {DISCOVERY_STYLES.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStyle(opt.value)}
                  className={cn(
                    "w-full rounded-2xl border px-4 py-3.5 text-left transition-colors",
                    style === opt.value ? "border-accent bg-accent-soft" : "border-border bg-surface hover:border-accent/40"
                  )}
                >
                  <p className="text-sm font-semibold text-foreground">{opt.label}</p>
                  <p className="mt-0.5 text-xs text-foreground-muted">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === "friends" ? (
          <div>
            <h2 className="text-lg font-bold text-foreground">친구를 찾아보세요</h2>
            <p className="mt-1 text-sm text-foreground-muted">친구를 추가하면 그들의 방문과 후기가 홈에 보여요.</p>
            <div className="mt-6 space-y-2">
              {suggestions.length === 0 ? (
                <p className="text-sm text-foreground-muted">추천할 친구가 없어요. 나중에 검색에서 찾아보세요.</p>
              ) : (
                suggestions.map((u) => {
                  const added = addedIds.has(u.id);
                  return (
                    <div key={u.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border p-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar src={u.avatarUrl} alt={u.displayName} size={40} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{u.displayName}</p>
                          <p className="truncate text-xs text-foreground-muted">@{u.username}</p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={added ? "secondary" : "outline"}
                        disabled={added || isPending}
                        onClick={() => handleAddFriend(u.id)}
                      >
                        {added ? <Check className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                        {added ? "추가됨" : "추가"}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-8">
        {step === "friends" ? (
          <form action={completeOnboarding}>
            <Button type="submit" size="lg" className="w-full">
              시작하기
            </Button>
          </form>
        ) : (
          <Button type="button" size="lg" className="w-full" onClick={next}>
            다음
          </Button>
        )}
      </div>
    </div>
  );
}
