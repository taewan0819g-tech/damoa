/**
 * READ-ONLY closed-beta readiness audit (Checkpoint: Damoa Closed-Beta
 * Readiness Audit). Re-runs the CURRENT (unmodified) matching/ranking
 * pipeline against the same frozen MOIS + Youth Center catalog snapshot
 * used by scripts/auditPersonalizationBaseline.ts, and against the exact
 * same server-side wiring app/api/benefits/match/route.ts uses for the Home
 * preview (matchBenefitsDetailed -> isRelevantForFeed -> getRecommendedBenefits
 * with excludeWeakUnknown -> getUnknownBenefits), so the reported Top-10
 * numbers match what a real beta user's Home page would render.
 *
 * ZERO network calls, ZERO production-code changes. Requires the three
 * frozen input files used by the original baseline audit; fails fast and
 * prints exactly what's missing otherwise.
 *
 * Run with:
 *   node --env-file=.env.local -r tsx/cjs scripts/auditBetaReadiness.ts
 *
 * Writes docs/audits/beta-readiness-personalization.json (committed).
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  normalizeMOISServiceListItem,
  normalizeMOISSupportConditions,
  type MOISRawServiceListItem,
  type MOISRawSupportCondition,
} from "../adapters/mois/MOISAdapter";
import { normalizeYouthPolicy, type YouthRawPolicy } from "../adapters/youthCenter/YouthAdapter";
import { matchBenefitsDetailed, isRelevantForFeed } from "../domain/eligibility/matchBenefits";
import { getRecommendedBenefits } from "../domain/benefit/recommend";
import { getUnknownBenefits } from "../domain/benefit/unknownBenefits";
import { matchesUserInterest, countUserInterestOverlap } from "../domain/benefit/topics";
import type { PersonalizationEvidence } from "../domain/benefit/personalization";
import type { Benefit, EligibilityStatus } from "../types/benefit";
import type { UserProfile } from "../types/profile";

const MOIS_LIST_PATH = "/tmp/mois_serviceList_full.json";
const MOIS_CONDITIONS_PATH = "/tmp/mois_supportConditions_full.json";
const YOUTH_PATH = "/tmp/youth_policy_full.json";
const ARTIFACT_PATH = path.join(__dirname, "../docs/audits/beta-readiness-personalization.json");

const REQUIRED_INPUTS = [
  { path: MOIS_LIST_PATH, label: "MOIS service list" },
  { path: MOIS_CONDITIONS_PATH, label: "MOIS support conditions" },
  { path: YOUTH_PATH, label: "Youth Center policy list" },
];

function sha256File(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

const HOME_PREVIEW_LIMIT = 10;

// Same six profiles as docs/beta-personalization-audit.md, for direct
// comparability with the pre-pass baseline.
const PROFILES: { key: string; label: string; profile: UserProfile }[] = [
  {
    key: "A_icheon_unemployed_youth",
    label: "이천시 청년 무직",
    profile: {
      birthDate: "2000-03-15",
      residence: { province: "경기도", city: "이천시" },
      maritalStatus: "single",
      employmentStatus: "unemployed",
      individualIncomeBand: "under_1000",
      homeowner: false,
      interests: ["employment", "housing", "asset_building"],
    },
  },
  {
    key: "B_seoul_university_student",
    label: "서울 대학생",
    profile: {
      birthDate: "2004-05-01",
      residence: { province: "서울특별시", city: "관악구" },
      maritalStatus: "single",
      employmentStatus: "student",
      educationStatus: "university",
      individualIncomeBand: "none",
      interests: ["education", "deposit", "savings"],
    },
  },
  {
    key: "C_suwon_high_income_employed",
    label: "수원시 직장인 고소득",
    profile: {
      birthDate: "1992-01-01",
      residence: { province: "경기도", city: "수원시" },
      maritalStatus: "single",
      employmentStatus: "employed",
      individualIncomeBand: "over_7000",
      homeowner: true,
      housingType: "own",
      interests: ["asset_building", "loan"],
    },
  },
  {
    key: "D_icheon_newlywed",
    label: "이천시 신혼부부",
    profile: {
      birthDate: "1996-06-01",
      residence: { province: "경기도", city: "이천시" },
      maritalStatus: "married",
      marriageDate: "2025-03-01",
      householdIncomeBand: "3000_4000",
      householdSize: 2,
      interests: ["housing", "childcare"],
    },
  },
  {
    key: "E_jeonnam_single_parent",
    label: "전남 한부모가족",
    profile: {
      birthDate: "1988-01-01",
      residence: { province: "전라남도" },
      maritalStatus: "divorced",
      singleParentFamily: true,
      employmentStatus: "freelancer",
      householdIncomeBand: "2000_3000",
      childrenCount: 1,
      interests: ["welfare", "childcare"],
    },
  },
  {
    key: "F_minimal_just_onboarded",
    label: "온보딩 직후 최소 입력",
    profile: { birthDate: "1998-01-01" },
  },
];

// Icheon-resident profiles for Youth region-leakage measurement (Section 4).
const ICHEON_PROFILE_KEYS = new Set(["A_icheon_unemployed_youth", "D_icheon_newlywed"]);

// Audit-only heuristic: Korean province/major-city name tokens. NEVER used
// for production eligibility — only to flag titles/orgs that *look*
// geographically scoped to somewhere other than the user's own city, for a
// human to review. A false positive/negative here has zero product effect.
const REGION_NAME_TOKENS = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "수원", "성남", "용인", "고양", "화성", "안산", "안양", "평택", "시흥", "김포", "광명", "군포", "이천",
  "전주", "청주", "천안", "포항", "창원", "제주", "춘천", "강릉",
  "여수", "순천", "목포", "구미", "경주", "진주", "충주", "원주",
];

function detectRegionToken(text: string, excludeToken: string): string | null {
  for (const t of REGION_NAME_TOKENS) {
    if (t === excludeToken) continue;
    if (text.includes(t)) return t;
  }
  return null;
}

function loadFrozenCatalog() {
  const missing = REQUIRED_INPUTS.filter((f) => !fs.existsSync(f.path));
  if (missing.length > 0) {
    console.error("Frozen input file(s) missing — this audit performs zero live fetches.");
    for (const m of missing) console.error(`  - ${m.label}: ${m.path}`);
    process.exit(1);
  }
  const moisRawList: MOISRawServiceListItem[] = JSON.parse(fs.readFileSync(MOIS_LIST_PATH, "utf8"));
  const moisRawConditions: MOISRawSupportCondition[] = JSON.parse(fs.readFileSync(MOIS_CONDITIONS_PATH, "utf8"));
  const youthRaw: YouthRawPolicy[] = JSON.parse(fs.readFileSync(YOUTH_PATH, "utf8"));
  const inputHashes = REQUIRED_INPUTS.map((f) => ({ label: f.label, path: f.path, sha256: sha256File(f.path) }));
  return { moisRawList, moisRawConditions, youthRaw, inputHashes };
}

function freq<T>(items: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const item of items) m.set(item, (m.get(item) ?? 0) + 1);
  return m;
}
function sortedFreq<T>(m: Map<T, number>): [T, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

async function main() {
  const { moisRawList, moisRawConditions, youthRaw, inputHashes } = loadFrozenCatalog();
  console.log(`Frozen snapshot: MOIS ${moisRawList.length} rows, Youth ${youthRaw.length} rows`);

  const conditionsById = new Map<string, MOISRawSupportCondition>();
  for (const row of moisRawConditions) conditionsById.set(row.서비스ID, row);

  const moisBenefits: Benefit[] = moisRawList.map((raw) => {
    const condRow = conditionsById.get(raw.서비스ID);
    const ageGroup = condRow ? normalizeMOISSupportConditions(condRow) : undefined;
    return normalizeMOISServiceListItem(raw, ageGroup);
  });
  const youthBenefits: Benefit[] = youthRaw.map(normalizeYouthPolicy);
  const allBenefits: Benefit[] = [...moisBenefits, ...youthBenefits];

  const perProfile = PROFILES.map(({ key, label, profile }) => {
    const detailed = matchBenefitsDetailed(allBenefits, profile);
    const statusById = new Map<string, EligibilityStatus>();
    const positiveEvidenceById = new Map<string, boolean>();
    const evidenceById = new Map<string, PersonalizationEvidence>();
    for (const m of detailed) {
      statusById.set(m.benefitId, m.status);
      positiveEvidenceById.set(m.benefitId, m.hasPositiveEvidence);
      evidenceById.set(m.benefitId, m.personalization);
    }

    let likelyEligible = 0, unknown = 0, notEligible = 0;
    for (const m of detailed) {
      if (m.status === "likely_eligible") likelyEligible++;
      else if (m.status === "not_eligible") notEligible++;
      else unknown++;
    }

    const relevant = allBenefits.filter((b) => isRelevantForFeed(statusById.get(b.id)!, positiveEvidenceById.get(b.id)!));

    // Exactly mirrors app/api/benefits/match/route.ts's non-paginated (Home) shape.
    const recommended = getRecommendedBenefits(relevant, statusById, profile, HOME_PREVIEW_LIMIT, {
      evidenceById,
      excludeWeakUnknown: true,
    });
    const excludeIds = new Set(recommended.map((b) => b.id));
    const needsReview = getUnknownBenefits(relevant, statusById, profile, HOME_PREVIEW_LIMIT, { excludeIds, evidenceById });
    const recommendedUnknownCount = recommended.filter((b) => statusById.get(b.id) === "unknown").length;

    // Top-10 = the actual Home "recommended" bucket a beta user sees.
    const selectedInterests = profile.interests ?? [];
    const top10Detail = recommended.map((b) => {
      const ev = evidenceById.get(b.id)!;
      return {
        id: b.id, title: b.title, source: b.source.type, status: statusById.get(b.id),
        strength: ev.strength, dimensions: ev.dimensions, regionSpecificity: ev.regionSpecificity,
        interestMatch: matchesUserInterest(b, new Set(selectedInterests)),
        interestOverlapCount: countUserInterestOverlap(b, selectedInterests),
        matchedInterests: selectedInterests.filter((i) => countUserInterestOverlap(b, [i]) === 1),
      };
    });
    const top10StrengthFreq = sortedFreq(freq(top10Detail.map((b) => b.strength)));
    const top10SourceFreq = sortedFreq(freq(top10Detail.map((b) => b.source)));
    const top10RegionEvidenceCount = top10Detail.filter((b) => b.regionSpecificity !== "none").length;
    const top10InterestOverlapCount = top10Detail.filter((b) => b.interestMatch).length;
    const top10DimensionFreq = sortedFreq(freq(top10Detail.flatMap((b) => b.dimensions)));

    // Top-20 (full-discovery ranking, not the excludeWeakUnknown-bounded Home
    // preview) — used only for the Youth region-leakage measurement below.
    const top20 = getRecommendedBenefits(relevant, statusById, profile, 20, { evidenceById });

    let youthLeakage: ReturnType<typeof measureYouthLeakage> | null = null;
    if (ICHEON_PROFILE_KEYS.has(key)) {
      youthLeakage = measureYouthLeakage(relevant, recommended, top20, profile, evidenceById);
    }

    return {
      key, label,
      totals: { likelyEligible, unknown, notEligible, totalCatalog: allBenefits.length },
      relevantFeedSize: relevant.length,
      homePreview: {
        recommendedCount: recommended.length,
        recommendedUnknownCount,
        needsReviewCount: needsReview.length,
      },
      top10: {
        strengthFreq: top10StrengthFreq,
        dimensionFreq: top10DimensionFreq,
        sourceFreq: top10SourceFreq,
        regionEvidenceCount: top10RegionEvidenceCount,
        interestOverlapCount: top10InterestOverlapCount,
        detail: top10Detail,
      },
      youthLeakage,
    };
  });

  function measureYouthLeakage(
    relevant: Benefit[],
    recommended: Benefit[],
    top20: Benefit[],
    profile: UserProfile,
    evidenceById: Map<string, PersonalizationEvidence>
  ) {
    const userCity = profile.residence?.city ?? "";
    const isYouth = (b: Benefit) => b.source.type === "youth_policy";
    const noRegionEvidence = (b: Benefit) => (evidenceById.get(b.id)?.regionSpecificity ?? "none") === "none";

    function suspiciousLocal(b: Benefit) {
      if (!isYouth(b) || !noRegionEvidence(b)) return null;
      const text = `${b.title} ${b.source.organization ?? ""} ${b.institution?.name ?? ""}`;
      const token = detectRegionToken(text, userCity);
      return token ? { id: b.id, title: b.title, org: b.source.organization, matchedToken: token } : null;
    }

    const relevantYouthCount = relevant.filter(isYouth).length;
    const top10YouthCount = recommended.filter(isYouth).length;
    const top20YouthCount = top20.filter(isYouth).length;

    const relevantSuspicious = relevant.map(suspiciousLocal).filter((x): x is NonNullable<typeof x> => x !== null);
    const top10Suspicious = recommended.map(suspiciousLocal).filter((x): x is NonNullable<typeof x> => x !== null);
    const top20Suspicious = top20.map(suspiciousLocal).filter((x): x is NonNullable<typeof x> => x !== null);

    return {
      relevantYouthCount, top10YouthCount, top20YouthCount,
      relevantSuspiciousLocalCount: relevantSuspicious.length,
      top10SuspiciousLocalCount: top10Suspicious.length,
      top20SuspiciousLocalCount: top20Suspicious.length,
      top20SuspiciousSamples: top20Suspicious.slice(0, 10),
    };
  }

  const artifact = {
    generatedAt: new Date().toISOString(),
    frozenInputs: inputHashes,
    snapshot: { moisCount: moisRawList.length, youthCount: youthRaw.length, totalCount: allBenefits.length },
    profiles: perProfile,
  };
  fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
  fs.writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2));
  console.log(`Written to ${ARTIFACT_PATH}`);

  console.table(
    perProfile.map((p) => ({
      profile: p.key,
      likely_eligible: p.totals.likelyEligible,
      unknown: p.totals.unknown,
      not_eligible: p.totals.notEligible,
      relevantFeed: p.relevantFeedSize,
      homeRecommended: p.homePreview.recommendedCount,
      homeRecUnknownPct: p.homePreview.recommendedCount ? Math.round((p.homePreview.recommendedUnknownCount / p.homePreview.recommendedCount) * 100) : 0,
      needsReview: p.homePreview.needsReviewCount,
    }))
  );
  for (const p of perProfile) {
    if (p.youthLeakage) {
      console.log(`\n--- Youth leakage: ${p.key} ---`);
      console.log(p.youthLeakage);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
