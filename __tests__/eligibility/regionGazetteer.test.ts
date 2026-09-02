import { describe, expect, it } from "vitest";
import {
  GAZETTEER_METADATA,
  getGazetteer,
  getShortDistrictNames,
  isUnambiguousCity,
  resolveCityProvinces,
} from "@/lib/eligibility/regionGazetteer";
import { normalizeProvince } from "@/lib/eligibility/region";

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
