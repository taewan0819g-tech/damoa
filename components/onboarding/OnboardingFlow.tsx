"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StepShell } from "./StepShell";
import { OptionList } from "./OptionList";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Chip } from "@/components/ui/chip";
import { useProfileStore } from "@/stores/profileStore";
import { birthDateSchema } from "@/lib/validation/profileSchema";
import { PROVINCES } from "@/lib/constants/regions";
import { INTEREST_CATEGORIES } from "@/lib/constants/interests";
import { INCOME_BAND_OPTIONS } from "@/lib/constants/incomeBands";
import { CATEGORY_LABELS, HOUSING_TYPE_LABELS, MARITAL_STATUS_LABELS } from "@/lib/labels";
import { CURRENT_STATUS_OPTIONS, CURRENT_STATUS_TO_PROFILE, type CurrentStatusOption } from "@/domain/profile/currentStatus";
import { TRI_STATE_OPTIONS, booleanFromTriState, type TriStateChoice } from "@/lib/constants/triState";
import type { BenefitCategory } from "@/types/benefit";
import type { HousingType, IncomeBand, MaritalStatus, UserProfile } from "@/types/profile";

const HOUSING_OPTIONS: { value: HousingType; label: string }[] = (
  ["own", "jeonse", "monthly_rent", "living_with_family", "other"] as HousingType[]
).map((value) => ({ value, label: HOUSING_TYPE_LABELS[value] }));

const MARITAL_OPTIONS: { value: MaritalStatus; label: string }[] = (
  ["single", "married", "divorced", "widowed"] as MaritalStatus[]
).map((value) => ({ value, label: MARITAL_STATUS_LABELS[value] }));

interface Draft {
  birthDate: string;
  province: string;
  city: string;
  currentStatus?: CurrentStatusOption;
  individualIncomeBand?: IncomeBand;
  householdSize: string;
  householdIncomeBand?: IncomeBand;
  maritalStatus?: MaritalStatus;
  childrenCount: string;
  marriageDate: string;
  singleParentFamily?: TriStateChoice;
  multiculturalFamily?: TriStateChoice;
  housingType?: HousingType;
  homeowner: boolean;
  interests: BenefitCategory[];
}

const INITIAL_DRAFT: Draft = {
  birthDate: "",
  province: "",
  city: "",
  householdSize: "",
  childrenCount: "",
  marriageDate: "",
  homeowner: false,
  interests: [],
};

const TOTAL_STEPS = 6;

