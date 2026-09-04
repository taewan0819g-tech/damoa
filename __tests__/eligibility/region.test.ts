import { describe, expect, it } from "vitest";
import { matchRegion, normalizeProvince } from "@/lib/eligibility/region";

describe("matchRegion", () => {
  it("returns unknown when the user has no residence info at all", () => {
    expect(matchRegion(undefined, [{ province: "서울특별시" }])).toBe("unknown");
    expect(matchRegion({}, [{ province: "서울특별시" }])).toBe("unknown");
  });

  it("fails when the user's province isn't in the allowed list at all", () => {
    const result = matchRegion({ province: "부산광역시" }, [{ province: "서울특별시" }]);
    expect(result).toBe("fail");
  });

  it("passes when a spec allows the whole province and the user's province matches", () => {
    const result = matchRegion({ province: "경기도" }, [{ province: "경기도" }]);
    expect(result).toBe("pass");
  });

  it("passes when a city-level spec matches both province and city", () => {
    const result = matchRegion({ province: "경기도", city: "이천시" }, [{ province: "경기도", city: "이천시" }]);
    expect(result).toBe("pass");
  });

  it("fails when the province matches a city-level spec but the known city doesn't", () => {
    const result = matchRegion({ province: "경기도", city: "수원시" }, [{ province: "경기도", city: "이천시" }]);
    expect(result).toBe("fail");
  });

  it("resolves to unknown when the province matches a city-level spec but the city is unknown", () => {
    const result = matchRegion({ province: "경기도" }, [{ province: "경기도", city: "이천시" }]);
    expect(result).toBe("unknown");
  });

  it("passes when the user's region matches any entry in a multi-region OR list", () => {
    const allowed = [{ province: "서울특별시" }, { province: "경기도", city: "이천시" }];
    expect(matchRegion({ province: "경기도", city: "이천시" }, allowed)).toBe("pass");
  });

  it("normalizes common province aliases (경기 vs 경기도, 서울 vs 서울특별시)", () => {
    expect(normalizeProvince("경기")).toBe("경기도");
    expect(normalizeProvince("서울")).toBe("서울특별시");
    expect(matchRegion({ province: "경기" }, [{ province: "경기도" }])).toBe("pass");
    expect(matchRegion({ province: "서울" }, [{ province: "서울특별시" }])).toBe("pass");
  });
});

/**
 * Checkpoint: Canonical Province/City Input + Gazetteer Freshness Hardening.
 *
 * matchRegion() itself is explicitly frozen this checkpoint — only the UI
 * layer changed, to guarantee it always feeds matchRegion() canonical
 * strings. These three cases are the checkpoint's required frozen-behavior
 * proof for a 경기도/이천시 resident: PASS against a province-wide policy,
 * PASS against an 이천시-specific policy, FAIL against a different city's
 * policy in the same province.
 */
describe("matchRegion — Icheon resident frozen-behavior regression (Checkpoint: canonical region input)", () => {
  const icheonResident = { province: "경기도", city: "이천시" };

  it("9. 경기도/이천시 resident vs a 경기도-wide policy => pass", () => {
    expect(matchRegion(icheonResident, [{ province: "경기도" }])).toBe("pass");
  });

  it("10. 경기도/이천시 resident vs a 경기도/이천시-specific policy => pass", () => {
    expect(matchRegion(icheonResident, [{ province: "경기도", city: "이천시" }])).toBe("pass");
  });

  it("11. 경기도/이천시 resident vs a 경기도/수원시-specific policy => fail", () => {
    expect(matchRegion(icheonResident, [{ province: "경기도", city: "수원시" }])).toBe("fail");
  });
});

/**
 * Checkpoint: Corrective Region Architecture (province-level string identity
 * — SUPERSEDED for the two province-only cross-cases below by Checkpoint:
 * Final Region Transition Compatibility, see the describe block further down
 * this file. `normalizeProvince`/`PROVINCE_ALIASES` still never treats
 * 전남광주통합특별시 as a string-level alias of 광주광역시/전라남도 — that part
 * is unchanged and re-asserted here. What changed is `matchRegion` itself:
 * it no longer requires exact province-string equality. Since the merger is
 * geographically LOSSLESS (every inch of both old provinces is provably
 * inside the new one), a legacy resident with no city specified passing a
 * new-province-wide (no city) policy — and vice versa — is genuine set
 * containment (U ⊆ P), not a guessed alias bridge. See
 * domain/region/adminTransition.ts and the
 * "administrative transition compatibility" describe block below for the
 * full model and its required examples.
 */
