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

/**
 * Checkpoint: Corrective Region Architecture.
 *
 * The 2026-07-01 전남광주통합특별시 merger retired "광주광역시"/"전라남도" from
 * the current-user-selectable province roster (see lib/constants/regions.ts).
 * An existing profile persisted BEFORE the merger (province: "광주광역시" or
 * "전라남도") must get the exact same "never silently drop or correct"
 * treatment the city selector already gets — the province field is one
 * level up from city, but the invariant is identical.
 */
describe("ProfilePage — legacy/unrecognized province preservation (2026-07-01 전남광주통합특별시 merger)", () => {
  it("does not silently destroy an existing pre-merger '광주광역시' province merely by rendering", () => {
    useProfileStore.getState().setProfile({ residence: { province: "광주광역시" } });
    render(createElement(ProfilePage));
    expect(useProfileStore.getState().profile.residence?.province).toBe("광주광역시");
  });

  it("profile edit never turns an unrecognized persisted province into a guessed current one from an unrelated field change", () => {
    useProfileStore.getState().setProfile({ residence: { province: "전라남도", city: "목포시" } });
    render(createElement(ProfilePage));
    fireEvent.click(screen.getByRole("radio", { name: "직장인 / 재직 중" }));
    expect(useProfileStore.getState().profile.residence).toEqual({ province: "전라남도", city: "목포시" });
  });

  it("surfaces the unrecognized province as '기존 입력: <value> (확인 필요)' and keeps it as the select's current value", () => {
    useProfileStore.getState().setProfile({ residence: { province: "광주광역시" } });
    render(createElement(ProfilePage));
    expect(screen.getByText(/기존 입력: 광주광역시 \(확인 필요\)/)).toBeTruthy();
    expect((screen.getByLabelText("시/도") as HTMLSelectElement).value).toBe("광주광역시");
  });

  it("shows no unrecognized-value warning for an already-canonical persisted province", () => {
    useProfileStore.getState().setProfile({ residence: { province: "전남광주통합특별시" } });
    render(createElement(ProfilePage));
    expect(screen.queryByText(/기존 입력:.*\(확인 필요\)/)).toBeNull();
  });

  it("lets the user explicitly replace the unrecognized province with the current merged one, preserving a still-valid city", () => {
    // 목포시 is a real 전남광주통합특별시 city (former 전라남도 territory is
    // wholly inside the merged province) — carrying it over here is the
    // desired behavior, the same "preserve when still valid" rule already
    // proven for ordinary province switches elsewhere in this file.
    useProfileStore.getState().setProfile({ residence: { province: "전라남도", city: "목포시" } });
    render(createElement(ProfilePage));
    fireEvent.change(screen.getByLabelText("시/도"), { target: { value: "전남광주통합특별시" } });
    expect(useProfileStore.getState().profile.residence).toEqual({
      province: "전남광주통합특별시",
      city: "목포시",
    });
  });

  it("lets the user explicitly replace an unrecognized province with a current one where the old city is no longer valid, clearing it", () => {
    useProfileStore.getState().setProfile({ residence: { province: "광주광역시", city: "동구" } });
    render(createElement(ProfilePage));
    // 동구 exists under both 광주광역시(historical) and 전남광주통합특별시(current)
    // *and* several other metros — switch to an unrelated current province
    // instead, to exercise the "no longer valid, so clear" branch.
    fireEvent.change(screen.getByLabelText("시/도"), { target: { value: "제주특별자치도" } });
    expect(useProfileStore.getState().profile.residence).toEqual({
      province: "제주특별자치도",
      city: undefined,
    });
  });
});
