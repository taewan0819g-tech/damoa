import { describe, expect, it } from "vitest";
import { calculateAge } from "@/domain/profile/age";

/**
 * Domain-level boundary tests for calculateAge — Korean "만 나이", computed
 * entirely from integer year/month/day calendar components under the fixed
 * Asia/Seoul policy calendar (see lib/dates/policyDate.ts). Every reference
 * instant is constructed with an EXPLICIT UTC offset, never a local
 * multi-arg `Date(y, m, d)` constructor, so the assertions are correct
 * regardless of the test runner's own machine timezone.
 */
describe("calculateAge", () => {
  it("birthday exactly today -> age increments on the birthday itself", () => {
    const ref = new Date("2026-09-03T00:30:00+09:00"); // policy date 2026-09-03
    expect(calculateAge("2000-09-03", ref)).toBe(26);
  });

  it("one day before the birthday -> age has not yet incremented", () => {
    const ref = new Date("2026-09-02T00:30:00+09:00"); // policy date 2026-09-02
    expect(calculateAge("2000-09-03", ref)).toBe(25);
  });

  it("one day after the birthday -> age already incremented", () => {
    const ref = new Date("2026-09-04T00:30:00+09:00"); // policy date 2026-09-04
    expect(calculateAge("2000-09-03", ref)).toBe(26);
  });

  it("uses the Asia/Seoul calendar day even when the UTC day disagrees", () => {
    // 2026-09-02T15:30:00Z == 2026-09-03T00:30:00+09:00 — UTC still reads
    // Sep 2 (age not yet incremented if read as UTC), but the Korean policy
    // calendar has already rolled to Sep 3 (birthday reached).
    const refKstSep3UtcSep2 = new Date("2026-09-02T15:30:00Z");
    expect(calculateAge("2000-09-03", refKstSep3UtcSep2)).toBe(26);
  });

  it("a Feb 29 birthday, evaluated in a non-leap year, only increments once Mar 1 policy-date is reached", () => {
    // Birth: 2000-02-29. Reference: 2026-02-28 (policy date) -> birthday not
    // yet reached under month*100+day comparison (0229 > 0228).
    const refFeb28 = new Date("2026-02-28T00:30:00+09:00");
    expect(calculateAge("2000-02-29", refFeb28)).toBe(25);

    // Reference: 2026-03-01 (policy date) -> birthday (0229) has passed
    // (0301 > 0229), age increments.
    const refMar1 = new Date("2026-03-01T00:30:00+09:00");
    expect(calculateAge("2000-02-29", refMar1)).toBe(26);
  });

  it("a Feb 29 birthday evaluated in an actual leap year on the birthday itself -> age increments", () => {
    const refFeb29 = new Date("2024-02-29T00:30:00+09:00");
    expect(calculateAge("2000-02-29", refFeb29)).toBe(24);
  });

  it("missing birthDate -> null", () => {
    expect(calculateAge(undefined)).toBeNull();
  });

  it("malformed/invalid birthDate -> null", () => {
    const ref = new Date("2026-09-03T00:30:00+09:00");
    expect(calculateAge("not-a-date", ref)).toBeNull();
    expect(calculateAge("2026-02-30", ref)).toBeNull();
  });

  it("future birthDate -> null, never a negative age", () => {
    const ref = new Date("2026-09-03T00:30:00+09:00"); // policy date 2026-09-03
    expect(calculateAge("2026-09-04", ref)).toBeNull();
  });

  it("a future birthDate that is future only by the KST calendar (still 'today' in UTC) -> null", () => {
    // ref is Sep 3 KST / Sep 2 UTC. birthDate "2026-09-03" is exactly the
    // KST reference day (age 0, not future); "2026-09-04" is future under
    // the correct KST reading even though it's still Sep 2 in UTC.
    const refKstSep3UtcSep2 = new Date("2026-09-02T15:30:00Z");
    expect(calculateAge("2026-09-03", refKstSep3UtcSep2)).toBe(0);
    expect(calculateAge("2026-09-04", refKstSep3UtcSep2)).toBeNull();
  });
});
