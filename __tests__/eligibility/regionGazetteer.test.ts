import { describe, expect, it } from "vitest";
import {
  CURRENT_RESIDENCE_GAZETTEER_METADATA,
  GAZETTEER_METADATA,
  getCitiesForProvince,
  getCurrentResidenceGazetteer,
  getGazetteer,
  getShortDistrictNames,
  isUnambiguousCity,
  resolveCityProvinces,
} from "@/lib/eligibility/regionGazetteer";
import { normalizeProvince } from "@/lib/eligibility/region";
import { PROVINCES } from "@/lib/constants/regions";

describe("regionGazetteer structural self-checks", () => {
  it("every gazetteer province key normalizes to itself (canonical form, not an alias)", () => {
    const gazetteer = getGazetteer();
    for (const province of Object.keys(gazetteer)) {
      expect(normalizeProvince(province)).toBe(province);
    }
  });

  it("has no duplicate city entries within the same province", () => {
    const gazetteer = getGazetteer();
    for (const [province, cities] of Object.entries(gazetteer)) {
      const unique = new Set(cities);
      expect(unique.size, `duplicate city within ${province}`).toBe(cities.length);
    }
  });

  it("every city/county/district name ends with 시, 군, or 구", () => {
    const gazetteer = getGazetteer();
    for (const cities of Object.values(gazetteer)) {
      for (const city of cities) {
        expect(/(시|군|구)$/.test(city), `unexpected suffix: ${city}`).toBe(true);
      }
    }
  });

  it("covers the full 17-province/metro roster with a non-trivial number of cities", () => {
    const gazetteer = getGazetteer();
    expect(Object.keys(gazetteer)).toHaveLength(17);
    const total = Object.values(gazetteer).reduce((sum, cities) => sum + cities.length, 0);
    expect(total).toBeGreaterThan(200);
  });
});

describe("resolveCityProvinces", () => {
  it("resolves the task's example cities to their real province", () => {
    expect(resolveCityProvinces("이천시")).toEqual(["경기도"]);
    expect(resolveCityProvinces("수원시")).toEqual(["경기도"]);
    expect(resolveCityProvinces("성남시")).toEqual(["경기도"]);
    expect(resolveCityProvinces("강남구")).toEqual(["서울특별시"]);
    expect(resolveCityProvinces("해운대구")).toEqual(["부산광역시"]);
  });

  it("returns an empty array for a name that isn't a real city/county/district", () => {
    expect(resolveCityProvinces("없는시")).toEqual([]);
  });

  it("returns multiple provinces for genuinely ambiguous names instead of guessing", () => {
    expect(resolveCityProvinces("고성군").sort()).toEqual(["강원특별자치도", "경상남도"].sort());
    expect(resolveCityProvinces("중구").length).toBeGreaterThan(1);
    expect(resolveCityProvinces("동구").length).toBeGreaterThan(1);
  });

  it("isUnambiguousCity is false for ambiguous names and unknown names, true for real unique ones", () => {
    expect(isUnambiguousCity("이천시")).toBe(true);
    expect(isUnambiguousCity("고성군")).toBe(false);
    expect(isUnambiguousCity("없는시")).toBe(false);
  });
});

describe("GAZETTEER_METADATA", () => {
  it("documents this dataset as non-authoritative, hand-curated reference data", () => {
    expect(GAZETTEER_METADATA.authoritative).toBe(false);
    expect(GAZETTEER_METADATA.sourceType).toBe("manual");
    expect(GAZETTEER_METADATA.version.length).toBeGreaterThan(0);
    expect(GAZETTEER_METADATA.source.length).toBeGreaterThan(0);
  });

  it("lists at least one candidate authoritative source with a name and URL", () => {
    expect(GAZETTEER_METADATA.candidateAuthoritativeSources.length).toBeGreaterThan(0);
    for (const candidate of GAZETTEER_METADATA.candidateAuthoritativeSources) {
      expect(candidate.name.length).toBeGreaterThan(0);
      expect(candidate.url.startsWith("https://")).toBe(true);
    }
  });
});

