"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Chip } from "@/components/ui/chip";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { OptionList } from "@/components/onboarding/OptionList";
import { useProfileStore } from "@/stores/profileStore";
import { calculateProfileCompletion } from "@/domain/profile/completion";
import { calculateAge } from "@/domain/profile/age";
import { CURRENT_STATUS_OPTIONS, CURRENT_STATUS_TO_PROFILE, deriveCurrentStatus } from "@/domain/profile/currentStatus";
import { PROVINCES } from "@/lib/constants/regions";
import { INTEREST_CATEGORIES } from "@/lib/constants/interests";
import { INCOME_BAND_OPTIONS } from "@/lib/constants/incomeBands";
import { CATEGORY_LABELS, HOUSING_TYPE_LABELS, MARITAL_STATUS_LABELS } from "@/lib/labels";
import { TRI_STATE_OPTIONS, HOMEOWNER_TRI_STATE_OPTIONS, booleanFromTriState, triStateFromBoolean } from "@/lib/constants/triState";
import { todayLocalDateString } from "@/lib/dates/localDate";
import type { HousingType, IncomeBand, MaritalStatus } from "@/types/profile";

const HOUSING_OPTIONS: { value: HousingType; label: string }[] = (
  ["own", "jeonse", "monthly_rent", "living_with_family", "other"] as HousingType[]
).map((value) => ({ value, label: HOUSING_TYPE_LABELS[value] }));

const MARITAL_OPTIONS: { value: MaritalStatus; label: string }[] = (
  ["single", "married", "divorced", "widowed"] as MaritalStatus[]
).map((value) => ({ value, label: MARITAL_STATUS_LABELS[value] }));

function toManwon(amount?: number): string {
  return amount !== undefined ? String(amount / 10000) : "";
}

function fromManwon(value: string): number | undefined {
  return value === "" ? undefined : Number(value) * 10000;
}

