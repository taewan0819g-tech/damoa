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
