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