describe("getShortDistrictNames", () => {
  it("returns exactly the real 2-character (1-char stem + 시/군/구) gazetteer entries", () => {
    const shortNames = getShortDistrictNames();
    expect(shortNames.sort()).toEqual(["남구", "동구", "북구", "서구", "중구"].sort());
  });

  it("every returned name is a real, resolvable gazetteer entry with at least one province", () => {
    for (const name of getShortDistrictNames()) {
      expect(name).toHaveLength(2);
      expect(resolveCityProvinces(name).length).toBeGreaterThan(0);
    }
  });

  it("is derived from CITY_GAZETTEER, not hardcoded separately (stays in sync)", () => {
    const gazetteer = getGazetteer();
    const expected = new Set<string>();
    for (const cities of Object.values(gazetteer)) {
      for (const city of cities) {
        if (city.length === 2) expected.add(city);
      }
    }
    expect(new Set(getShortDistrictNames())).toEqual(expected);
  });
});

/**
 * Checkpoint: Canonical Province/City Input + Gazetteer Freshness Hardening.
 *
 * getCitiesForProvince is the single shared source onboarding + the profile
 * page both read from to build their province-dependent city <Select>s. It
 * must be exact-match-only (no alias resolution — the UI always passes the
 * canonical string the province Select itself produced), deterministic, and
 * side-effect-free.
 */
describe("getCitiesForProvince", () => {
  it("1. includes '이천시' and '수원시' for '경기도'", () => {
    const cities = getCitiesForProvince("경기도");
    expect(cities).toContain("이천시");
    expect(cities).toContain("수원시");
  });

  it("2. returns an empty array for an unrecognized/invalid province instead of guessing", () => {
    expect(getCitiesForProvince("없는도")).toEqual([]);
    expect(getCitiesForProvince("")).toEqual([]);
  });

  it("never resolves aliases — only the exact canonical province key works (no fuzzy input path)", () => {
    // "경기" is a recognized alias in region.ts's PROVINCE_ALIASES, but
    // getCitiesForProvince must NOT normalize it: passing anything other
    // than the literal canonical gazetteer key returns [].
    expect(getCitiesForProvince("경기")).toEqual([]);
    expect(getCitiesForProvince("서울")).toEqual([]);
  });

  it("returns a fresh array copy each call, so callers can never mutate the shared gazetteer", () => {
    const a = getCitiesForProvince("경기도");
    a.push("가짜시");
    const b = getCitiesForProvince("경기도");
    expect(b).not.toContain("가짜시");
  });
});

/**
 * Checkpoint: Corrective Region Architecture.
 *
 * CURRENT_RESIDENCE_GAZETTEER (job A) must reflect the legally current
 * 2026-07-01 roster: the 전남광주통합특별시 merger and the 인천 구제 개편 both
 * applied, so 광주광역시/전라남도 are no longer independently selectable and
 * 인천광역시's abolished 중구/동구/서구 are replaced by 제물포구/영종구/검단구/
 * 서해구. `lib/constants/regions.ts`'s PROVINCES (the literal <Select> option
 * list onboarding/profile render) must stay exactly in sync with this
 * table's key set — a drift there would silently offer a province with zero
 * selectable cities, or omit a real one, instead of a loud test failure.
 */
