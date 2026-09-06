import { describe, expect, it } from "vitest";
import {
  isSubdividedParentCity,
  PARENT_CITY_SUBDIVISIONS,
  subdivisionUnionCoversUser,
} from "@/domain/region/subdivisionPartition";

/**
 * Checkpoint: Youth zipCd structured region eligibility (subdivision
 * constraint-compatibility correction).
 *
 * Table-driven proof of the authoritative parent-city/subordinate-gu
 * partition and the OR-union coverage check `matchRegion` relies on to ever
 * turn a subdivision-only OR-list into a "pass".
 */
describe("PARENT_CITY_SUBDIVISIONS — official 13-city roster", () => {
  it("covers exactly the 13 known gu-bearing 일반시, matching CURRENT_RESIDENCE_GAZETTEER's flat entries", () => {
    const expected: [string, string, number][] = [
      ["경기도", "수원시", 4],
      ["경기도", "성남시", 3],
      ["경기도", "안양시", 2],
      ["경기도", "부천시", 3],
      ["경기도", "안산시", 2],
      ["경기도", "고양시", 3],
      ["경기도", "용인시", 3],
      ["경기도", "화성시", 4],
      ["충청북도", "청주시", 4],
      ["충청남도", "천안시", 2],
      ["경상북도", "포항시", 2],
      ["경상남도", "창원시", 5],
      ["전북특별자치도", "전주시", 2],
    ];
    let total = 0;
    for (const [province, city, count] of expected) {
      const gu = PARENT_CITY_SUBDIVISIONS[province]?.[city];
      expect(gu).toBeDefined();
      expect(gu?.length).toBe(count);
      total += count;
    }
    expect(total).toBe(39);
  });

  it("isSubdividedParentCity is true only for the 13 known cities, not for ordinary cities/metro districts", () => {
    expect(isSubdividedParentCity("경기도", "수원시")).toBe(true);
    expect(isSubdividedParentCity("경기도", "이천시")).toBe(false);
    expect(isSubdividedParentCity("서울특별시", "종로구")).toBe(false);
    expect(isSubdividedParentCity("인천광역시", "제물포구")).toBe(false);
    expect(isSubdividedParentCity("전남광주통합특별시", "남구")).toBe(false);
  });
});

describe("subdivisionUnionCoversUser", () => {
  const suwon = { province: "경기도", city: "수원시" };

  it("returns false for a single subdivision spec (never full coverage alone)", () => {
    expect(subdivisionUnionCoversUser(suwon, [{ province: "경기도", city: "수원시", subdivision: "장안구" }])).toBe(
      false
    );
  });

  it("returns false for a partial subset of the city's gu", () => {
    expect(
      subdivisionUnionCoversUser(suwon, [
        { province: "경기도", city: "수원시", subdivision: "장안구" },
        { province: "경기도", city: "수원시", subdivision: "권선구" },
      ])
    ).toBe(false);
  });

  it("returns true once every current gu of the city is present", () => {
    expect(
      subdivisionUnionCoversUser(suwon, [
        { province: "경기도", city: "수원시", subdivision: "장안구" },
        { province: "경기도", city: "수원시", subdivision: "권선구" },
        { province: "경기도", city: "수원시", subdivision: "팔달구" },
        { province: "경기도", city: "수원시", subdivision: "영통구" },
      ])
    ).toBe(true);
  });

  it("ignores specs for a different city even if they'd otherwise complete the set", () => {
    expect(
      subdivisionUnionCoversUser(suwon, [
        { province: "경기도", city: "수원시", subdivision: "장안구" },
        { province: "경기도", city: "수원시", subdivision: "권선구" },
        { province: "경기도", city: "수원시", subdivision: "팔달구" },
        { province: "경기도", city: "성남시", subdivision: "분당구" }, // wrong city, doesn't count
      ])
    ).toBe(false);
  });

  it("returns false for a city with no known partition (never invents coverage facts)", () => {
    expect(
      subdivisionUnionCoversUser(
        { province: "경기도", city: "이천시" },
        [{ province: "경기도", city: "이천시", subdivision: "어딘가" }]
      )
    ).toBe(false);
  });
});
