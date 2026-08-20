"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { VisibilityPicker } from "@/components/review/VisibilityPicker";
import { updatePrivacySettings } from "@/app/actions/privacy";
import type { PrivacySettings } from "@/types/domain";

export function PrivacySettingsForm({ initial }: { initial: PrivacySettings }) {
  const [settings, setSettings] = useState(initial);
  const [, startTransition] = useTransition();

  function update(patch: Partial<Omit<PrivacySettings, "userId">>) {
    setSettings((prev) => ({ ...prev, ...patch }));
    startTransition(() => {
      void updatePrivacySettings(patch);
    });
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">기본 방문 공개 범위</h2>
        <VisibilityPicker value={settings.defaultVisitVisibility} onChange={(v) => update({ defaultVisitVisibility: v })} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">기본 후기 공개 범위</h2>
        <VisibilityPicker value={settings.defaultReviewVisibility} onChange={(v) => update({ defaultReviewVisibility: v })} />
      </section>

      <section className="space-y-3">
        <ToggleRow
          label="방문 기록 공개"
          description="다른 사람이 내 방문 이력을 볼 수 있어요."
          checked={settings.showVisitHistory}
          onChange={(v) => update({ showVisitHistory: v })}
        />
        <ToggleRow
          label="친구의 친구에게 공개"
          description="2촌 관계(친구의 친구)까지 내 활동을 볼 수 있게 해요."
          checked={settings.showToFriendsOfFriends}
          onChange={(v) => update({ showToFriendsOfFriends: v })}
        />
        <ToggleRow
          label="추천 개선에 활용"
          description="내 활동 데이터를 추천 정확도를 높이는 데 활용해요."
          checked={settings.allowRecommendationUsage}
          onChange={(v) => update({ allowRecommendationUsage: v })}
        />
      </section>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-border p-4">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-foreground-muted">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} ariaLabel={label} />
    </div>
  );
}