describe("CURRENT_RESIDENCE_GAZETTEER — 2026-07-01 roster (job A: new-user-selectable)", () => {
  it("PROVINCES (lib/constants/regions.ts) exactly matches CURRENT_RESIDENCE_GAZETTEER's key set", () => {
    const gazetteerProvinces = Object.keys(getCurrentResidenceGazetteer()).sort();
    expect([...PROVINCES].sort()).toEqual(gazetteerProvinces);
  });

  it("offers 전남광주통합특별시 with the union of former 광주 자치구 and 전남 시/군", () => {
    const cities = getCitiesForProvince("전남광주통합특별시");
    expect(cities).toContain("동구"); // former 광주광역시 자치구
    expect(cities).toContain("광산구"); // former 광주광역시 자치구
    expect(cities).toContain("목포시"); // former 전라남도 시
    expect(cities).toContain("순천시"); // former 전라남도 시
  });

  it("no longer offers 광주광역시 or 전라남도 as independently-selectable provinces", () => {
    expect(getCitiesForProvince("광주광역시")).toEqual([]);
    expect(getCitiesForProvince("전라남도")).toEqual([]);
    expect(PROVINCES as readonly string[]).not.toContain("광주광역시");
    expect(PROVINCES as readonly string[]).not.toContain("전라남도");
  });

  it("인천광역시 offers the four new/renamed districts, not the three abolished ones", () => {
    const cities = getCitiesForProvince("인천광역시");
    expect(cities).toEqual(expect.arrayContaining(["제물포구", "영종구", "검단구", "서해구"]));
    expect(cities).not.toContain("중구");
    expect(cities).not.toContain("동구");
    expect(cities).not.toContain("서구");
    // Unaffected districts are still present.
    expect(cities).toContain("미추홀구");
  });

  it("CURRENT_RESIDENCE_GAZETTEER_METADATA documents itself as non-authoritative, hand-verified data", () => {
    expect(CURRENT_RESIDENCE_GAZETTEER_METADATA.authoritative).toBe(false);
    expect(CURRENT_RESIDENCE_GAZETTEER_METADATA.effectiveAsOf).toBe("2026-07-01");
    expect(CURRENT_RESIDENCE_GAZETTEER_METADATA.verifiedLegalChanges.length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * POLICY_REGION_GAZETTEER (job B) must never regress recognition of
 * historical names still used by already-ingested benefit text, while also
 * gaining the new 2026-07-01 names so freshly-ingested/updated text
 * resolves correctly too. Old and new Incheon district names deliberately
 * coexist without being aliased to each other (see regionGazetteer.ts's file
 * header — the boundaries were split/redrawn, not renamed 1:1).
 */
describe("POLICY_REGION_GAZETTEER — historical + current coexistence (job B: text parsing)", () => {
  it("still recognizes 광주광역시 and 전라남도 as provinces with their pre-merger city rosters", () => {
    const gazetteer = getGazetteer();
    expect(gazetteer["광주광역시"]).toEqual(expect.arrayContaining(["동구", "서구", "남구", "북구", "광산구"]));
    expect(gazetteer["전라남도"]).toEqual(expect.arrayContaining(["목포시", "순천시"]));
  });

  it("does not add a duplicate '전남광주통합특별시' province key (would make bare city mentions newly ambiguous)", () => {
    expect(getGazetteer()["전남광주통합특별시"]).toBeUndefined();
  });

  it("resolves historical Incheon district names to 인천광역시, unchanged", () => {
    expect(resolveCityProvinces("중구")).toContain("인천광역시");
    expect(resolveCityProvinces("동구")).toContain("인천광역시");
    expect(resolveCityProvinces("서구")).toContain("인천광역시");
  });

  it("also resolves the new 2026-07-01 Incheon district names to 인천광역시", () => {
    expect(resolveCityProvinces("제물포구")).toEqual(["인천광역시"]);
    expect(resolveCityProvinces("영종구")).toEqual(["인천광역시"]);
    expect(resolveCityProvinces("검단구")).toEqual(["인천광역시"]);
    expect(resolveCityProvinces("서해구")).toEqual(["인천광역시"]);
  });

  it("resolves a bare former-전남 city name only to the historical province, never to the new merged name", () => {
    // No "전남광주통합특별시" duplicate entry exists, so this stays exactly as
    // unambiguous as it was before the merger — no new ambiguity introduced.
    expect(resolveCityProvinces("목포시")).toEqual(["전라남도"]);
  });
});