describe("matchRegion — 전남광주통합특별시 merger (province name is a distinct string, never string-aliased)", () => {
  it("normalizes 전남광주통합특별시 to itself (never to/from 광주광역시 or 전라남도)", () => {
    expect(normalizeProvince("전남광주통합특별시")).toBe("전남광주통합특별시");
  });

  it("a 전남광주통합특별시 resident passes a 전남광주통합특별시-wide policy", () => {
    expect(matchRegion({ province: "전남광주통합특별시" }, [{ province: "전남광주통합특별시" }])).toBe("pass");
  });

  it("a 광주광역시 resident (no city) passes a 전남광주통합특별시-wide policy — lossless merge, genuine containment, not a string alias (see Checkpoint: Final Region Transition Compatibility)", () => {
    expect(matchRegion({ province: "광주광역시" }, [{ province: "전남광주통합특별시" }])).toBe("pass");
  });

  it("a 전남광주통합특별시 resident with no city is unknown (not pass, not fail) against a still-old-named 전라남도-wide policy — can't prove which old province's territory they're in", () => {
    expect(matchRegion({ province: "전남광주통합특별시" }, [{ province: "전라남도" }])).toBe("unknown");
  });

  it("a 광주광역시 resident still matches an unchanged 광주광역시-specific policy", () => {
    expect(matchRegion({ province: "광주광역시" }, [{ province: "광주광역시" }])).toBe("pass");
  });
});

/**
 * Checkpoint: Final Region Transition Compatibility.
 *
 * matchRegion() previously required exact province/city equality, which
 * hard-FAILED a current-name resident against an old-name policy (and vice
 * versa) even when the two provably refer to overlapping or identical
 * real-world territory. This block proves the fix: Damoa's
 * constraint-compatibility principle (U = user territory, P = policy
 * territory) — U ∩ P = ∅ => fail, U ∩ P != ∅ and U ⊄ P => unknown,
 * U ⊆ P => pass — applied to the two verified 2026-07-01 administrative
 * transitions via `domain/region/adminTransition.ts`. Old/new names are
 * still never treated as simple string aliases (see that module's header).
 */
