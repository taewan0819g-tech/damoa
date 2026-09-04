// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ProfilePage from "@/app/(app)/profile/page";
import { useProfileStore } from "@/stores/profileStore";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(cleanup);
beforeEach(() => {
  useProfileStore.getState().resetProfile();
});

/**
 * Checkpoint: Canonical Province/City Input + Gazetteer Freshness Hardening.
 *
 * The profile page's free-text city Input was replaced with the same
 * province-dependent Select as onboarding. The critical extra requirement
 * here (that onboarding doesn't have): an existing persisted city value the
 * gazetteer doesn't recognize (typo, renamed county, pre-canonical free-text
 * entry, ...) must NEVER be silently dropped or "corrected" just because
 * this page rendered or an unrelated field changed — only an explicit user
 * change to the city field itself may replace/clear it.
 */
describe("ProfilePage — legacy/unrecognized city preservation", () => {
  it("7. does not silently destroy an existing unrecognized persisted city merely by rendering", () => {
    useProfileStore.getState().setProfile({ residence: { province: "경기도", city: "이천면" } });
    render(createElement(ProfilePage));
    expect(useProfileStore.getState().profile.residence).toEqual({ province: "경기도", city: "이천면" });
  });

  it("profile edit never turns an unknown persisted city into a guessed canonical city just from an unrelated field change", () => {
    useProfileStore.getState().setProfile({ residence: { province: "경기도", city: "이천면" } });
    render(createElement(ProfilePage));
    fireEvent.click(screen.getByRole("radio", { name: "직장인 / 재직 중" }));
    expect(useProfileStore.getState().profile.residence).toEqual({ province: "경기도", city: "이천면" });
  });

  it("surfaces the unrecognized value as '기존 입력: <value> (확인 필요)' and keeps it as the select's current value", () => {
    useProfileStore.getState().setProfile({ residence: { province: "경기도", city: "이천면" } });
    render(createElement(ProfilePage));
    expect(screen.getByText(/기존 입력: 이천면 \(확인 필요\)/)).toBeTruthy();
    expect((screen.getByLabelText("시/군/구 (선택 입력)") as HTMLSelectElement).value).toBe("이천면");
  });

  it("shows no unrecognized-value warning for an already-canonical persisted city", () => {
    useProfileStore.getState().setProfile({ residence: { province: "경기도", city: "이천시" } });
    render(createElement(ProfilePage));
    expect(screen.queryByText(/확인 필요/)).toBeNull();
  });

  it("lets the user explicitly replace the unrecognized city with a canonical option", () => {
    useProfileStore.getState().setProfile({ residence: { province: "경기도", city: "이천면" } });
    render(createElement(ProfilePage));
    fireEvent.change(screen.getByLabelText("시/군/구 (선택 입력)"), { target: { value: "이천시" } });
    expect(useProfileStore.getState().profile.residence?.city).toBe("이천시");
  });

  it("lets the user explicitly clear the unrecognized city", () => {
    useProfileStore.getState().setProfile({ residence: { province: "경기도", city: "이천면" } });
    render(createElement(ProfilePage));
    fireEvent.change(screen.getByLabelText("시/군/구 (선택 입력)"), { target: { value: "" } });
    expect(useProfileStore.getState().profile.residence?.city).toBeUndefined();
  });

  it("changing province away from an unrecognized city's province clears it (explicit region edit, not silent destruction)", () => {
    useProfileStore.getState().setProfile({ residence: { province: "경기도", city: "이천면" } });
    render(createElement(ProfilePage));
    fireEvent.change(screen.getByLabelText("시/도"), { target: { value: "서울특별시" } });
    expect(useProfileStore.getState().profile.residence).toEqual({ province: "서울특별시", city: undefined });
  });

  it("changing province while a valid canonical city remains valid preserves it", () => {
    useProfileStore.getState().setProfile({ residence: { province: "서울특별시", city: "중구" } });
    render(createElement(ProfilePage));
    fireEvent.change(screen.getByLabelText("시/도"), { target: { value: "부산광역시" } });
    expect(useProfileStore.getState().profile.residence).toEqual({ province: "부산광역시", city: "중구" });
  });

  it("never renders a free-text city input on the profile page (no fuzzy input path)", () => {
    useProfileStore.getState().setProfile({ residence: { province: "경기도", city: "이천시" } });
    render(createElement(ProfilePage));
    const city = screen.getByLabelText("시/군/구 (선택 입력)");
    expect(city.tagName).toBe("SELECT");
  });
});
