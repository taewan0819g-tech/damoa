// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { useProfileStore } from "@/stores/profileStore";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

afterEach(cleanup);
beforeEach(() => {
  push.mockClear();
  useProfileStore.getState().resetProfile();
});

function fillBirthDate() {
  fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "2000-01-01" } });
}

/** Drives the onboarding flow from step 0 through to finish(), filling only the required fields on the way. */
function completeRemainingSteps() {
  fireEvent.click(screen.getByText("다음")); // step0 -> step1
  fireEvent.click(screen.getByRole("radio", { name: "직장인 / 재직 중" }));
  fireEvent.click(screen.getByText("다음")); // step1 -> step2
  fireEvent.click(screen.getByText("다음")); // step2 -> step3
  fireEvent.click(screen.getByRole("radio", { name: "미혼" }));
  fireEvent.click(screen.getByText("다음")); // step3 -> step4
  fireEvent.click(screen.getByRole("radio", { name: "자가" }));
  fireEvent.click(screen.getByText("다음")); // step4 -> step5
  fireEvent.click(screen.getByText("완료"));
}

/**
 * Checkpoint: Canonical Province/City Input + Gazetteer Freshness Hardening.
 *
 * The free-text city Input in onboarding step 0 was replaced with a
 * province-dependent Select. These tests lock in that the flow only ever
 * writes canonical gazetteer strings, that city stays optional, and that
 * changing province never carries over an invalid city (never fuzzy-maps),
 * while it DOES preserve a city that's still valid for the new province.
 */
describe("OnboardingFlow — canonical province/city input", () => {
  it("3. stores a canonical {province: '경기도', city: '이천시'} residence through to finish()", () => {
    render(createElement(OnboardingFlow));
    fillBirthDate();
    fireEvent.change(screen.getByLabelText("시/도"), { target: { value: "경기도" } });
    fireEvent.change(screen.getByLabelText("시/군/구 (선택 입력)"), { target: { value: "이천시" } });
    completeRemainingSteps();
    expect(useProfileStore.getState().profile.residence).toEqual({ province: "경기도", city: "이천시" });
  });

  it("4. allows a province-only residence (city left unselected)", () => {
    render(createElement(OnboardingFlow));
    fillBirthDate();
    fireEvent.change(screen.getByLabelText("시/도"), { target: { value: "경기도" } });
    completeRemainingSteps();
    const residence = useProfileStore.getState().profile.residence;
    expect(residence?.province).toBe("경기도");
    expect(residence?.city).toBeUndefined();
  });

  it("5. changing 경기도/이천시 -> 서울특별시 clears the now-invalid '이천시' city selection", () => {
    render(createElement(OnboardingFlow));
    fireEvent.change(screen.getByLabelText("시/도"), { target: { value: "경기도" } });
    fireEvent.change(screen.getByLabelText("시/군/구 (선택 입력)"), { target: { value: "이천시" } });
    expect((screen.getByLabelText("시/군/구 (선택 입력)") as HTMLSelectElement).value).toBe("이천시");

    fireEvent.change(screen.getByLabelText("시/도"), { target: { value: "서울특별시" } });
    expect((screen.getByLabelText("시/군/구 (선택 입력)") as HTMLSelectElement).value).toBe("");
  });

  it("6. changing province while the selected city remains valid for the new province preserves it", () => {
    // 중구 exists under both 서울특별시 and 부산광역시.
    render(createElement(OnboardingFlow));
    fireEvent.change(screen.getByLabelText("시/도"), { target: { value: "서울특별시" } });
    fireEvent.change(screen.getByLabelText("시/군/구 (선택 입력)"), { target: { value: "중구" } });

    fireEvent.change(screen.getByLabelText("시/도"), { target: { value: "부산광역시" } });
    expect((screen.getByLabelText("시/군/구 (선택 입력)") as HTMLSelectElement).value).toBe("중구");
  });

  it("never renders a free-text city input in onboarding (no fuzzy input path)", () => {
    render(createElement(OnboardingFlow));
    const city = screen.getByLabelText("시/군/구 (선택 입력)");
    expect(city.tagName).toBe("SELECT");
  });
});