export function OnboardingFlow() {
  const router = useRouter();
  const setProfile = useProfileStore((s) => s.setProfile);
  const completeOnboarding = useProfileStore((s) => s.completeOnboarding);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(INITIAL_DRAFT);

  const patch = (next: Partial<Draft>) => setDraft((d) => ({ ...d, ...next }));

  const birthDateValid = useMemo(() => draft.birthDate !== "" && birthDateSchema.safeParse(draft.birthDate).success, [draft.birthDate]);

  const goNext = () => {
    if (step < TOTAL_STEPS - 1) {
      setStep((s) => s + 1);
      return;
    }
    finish();
  };

  const finish = () => {
    const status = draft.currentStatus ? CURRENT_STATUS_TO_PROFILE[draft.currentStatus] : undefined;
    const profile: UserProfile = {
      birthDate: draft.birthDate || undefined,
      residence: { province: draft.province || undefined, city: draft.city || undefined },
      employmentStatus: status?.employmentStatus,
      educationStatus: status?.educationStatus,
      individualIncomeBand: draft.individualIncomeBand,
      householdSize: draft.householdSize ? Number(draft.householdSize) : undefined,
      householdIncomeBand: draft.householdIncomeBand,
      maritalStatus: draft.maritalStatus,
      childrenCount: draft.childrenCount ? Number(draft.childrenCount) : undefined,
      marriageDate: draft.maritalStatus === "married" && draft.marriageDate ? draft.marriageDate : undefined,
      singleParentFamily: booleanFromTriState(draft.singleParentFamily),
      multiculturalFamily: booleanFromTriState(draft.multiculturalFamily),
      housingType: draft.housingType,
      homeowner: draft.homeowner,
      interests: draft.interests.length > 0 ? draft.interests : undefined,
    };
    setProfile(profile);
    completeOnboarding();
    router.push("/home");
  };

  const goBack = () => setStep((s) => Math.max(0, s - 1));

  if (step === 0) {
    return (
      <StepShell
        step={0}
        totalSteps={TOTAL_STEPS}
        title="기본정보를 알려주세요"
        description="생년월일과 거주지역을 입력해 주세요."
        onNext={goNext}
        nextDisabled={!birthDateValid || !draft.province}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="birthDate">생년월일</Label>
            <Input
              id="birthDate"
              type="date"
              value={draft.birthDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => patch({ birthDate: e.target.value })}
            />
            {draft.birthDate !== "" && !birthDateValid && (
              <p className="text-xs text-danger">올바른 생년월일을 입력해 주세요.</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="province">시/도</Label>
            <Select id="province" value={draft.province} onChange={(e) => patch({ province: e.target.value })}>
              <option value="">선택해 주세요</option>
              {PROVINCES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="city">시/군/구</Label>
            <Input id="city" placeholder="예: 이천시" value={draft.city} onChange={(e) => patch({ city: e.target.value })} />
          </div>
        </div>
      </StepShell>
    );
  }

  if (step === 1) {
    return (
      <StepShell
        step={1}
        totalSteps={TOTAL_STEPS}
        title="현재 상태를 알려주세요"
        description="가장 가까운 상태를 선택해 주세요."
        onBack={goBack}
        onNext={goNext}
        nextDisabled={!draft.currentStatus}
      >
        <OptionList
          name="currentStatus"
          options={CURRENT_STATUS_OPTIONS}
          value={draft.currentStatus}
          onChange={(v) => patch({ currentStatus: v })}
        />
      </StepShell>
    );
  }

  if (step === 2) {
    return (
      <StepShell
        step={2}
        totalSteps={TOTAL_STEPS}
        title="소득을 알려주세요"
        description="세전 연소득 기준, 해당하는 구간을 선택해 주세요. (선택 입력)"
        onBack={goBack}
        onNext={goNext}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="individualIncomeBand">개인 연소득</Label>
            <Select
              id="individualIncomeBand"
              value={draft.individualIncomeBand ?? ""}
              onChange={(e) => patch({ individualIncomeBand: (e.target.value || undefined) as IncomeBand | undefined })}
            >
              <option value="">선택해 주세요</option>
              {INCOME_BAND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="householdSize">가구원 수</Label>
            <Input
              id="householdSize"
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="예: 2"
              value={draft.householdSize}
              onChange={(e) => patch({ householdSize: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="householdIncomeBand">가구 연소득</Label>
            <Select
              id="householdIncomeBand"
              value={draft.householdIncomeBand ?? ""}
              onChange={(e) => patch({ householdIncomeBand: (e.target.value || undefined) as IncomeBand | undefined })}
            >
              <option value="">선택해 주세요</option>
              {INCOME_BAND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </StepShell>
    );
  }

  if (step === 3) {
    return (
      <StepShell
        step={3}
        totalSteps={TOTAL_STEPS}
        title="가족 정보를 알려주세요"
        onBack={goBack}
        onNext={goNext}
        nextDisabled={!draft.maritalStatus}
      >
        <div className="flex flex-col gap-6">
          <OptionList
            name="maritalStatus"
            options={MARITAL_OPTIONS}
            value={draft.maritalStatus}
            onChange={(v) => patch({ maritalStatus: v })}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="childrenCount">자녀 수</Label>
            <Input
              id="childrenCount"
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="예: 0"
              value={draft.childrenCount}
              onChange={(e) => patch({ childrenCount: e.target.value })}
            />
          </div>
          {draft.maritalStatus === "married" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="marriageDate">혼인신고일 (선택 입력)</Label>
              <Input
                id="marriageDate"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={draft.marriageDate}
                onChange={(e) => patch({ marriageDate: e.target.value })}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="singleParentFamily">한부모가족에 해당하시나요? (선택 입력)</Label>
            <OptionList
              name="singleParentFamily"
              options={TRI_STATE_OPTIONS}
              value={draft.singleParentFamily}
              onChange={(v) => patch({ singleParentFamily: v })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="multiculturalFamily">다문화가족에 해당하시나요? (선택 입력)</Label>
            <OptionList
              name="multiculturalFamily"
              options={TRI_STATE_OPTIONS}
              value={draft.multiculturalFamily}
              onChange={(v) => patch({ multiculturalFamily: v })}
            />
          </div>
        </div>
      </StepShell>
    );
  }

  if (step === 4) {
    return (
      <StepShell
        step={4}
        totalSteps={TOTAL_STEPS}
        title="주거 정보를 알려주세요"
        onBack={goBack}
        onNext={goNext}
        nextDisabled={!draft.housingType}
      >
        <div className="flex flex-col gap-6">
          <OptionList
            name="housingType"
            options={HOUSING_OPTIONS}
            value={draft.housingType}
            onChange={(v) => patch({ housingType: v, homeowner: v === "own" ? true : draft.homeowner })}
          />
          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-medium text-foreground">
            <input
              type="checkbox"
              checked={draft.homeowner}
              onChange={(e) => patch({ homeowner: e.target.checked })}
              className="size-4 accent-accent"
            />
            주택을 소유하고 있어요
          </label>
        </div>
      </StepShell>
    );
  }

  return (
    <StepShell
      step={5}
      totalSteps={TOTAL_STEPS}
      title="관심분야를 선택해 주세요"
      description="복수 선택할 수 있어요. (선택 입력)"
      onBack={goBack}
      onNext={goNext}
      nextLabel="완료"
    >
      <div className="flex flex-wrap gap-2">
        {INTEREST_CATEGORIES.map((category) => {
          const selected = draft.interests.includes(category);
          return (
            <Chip
              key={category}
              selected={selected}
              onClick={() =>
                patch({
                  interests: selected
                    ? draft.interests.filter((c) => c !== category)
                    : [...draft.interests, category],
                })
              }
            >
              {CATEGORY_LABELS[category]}
            </Chip>
          );
        })}
      </div>
    </StepShell>
  );
}