describe("matchRegion — administrative transition compatibility (Checkpoint: Final Region Transition Compatibility)", () => {
  describe("전남광주통합특별시 merger — required checkpoint examples", () => {
    it("전남광주통합특별시/목포시 resident passes a still-old-named 전라남도-wide policy", () => {
      expect(
        matchRegion({ province: "전남광주통합특별시", city: "목포시" }, [{ province: "전라남도" }])
      ).toBe("pass");
    });

    it("전남광주통합특별시/광산구 resident FAILS a still-old-named 전라남도-wide policy (wrong heritage)", () => {
      expect(
        matchRegion({ province: "전남광주통합특별시", city: "광산구" }, [{ province: "전라남도" }])
      ).toBe("fail");
    });

    it("전남광주통합특별시 resident with no city is unknown against a still-old-named 전라남도-wide policy", () => {
      expect(matchRegion({ province: "전남광주통합특별시" }, [{ province: "전라남도" }])).toBe("unknown");
    });

    it("legacy 전라남도/목포시 resident passes a policy now expressed with the new merged province name", () => {
      expect(
        matchRegion({ province: "전라남도", city: "목포시" }, [{ province: "전남광주통합특별시" }])
      ).toBe("pass");
    });
  });

  describe("인천 구제 개편 — required checkpoint examples", () => {
    it("영종구 (new) resident passes an old-named 중구 policy (영종구 wholly inside old 중구)", () => {
      expect(matchRegion({ province: "인천광역시", city: "영종구" }, [{ province: "인천광역시", city: "중구" }])).toBe(
        "pass"
      );
    });

    it("제물포구 (new) resident is unknown against an old-named 중구 policy (제물포구 also drew from old 동구)", () => {
      expect(
        matchRegion({ province: "인천광역시", city: "제물포구" }, [{ province: "인천광역시", city: "중구" }])
      ).toBe("unknown");
    });

    it("제물포구 (new) resident is unknown against an old-named 동구 policy", () => {
      expect(
        matchRegion({ province: "인천광역시", city: "제물포구" }, [{ province: "인천광역시", city: "동구" }])
      ).toBe("unknown");
    });

    it("서해구/검단구 (new) residents both pass an old-named 서구 policy (both wholly inside old 서구)", () => {
      expect(
        matchRegion({ province: "인천광역시", city: "서해구" }, [{ province: "인천광역시", city: "서구" }])
      ).toBe("pass");
      expect(
        matchRegion({ province: "인천광역시", city: "검단구" }, [{ province: "인천광역시", city: "서구" }])
      ).toBe("pass");
    });

    it("legacy 중구 resident is unknown against a new-named 영종구 policy (old 중구 is bigger than just 영종구)", () => {
      expect(
        matchRegion({ province: "인천광역시", city: "중구" }, [{ province: "인천광역시", city: "영종구" }])
      ).toBe("unknown");
    });

    it("legacy 동구 resident passes a new-named 제물포구 policy (all of old 동구 became part of 제물포구)", () => {
      expect(
        matchRegion({ province: "인천광역시", city: "동구" }, [{ province: "인천광역시", city: "제물포구" }])
      ).toBe("pass");
    });

    it("legacy 서구 resident is unknown against a new-named 서해구 policy (old 서구 split into both 서해구 AND 검단구)", () => {
      expect(
        matchRegion({ province: "인천광역시", city: "서구" }, [{ province: "인천광역시", city: "서해구" }])
      ).toBe("unknown");
    });
  });

  describe("safety: no fuzzy matching, no aliasing, unmodeled pairs stay ordinary exact-match", () => {
    it("clearly disjoint territories remain fail (unrelated province, no transition applies)", () => {
      expect(matchRegion({ province: "서울특별시" }, [{ province: "전라남도" }])).toBe("fail");
      expect(matchRegion({ province: "전남광주통합특별시", city: "목포시" }, [{ province: "서울특별시" }])).toBe(
        "fail"
      );
    });

    it("an unaffected Incheon district never gains a transition relation to an unrelated old/new district", () => {
      expect(
        matchRegion({ province: "인천광역시", city: "미추홀구" }, [{ province: "인천광역시", city: "중구" }])
      ).toBe("fail");
      expect(
        matchRegion({ province: "인천광역시", city: "영종구" }, [{ province: "인천광역시", city: "미추홀구" }])
      ).toBe("fail");
    });

    it("old<->old and new<->new pairs within the merger are still ordinary exact match, not a transition relation", () => {
      expect(matchRegion({ province: "광주광역시", city: "동구" }, [{ province: "전라남도", city: "목포시" }])).toBe(
        "fail"
      );
      expect(
        matchRegion({ province: "전남광주통합특별시", city: "목포시" }, [
          { province: "전남광주통합특별시", city: "순천시" },
        ])
      ).toBe("fail");
    });

    it("current/current exact match remains an ordinary pass (unaffected by the transition layer)", () => {
      expect(
        matchRegion({ province: "전남광주통합특별시", city: "목포시" }, [
          { province: "전남광주통합특별시", city: "목포시" },
        ])
      ).toBe("pass");
      expect(
        matchRegion({ province: "인천광역시", city: "영종구" }, [{ province: "인천광역시", city: "영종구" }])
      ).toBe("pass");
    });
  });

  describe("frozen-behavior regression: unchanged regions behave exactly as before this checkpoint", () => {
    const icheonResident = { province: "경기도", city: "이천시" };

    it("경기도/이천시 resident vs a 경기도-wide policy => pass (unchanged)", () => {
      expect(matchRegion(icheonResident, [{ province: "경기도" }])).toBe("pass");
    });

    it("경기도/이천시 resident vs a 경기도/이천시-specific policy => pass (unchanged)", () => {
      expect(matchRegion(icheonResident, [{ province: "경기도", city: "이천시" }])).toBe("pass");
    });

    it("경기도/이천시 resident vs a 경기도/수원시-specific policy => fail (unchanged)", () => {
      expect(matchRegion(icheonResident, [{ province: "경기도", city: "수원시" }])).toBe("fail");
    });

    it("no residence info at all is still unknown (unchanged)", () => {
      expect(matchRegion(undefined, [{ province: "서울특별시" }])).toBe("unknown");
    });

    it("province alias normalization still works alongside the new transition logic", () => {
      expect(matchRegion({ province: "경기" }, [{ province: "경기도" }])).toBe("pass");
    });
  });
});

