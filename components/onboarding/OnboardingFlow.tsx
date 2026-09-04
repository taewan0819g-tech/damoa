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
import { getCitiesForProvince } from "@/lib/eligibility/regionGazetteer";
import { INTEREST_CATEGORIES } from "@/lib/constants/interests";
import { INCOME_BAND_OPTIONS } from "@/lib/constants/incomeBands";
import {
  CATEGORY_LABELS,
  EDUCATION_STATUS_LABELS,
  EMPLOYMENT_STATUS_LABELS,
  HOUSING_TYPE_LABELS,
  MARITAL_STATUS_LABELS,
} from "@/lib/labels";
import { TRI_STATE_OPTIONS, HOMEOWNER_TRI_STATE_OPTIONS, booleanFromTriState, type TriStateChoice } from "@/lib/constants/triState";
import { todayPolicyDateString } from "@/lib/dates/policyDate";
import type { BenefitCategory } from "@/types/benefit";
import type { EducationStatus, EmploymentStatus, HousingType, IncomeBand, MaritalStatus, UserProfile } from "@/types/profile";

const HOUSING_OPTIONS: { value: HousingType; label: string }[] = (
  ["own", "jeonse", "monthly_rent", "living_with_family", "other"] as HousingType[]
).map((value) => ({ value, label: HOUSING_TYPE_LABELS[value] }));

const MARITAL_OPTIONS: { value: MaritalStatus; label: string }[] = (
  ["single", "married", "divorced", "widowed"] as MaritalStatus[]
).map((value) => ({ value, label: MARITAL_STATUS_LABELS[value] }));

// employmentStatus and educationStatus are independent UserProfile fields —
// selecting one must never overwrite or infer the other (e.g. "student"
// employment does not imply "university" education, and vice versa).
const EMPLOYMENT_OPTIONS: { value: EmploymentStatus; label: string }[] = (
  ["employed", "unemployed", "self_employed", "freelancer", "student", "other"] as EmploymentStatus[]
).map((value) => ({ value, label: EMPLOYMENT_STATUS_LABELS[value] }));

const EDUCATION_OPTIONS: { value: EducationStatus; label: string }[] = (
  ["high_school", "university", "graduate_school", "graduated", "not_applicable"] as EducationStatus[]
).map((value) => ({ value, label: EDUCATION_STATUS_LABELS[value] }));

interface Draft {
  birthDate: string;
  province: string;
  city: string;
  employmentStatus?: EmploymentStatus;
  educationStatus?: EducationStatus;
  individualIncomeBand?: IncomeBand;
  householdSize: string;
  householdIncomeBand?: IncomeBand;
  maritalStatus?: MaritalStatus;
  childrenCount: string;
  marriageDate: string;
  singleParentFamily?: TriStateChoice;
  multiculturalFamily?: TriStateChoice;
  housingType?: HousingType;
  /**
   * Genuine three-way choice — the same triState pattern as
   * singleParentFamily/multiculturalFamily: "not yet answered" (undefined)
   * must never be silently treated as "does not own a home".
   *
   * `housingType` inference is deliberately ONE-WAY: non-own tenure
   * ("jeonse"/"monthly_rent"/"living_with_family") can never prove
   * non-ownership (a person can rent their current residence while owning
   * another property elsewhere), so those values never touch this field.
   * But `housingType === "own"` ("자가") IS a sufficient positive ownership
   * signal, so choosing it sets this to "yes" (see the housingType
   * OptionList's onChange below) — never the other direction.
   */
  homeowner?: TriStateChoice;
  interests: BenefitCategory[];
}

const INITIAL_DRAFT: Draft = {
  birthDate: "",
  province: "",
  city: "",
  householdSize: "",
  childrenCount: "",
  marriageDate: "",
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

  // Derived, not stored: recomputed from the current province on every
  // render so it always reflects draft.province exactly (cheap array copy,
  // no memoization needed).
  const cityOptions = getCitiesForProvince(draft.province);

  const birthDateValid = useMemo(() => draft.birthDate !== "" && birthDateSchema.safeParse(draft.birthDate).success, [draft.birthDate]);

  const goNext = () => {
    if (step < TOTAL_STEPS - 1) {
      setStep((s) => s + 1);
      return;
    }
    finish();
  };

  const finish = () => {
    const profile: UserProfile = {
      birthDate: draft.birthDate || undefined,
      residence: { province: draft.province || undefined, city: draft.city || undefined },
      employmentStatus: draft.employmentStatus,
      educationStatus: draft.educationStatus,
      individualIncomeBand: draft.individualIncomeBand,
      householdSize: draft.householdSize ? Number(draft.householdSize) : undefined,
      householdIncomeBand: draft.householdIncomeBand,
      maritalStatus: draft.maritalStatus,
      childrenCount: draft.childrenCount ? Number(draft.childrenCount) : undefined,
      marriageDate: draft.maritalStatus === "married" && draft.marriageDate ? draft.marriageDate : undefined,
      singleParentFamily: booleanFromTriState(draft.singleParentFamily),
      multiculturalFamily: booleanFromTriState(draft.multiculturalFamily),
      housingType: draft.housingType,
      homeowner: booleanFromTriState(draft.homeowner),
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
              max={todayPolicyDateString()}
              onChange={(e) => patch({ birthDate: e.target.value })}
            />
            {draft.birthDate !== "" && !birthDateValid && (
              <p className="text-xs text-danger">올바른 생년월일을 입력해 주세요.</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="province">시/도</Label>
            <Select
              id="province"
              value={draft.province}
              onChange={(e) => {
                const province = e.target.value;
                // City is province-scoped: switching province must not carry
                // over a city that no longer belongs to it (never fuzzy-map,
                // just clear when it's no longer a valid option).
                const cities = getCitiesForProvince(province);
                patch({ province, city: draft.city && cities.includes(draft.city) ? draft.city : "" });
              }}
            >
              <option value="">선택해 주세요</option>
              {PROVINCES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="city">시/군/구 (선택 입력)</Label>
            <Select id="city" value={draft.city} onChange={(e) => patch({ city: e.target.value })}>
              <option value="">선택 안 함</option>
              {cityOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
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
        description="일과 학업을 병행하고 있다면 각각 선택할 수 있어요."
        onBack={goBack}
        onNext={goNext}
        nextDisabled={!draft.employmentStatus}
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="employmentStatus">일/고용 상태</Label>
            <OptionList
              name="employmentStatus"
              options={EMPLOYMENT_OPTIONS}
              value={draft.employmentStatus}
              onChange={(v) => patch({ employmentStatus: v })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="educationStatus">학업 상태 (선택 입력)</Label>
            <OptionList
              name="educationStatus"
              options={EDUCATION_OPTIONS}
              value={draft.educationStatus}
              onChange={(v) => patch({ educationStatus: v })}
            />
          </div>
        </div>
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
                max={todayPolicyDateString()}
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
            onChange={(v) => patch({ housingType: v, ...(v === "own" ? { homeowner: "yes" } : {}) })}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="homeowner">주택을 소유하고 있나요? (선택 입력)</Label>
            <OptionList
              name="homeowner"
              options={HOMEOWNER_TRI_STATE_OPTIONS}
              value={draft.homeowner}
              onChange={(v) => patch({ homeowner: v })}
            />
          </div>
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
