import { describe, expect, it } from "vitest";
import { gwangjuJeonnamRelation, incheonCityRelation } from "@/domain/region/adminTransition";

/**
 * Checkpoint: Final Region Transition Compatibility.
 *
 * Table-driven proof of every containment/overlap relation the two verified
 * 2026-07-01 administrative transitions require, per Damoa's
 * constraint-compatibility principle (U = user territory, P = policy
 * territory): U ∩ P = ∅ => fail (here: undefined/disjoint), U ∩ P != ∅ and
 * U ⊄ P => "overlap" (matchRegion turns this into "unknown"), U ⊆ P =>
 * "contained" (matchRegion turns this into "pass"). This module is
 * deliberately NOT a fuzzy matcher — every case below is a hand-verified
 * fact about a specific named administrative change, not a guess.
 */
describe("incheonCityRelation — 인천 구제 개편 (중구/동구/서구 -> 제물포구/영종구/검단구/서해구)", () => {
  const cases: [string, string, "contained" | "overlap" | undefined][] = [
    // user resides under a NEW name, policy expressed with an OLD name.
    ["영종구", "중구", "contained"], // 영종구 wholly inside old 중구 -> user's territory is fully covered
    ["제물포구", "중구", "overlap"], // 제물포구 = old 중구 부분 + old 동구 부분, old 중구 alone doesn't cover it
    ["제물포구", "동구", "overlap"], // symmetric: 제물포구 also draws from old 동구
    ["서해구", "서구", "contained"], // 서해구 wholly inside old 서구
    ["검단구", "서구", "contained"], // 검단구 also wholly inside old 서구
    // user resides under an OLD (legacy) name, policy expressed with a NEW name.
    ["중구", "영종구", "overlap"], // old 중구 is bigger than new 영종구 (also covers 제물포구 territory) -> not fully inside 영종구 alone
    ["동구", "제물포구", "contained"], // all of old 동구 became part of 제물포구
    ["서구", "서해구", "overlap"], // old 서구 split into BOTH 서해구 AND 검단구, so old 서구 isn't fully inside 서해구 alone
    ["서구", "검단구", "overlap"], // symmetric
    // unrelated / unmodeled pairs -> undefined (disjoint, ordinary exact-match "fail" behavior).
    ["미추홀구", "중구", undefined], // unaffected district, no transition relation
    ["영종구", "동구", undefined], // 영종구 never touched old 동구's territory
    ["서구", "영종구", undefined], // old 서구 and new 영종구 share no territory
    ["중구", "동구", undefined], // same era (both historical), genuinely different districts
    ["영종구", "제물포구", undefined], // same era (both current), genuinely different districts
  ];

  it.each(cases)("incheonCityRelation(%s, %s) === %s", (userCity, specCity, expected) => {
    expect(incheonCityRelation(userCity, specCity)).toBe(expected);
  });
});

describe("gwangjuJeonnamRelation — 전남광주통합특별시 merger (광주광역시 + 전라남도 -> 전남광주통합특별시)", () => {
  it("current resident of a former-전남 city passes a still-old-named 전라남도-wide policy (checkpoint example)", () => {
    expect(gwangjuJeonnamRelation("전남광주통합특별시", "목포시", "전라남도", undefined)).toBe("contained");
  });

  it("current resident of a former-광주 city FAILS a still-old-named 전라남도-wide policy (wrong heritage, checkpoint example)", () => {
    expect(gwangjuJeonnamRelation("전남광주통합특별시", "광산구", "전라남도", undefined)).toBe("disjoint");
  });

  it("current resident with no city specified is UNKNOWN against a still-old-named provincial policy (checkpoint example)", () => {
    expect(gwangjuJeonnamRelation("전남광주통합특별시", undefined, "전라남도", undefined)).toBe("overlap");
  });

  it("legacy 전라남도 resident passes a policy now expressed with the new merged province name, no city required (checkpoint example)", () => {
    expect(gwangjuJeonnamRelation("전라남도", "목포시", "전남광주통합특별시", undefined)).toBe("contained");
  });

  it("legacy 광주광역시 resident passes a policy now expressed with the new merged province name, no city required", () => {
    expect(gwangjuJeonnamRelation("광주광역시", "동구", "전남광주통합특별시", undefined)).toBe("contained");
  });

  it("legacy resident with no city specified is UNKNOWN against a new-named policy requiring a specific city", () => {
    expect(gwangjuJeonnamRelation("광주광역시", undefined, "전남광주통합특별시", "동구")).toBe("overlap");
  });

  it("legacy resident's city matches the new-named policy's required city -> contained", () => {
    expect(gwangjuJeonnamRelation("전라남도", "순천시", "전남광주통합특별시", "순천시")).toBe("contained");
  });

  it("legacy resident's city does NOT match the new-named policy's required (different) city -> disjoint", () => {
    expect(gwangjuJeonnamRelation("전라남도", "목포시", "전남광주통합특별시", "순천시")).toBe("disjoint");
  });

  it("current resident's specific city matches the old-named policy's required (same) city -> contained", () => {
    expect(gwangjuJeonnamRelation("전남광주통합특별시", "순천시", "전라남도", "순천시")).toBe("contained");
  });

  it("current resident's specific city does not match the old-named policy's required (different) city -> disjoint", () => {
    expect(gwangjuJeonnamRelation("전남광주통합특별시", "목포시", "전라남도", "순천시")).toBe("disjoint");
  });

  it("unrelated province pairs are not modeled by this transition -> undefined", () => {
    expect(gwangjuJeonnamRelation("서울특별시", undefined, "전라남도", undefined)).toBeUndefined();
    expect(gwangjuJeonnamRelation("전남광주통합특별시", "목포시", "서울특별시", undefined)).toBeUndefined();
    expect(gwangjuJeonnamRelation("경기도", "이천시", "전남광주통합특별시", undefined)).toBeUndefined();
  });

  it("never asserts old<->old or new<->new as a transition relation (that's ordinary exact match, not this module's job)", () => {
    expect(gwangjuJeonnamRelation("광주광역시", "동구", "전라남도", "목포시")).toBeUndefined();
    expect(gwangjuJeonnamRelation("전남광주통합특별시", "목포시", "전남광주통합특별시", "순천시")).toBeUndefined();
  });
});