export default function ProfilePage() {
  const router = useRouter();
  const profile = useProfileStore((s) => s.profile);
  const updateProfile = useProfileStore((s) => s.updateProfile);
  const resetProfile = useProfileStore((s) => s.resetProfile);

  const completion = calculateProfileCompletion(profile);
  const age = calculateAge(profile.birthDate);
  const currentStatus = deriveCurrentStatus(profile.employmentStatus, profile.educationStatus);
  const interests = profile.interests ?? [];

  const handleReset = () => {
    if (typeof window !== "undefined" && !window.confirm("입력한 정보를 모두 초기화하고 온보딩을 다시 시작할까요?")) {
      return;
    }
    resetProfile();
    router.push("/onboarding");
  };

  return (
    <div className="flex flex-col gap-5 pb-4">
      <div>
        <h1 className="text-lg font-bold text-foreground">내 정보</h1>
        <p className="mt-0.5 text-sm text-foreground-muted">정확히 입력할수록 더 정확한 혜택을 확인할 수 있어요.</p>
      </div>

      <Card className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">입력 완성도</span>
          <span className="text-sm font-semibold text-accent">{completion}%</span>
        </div>
        <Progress value={completion} />
        {age !== null && <p className="text-xs text-foreground-muted">만 {age}세로 계산돼요.</p>}
      </Card>

      <Section title="기본정보">
        <Field label="생년월일" htmlFor="birthDate">
          <Input
            id="birthDate"
            type="date"
            value={profile.birthDate ?? ""}
            max={todayLocalDateString()}
            onChange={(e) => updateProfile({ birthDate: e.target.value || undefined })}
          />
        </Field>
        <Field label="시/도" htmlFor="province">
          <Select
            id="province"
            value={profile.residence?.province ?? ""}
            onChange={(e) =>
              updateProfile({ residence: { ...profile.residence, province: e.target.value || undefined } })
            }
          >
            <option value="">선택해 주세요</option>
            {PROVINCES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="시/군/구" htmlFor="city">
          <Input
            id="city"
            placeholder="예: 이천시"
            value={profile.residence?.city ?? ""}
            onChange={(e) => updateProfile({ residence: { ...profile.residence, city: e.target.value || undefined } })}
          />
        </Field>
      </Section>

      <Section title="현재 상태">
        <OptionList
          name="currentStatus"
          options={CURRENT_STATUS_OPTIONS}
          value={currentStatus}
          onChange={(value) => {
            const mapped = CURRENT_STATUS_TO_PROFILE[value];
            updateProfile({ employmentStatus: mapped.employmentStatus, educationStatus: mapped.educationStatus });
          }}
        />
      </Section>

      <Section title="가구·소득">
        <Field label="개인 연소득" htmlFor="individualIncomeBand">
          <Select
            id="individualIncomeBand"
            value={profile.individualIncomeBand ?? ""}
            onChange={(e) =>
              updateProfile({ individualIncomeBand: (e.target.value || undefined) as IncomeBand | undefined })
            }
          >
            <option value="">선택해 주세요</option>
            {INCOME_BAND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="가구원 수" htmlFor="householdSize">
          <Input
            id="householdSize"
            type="number"
            min={1}
            inputMode="numeric"
            placeholder="예: 2"
            value={profile.householdSize?.toString() ?? ""}
            onChange={(e) =>
              updateProfile({ householdSize: e.target.value === "" ? undefined : Number(e.target.value) })
            }
          />
        </Field>
        <Field label="가구 연소득" htmlFor="householdIncomeBand">
          <Select
            id="householdIncomeBand"
            value={profile.householdIncomeBand ?? ""}
            onChange={(e) =>
              updateProfile({ householdIncomeBand: (e.target.value || undefined) as IncomeBand | undefined })
            }
          >
            <option value="">선택해 주세요</option>
            {INCOME_BAND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="금융자산 (만원)" htmlFor="financialAssets">
          <Input
            id="financialAssets"
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="예: 500"
            value={toManwon(profile.financialAssets)}
            onChange={(e) => updateProfile({ financialAssets: fromManwon(e.target.value) })}
          />
        </Field>
      </Section>

      <Section title="가족정보">
        <OptionList
          name="maritalStatus"
          options={MARITAL_OPTIONS}
          value={profile.maritalStatus}
          onChange={(value) =>
            // Clearing marriageDate when switching away from "married" avoids
            // leaving a stale marriage date attached to a non-married status.
            updateProfile({ maritalStatus: value, marriageDate: value === "married" ? profile.marriageDate : undefined })
          }
        />
        <Field label="자녀 수" htmlFor="childrenCount">
          <Input
            id="childrenCount"
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="예: 0"
            value={profile.childrenCount?.toString() ?? ""}
            onChange={(e) =>
              updateProfile({ childrenCount: e.target.value === "" ? undefined : Number(e.target.value) })
            }
          />
        </Field>
        {profile.maritalStatus === "married" && (
          <Field label="혼인신고일 (선택 입력)" htmlFor="marriageDate">
            <Input
              id="marriageDate"
              type="date"
              max={todayLocalDateString()}
              value={profile.marriageDate ?? ""}
              onChange={(e) => updateProfile({ marriageDate: e.target.value || undefined })}
            />
          </Field>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="singleParentFamily">한부모가족에 해당하시나요? (선택 입력)</Label>
          <OptionList
            name="singleParentFamily"
            options={TRI_STATE_OPTIONS}
            value={triStateFromBoolean(profile.singleParentFamily)}
            onChange={(v) => updateProfile({ singleParentFamily: booleanFromTriState(v) })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="multiculturalFamily">다문화가족에 해당하시나요? (선택 입력)</Label>
          <OptionList
            name="multiculturalFamily"
            options={TRI_STATE_OPTIONS}
            value={triStateFromBoolean(profile.multiculturalFamily)}
            onChange={(v) => updateProfile({ multiculturalFamily: booleanFromTriState(v) })}
          />
        </div>
      </Section>

      <Section title="주거정보">
        <OptionList
          name="housingType"
          options={HOUSING_OPTIONS}
          value={profile.housingType}
          onChange={(value) => updateProfile({ housingType: value })}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="homeowner">주택을 소유하고 있나요? (선택 입력)</Label>
          <OptionList
            name="homeowner"
            options={HOMEOWNER_TRI_STATE_OPTIONS}
            value={triStateFromBoolean(profile.homeowner)}
            onChange={(v) => updateProfile({ homeowner: booleanFromTriState(v) })}
          />
        </div>
      </Section>

      <Section title="관심분야">
        <div className="flex flex-wrap gap-2">
          {INTEREST_CATEGORIES.map((category) => {
            const selected = interests.includes(category);
            return (
              <Chip
                key={category}
                selected={selected}
                onClick={() =>
                  updateProfile({
                    interests: selected ? interests.filter((c) => c !== category) : [...interests, category],
                  })
                }
              >
                {CATEGORY_LABELS[category]}
              </Chip>
            );
          })}
        </div>
      </Section>

      <Button variant="outline" onClick={handleReset} className="mt-2 w-full justify-center">
        <RotateCcw className="size-4" aria-hidden="true" />
        온보딩 다시 하기
      </Button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </Card>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
