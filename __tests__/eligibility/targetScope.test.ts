import { describe, expect, it } from "vitest";
import { matchTargetScope, parseMOISUserScope } from "@/lib/eligibility/targetScope";
import type { UserProfile } from "@/types/profile";

describe("parseMOISUserScope", () => {
  it("returns undefined for blank/missing input", () => {
    expect(parseMOISUserScope(undefined)).toBeUndefined();
    expect(parseMOISUserScope(null)).toBeUndefined();
    expect(parseMOISUserScope("")).toBeUndefined();
    expect(parseMOISUserScope("   ")).toBeUndefined();
  });

  it("parses each of the four verified single tokens", () => {
    expect(parseMOISUserScope("개인")).toEqual(["individual"]);
    expect(parseMOISUserScope("가구")).toEqual(["household"]);
    expect(parseMOISUserScope("법인/시설/단체")).toEqual(["corporate"]);
    expect(parseMOISUserScope("소상공인")).toEqual(["small_business_owner"]);
  });

  it("parses '||'-delimited OR combinations", () => {
    expect(parseMOISUserScope("개인||가구")).toEqual(["individual", "household"]);
    expect(parseMOISUserScope("소상공인||법인/시설/단체")).toEqual(["small_business_owner", "corporate"]);
  });

  it("returns undefined (fail-safe) when any token is unrecognized", () => {
    expect(parseMOISUserScope("개인||외국인")).toBeUndefined();
    expect(parseMOISUserScope("전체")).toBeUndefined();
  });
});

describe("matchTargetScope", () => {
  const profile: UserProfile = {};

  it("returns unknown for an empty scopes list", () => {
    expect(matchTargetScope(profile, [])).toBe("unknown");
  });

  it("passes for any personal user when 개인 is present, regardless of other listed scopes", () => {
    expect(matchTargetScope(profile, ["individual"])).toBe("pass");
    expect(matchTargetScope(profile, ["corporate", "individual"])).toBe("pass");
  });

  it("passes for any personal user when 가구 is present", () => {
    expect(matchTargetScope(profile, ["household"])).toBe("pass");
  });

  it("resolves 소상공인-only against businessOwner", () => {
    expect(matchTargetScope({ businessOwner: true }, ["small_business_owner"])).toBe("pass");
    expect(matchTargetScope({ businessOwner: false }, ["small_business_owner"])).toBe("fail");
    expect(matchTargetScope({}, ["small_business_owner"])).toBe("unknown");
  });

  it("fails 법인/시설/단체-only for a personal user profile", () => {
    expect(matchTargetScope(profile, ["corporate"])).toBe("fail");
  });

  it("passes 소상공인||법인/시설/단체 for a confirmed business owner (either scope satisfied)", () => {
    expect(matchTargetScope({ businessOwner: true }, ["small_business_owner", "corporate"])).toBe("pass");
  });

  it("fails 소상공인||법인/시설/단체 for a confirmed non-business-owner (neither scope reachable by a person)", () => {
    expect(matchTargetScope({ businessOwner: false }, ["small_business_owner", "corporate"])).toBe("fail");
  });
});