/**
 * Checkpoint: Final tiny Region OR-union hardening.
 *
 * `allowed: RegionSpec[]` is an OR list, so the policy's true territory P is
 * the UNION of every allowed spec, not any single spec evaluated in
 * isolation. These cases prove `matchRegion` now unions overlapping specs
 * before falling back to "unknown"/"fail" — while a single overlapping
 * alternative alone still correctly stays "unknown" (no over-inference from
 * partial coverage).
 */
describe("matchRegion — OR-union completion (Checkpoint: Final tiny Region OR-union hardening)", () => {
  it("A: merged province user + [old 광주광역시, old 전라남도] together -> pass", () => {
    expect(
      matchRegion({ province: "전남광주통합특별시" }, [{ province: "광주광역시" }, { province: "전라남도" }])
    ).toBe("pass");
  });

  it("B: merged province user + [old 광주광역시] alone -> unknown", () => {
    expect(matchRegion({ province: "전남광주통합특별시" }, [{ province: "광주광역시" }])).toBe("unknown");
  });

  it("C: 제물포구 user + [old 중구, old 동구] together -> pass", () => {
    expect(
      matchRegion({ province: "인천광역시", city: "제물포구" }, [
        { province: "인천광역시", city: "중구" },
        { province: "인천광역시", city: "동구" },
      ])
    ).toBe("pass");
  });

  it("D: 제물포구 user + [old 중구] alone -> unknown", () => {
    expect(
      matchRegion({ province: "인천광역시", city: "제물포구" }, [{ province: "인천광역시", city: "중구" }])
    ).toBe("unknown");
  });

  it("E: old 서구 user + [현재 서해구, 현재 검단구] together -> pass", () => {
    expect(
      matchRegion({ province: "인천광역시", city: "서구" }, [
        { province: "인천광역시", city: "서해구" },
        { province: "인천광역시", city: "검단구" },
      ])
    ).toBe("pass");
  });

  it("F: old 서구 user + [현재 서해구] alone -> unknown", () => {
    expect(
      matchRegion({ province: "인천광역시", city: "서구" }, [{ province: "인천광역시", city: "서해구" }])
    ).toBe("unknown");
  });

  it("G: old 중구 user + [현재 영종구, 현재 제물포구] together -> pass", () => {
    expect(
      matchRegion({ province: "인천광역시", city: "중구" }, [
        { province: "인천광역시", city: "영종구" },
        { province: "인천광역시", city: "제물포구" },
      ])
    ).toBe("pass");
  });

  it("H: ordinary unrelated multi-region OR behavior is unchanged", () => {
    expect(
      matchRegion({ province: "부산광역시" }, [{ province: "서울특별시" }, { province: "대구광역시" }])
    ).toBe("fail");
    expect(
      matchRegion({ province: "경기도", city: "이천시" }, [
        { province: "서울특별시" },
        { province: "경기도", city: "이천시" },
      ])
    ).toBe("pass");
  });

  it("I: exact Icheon/Gyeonggi regressions unchanged", () => {
    const icheonResident = { province: "경기도", city: "이천시" };
    expect(matchRegion(icheonResident, [{ province: "경기도" }])).toBe("pass");
    expect(matchRegion(icheonResident, [{ province: "경기도", city: "이천시" }])).toBe("pass");
    expect(matchRegion(icheonResident, [{ province: "경기도", city: "수원시" }])).toBe("fail");
  });

  it("J: no fuzzy matching introduced — unmodeled multi-spec combos stay unknown/fail, never silently pass", () => {
    // 미추홀구 is an unaffected district; combining it with a transitioned
    // spec must not manufacture a false "pass".
    expect(
      matchRegion({ province: "인천광역시", city: "미추홀구" }, [
        { province: "인천광역시", city: "중구" },
        { province: "인천광역시", city: "동구" },
      ])
    ).toBe("fail");
    // A spec combo not in UNION_PARTITIONS (중구 + 영종구, not 중구 + 동구) must
    // not be treated as covering 제물포구 -> stays unknown, never a false "pass".
    expect(
      matchRegion({ province: "인천광역시", city: "제물포구" }, [
        { province: "인천광역시", city: "중구" },
        { province: "인천광역시", city: "영종구" },
      ])
    ).toBe("unknown");
  });
});
