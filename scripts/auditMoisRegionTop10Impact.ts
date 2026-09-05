/**
 * READ-ONLY before/after Top-10 impact audit for the MOIS region-clause
 * binding precision fix (see lib/eligibility/extraction/koreanEligibilityParser.ts
 * and docs/audits/mois-region-binding-precision.json).
 *
 * Runs the SAME six profiles / SAME matching+ranking pipeline as
 * scripts/auditBetaReadiness.ts twice against the frozen catalog:
 *   BEFORE: adapters/mois/MOISAdapterOld.ts (temporary git-blob snapshot of
 *           MOISAdapter.ts wired to the temporary pre-fix parser snapshot
 *           lib/eligibility/extraction/koreanEligibilityParserOld.ts)
 *   AFTER:  adapters/mois/MOISAdapter.ts (current, fixed)
 * Diffs each profile's Top-10 (Home preview) benefit ID list, and separately
 * scans ALL MOIS items in Top-10/Top-20 (both runs) for titles/providers
 * that look geographically local to somewhere incompatible with the
 * profile's residence -- METADATA-ONLY audit heuristic, never used for
 * production eligibility logic.
 *
 * ZERO network calls, ZERO production-code changes (MOISAdapterOld.ts /
 * koreanEligibilityParserOld.ts are temporary, uncommitted snapshots deleted
 * at the end of this checkpoint).
 *
 * Prerequisite (temporary, not committed — see the same-named prerequisite
 * in scripts/auditMoisRegionBindingPrecision.ts for koreanEligibilityParserOld.ts):
 *   git show fcca37277703a65f9f45f90130b8d9482fdb7c2d:lib/eligibility/extraction/koreanEligibilityParser.ts \
 *     > lib/eligibility/extraction/koreanEligibilityParserOld.ts
 *   sed 's#@/lib/eligibility/extraction/koreanEligibilityParser"#@/lib/eligibility/extraction/koreanEligibilityParserOld"#' \
 *     adapters/mois/MOISAdapter.ts > adapters/mois/MOISAdapterOld.ts
 * Loaded via a runtime `require()` (not a static `import`) so typecheck
 * never needs these temporary files to exist on disk.
 *
 * Writes docs/audits/mois-region-top10-impact.json (committed).
 */
import fs from "fs";
import path from "path";
import {
  normalizeMOISServiceListItem,
  normalizeMOISSupportConditions,
  type MOISRawServiceListItem,
  type MOISRawSupportCondition,
} from "../adapters/mois/MOISAdapter";
import { normalizeYouthPolicy, type YouthRawPolicy } from "../adapters/youthCenter/YouthAdapter";
import { matchBenefitsDetailed, isRelevantForFeed } from "../domain/eligibility/matchBenefits";
import { getRecommendedBenefits } from "../domain/benefit/recommend";
import type { PersonalizationEvidence } from "../domain/benefit/personalization";
import type { Benefit, EligibilityStatus } from "../types/benefit";
import type { UserProfile } from "../types/profile";

const MOIS_LIST_PATH = "/tmp/mois_serviceList_full.json";
const MOIS_CONDITIONS_PATH = "/tmp/mois_supportConditions_full.json";
const YOUTH_PATH = "/tmp/youth_policy_full.json";
const ARTIFACT_PATH = path.join(__dirname, "../docs/audits/mois-region-top10-impact.json");
const HOME_PREVIEW_LIMIT = 10;

const OLD_ADAPTER_PATH = path.join(__dirname, "../adapters/mois/MOISAdapterOld");
if (!fs.existsSync(OLD_ADAPTER_PATH + ".ts")) {
  console.error(
    "Missing prerequisite: " + OLD_ADAPTER_PATH + ".ts\nRe-derive it first — see the prerequisite comment at the top of this script."
  );
  process.exit(1);
}
const oldAdapterModule = require(OLD_ADAPTER_PATH) as { // eslint-disable-line @typescript-eslint/no-require-imports
  normalizeMOISServiceListItem: typeof normalizeMOISServiceListItem;
  normalizeMOISSupportConditions: typeof normalizeMOISSupportConditions;
};
const normalizeMOISServiceListItemOld = oldAdapterModule.normalizeMOISServiceListItem;
const normalizeMOISSupportConditionsOld = oldAdapterModule.normalizeMOISSupportConditions;

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

// Metadata-only audit heuristic (never production logic). Maps a profile's
// own province/city to tokens that would be INCOMPATIBLE if found alone in
// a MOIS item's title/provider with no matching own-region token.
const REGION_NAME_TOKENS = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "수원", "성남", "용인", "고양", "화성", "안산", "안양", "평택", "시흥", "김포", "광명", "군포", "이천",
  "전주", "청주", "천안", "포항", "창원", "제주", "춘천", "강릉",
  "여수", "순천", "목포", "구미", "경주", "진주", "충주", "원주",
  "미추홀구", "종로구", "관악구", "달서구", "남양주", "여주",
  // NOTE: deliberately excludes bare "북구"/"동구"/"남구"/"중구"-style suffixes
  // (many cities share these district names) — those are left to the
  // "ambiguous" bucket rather than risk a confident wrong classification.
];

// Province full-name -> 2-char common abbreviation, and city/district token
// -> the abbreviation of the province it belongs to. Both audit-only: used
// solely to decide whether a locality token found in a MOIS item's
// title/organization is inside the SAME province as the profile's own
// residence, so that (e.g.) "여수시" is not flagged wrong-region for a
// profile whose only known residence is "전라남도" (no city).
const PROVINCE_ABBR: Record<string, string> = {
  "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천",
  "광주광역시": "광주", "대전광역시": "대전", "울산광역시": "울산", "세종특별자치시": "세종",
  "경기도": "경기", "강원도": "강원", "강원특별자치도": "강원",
  "충청북도": "충북", "충청남도": "충남",
  "전라북도": "전북", "전북특별자치도": "전북", "전라남도": "전남",
  "경상북도": "경북", "경상남도": "경남", "제주특별자치도": "제주",
};
const CITY_TO_PROVINCE_ABBR: Record<string, string> = {
  "수원": "경기", "성남": "경기", "용인": "경기", "고양": "경기", "화성": "경기", "안산": "경기",
  "안양": "경기", "평택": "경기", "시흥": "경기", "김포": "경기", "광명": "경기", "군포": "경기",
  "이천": "경기", "남양주": "경기", "여주": "경기",
  "전주": "전북", "청주": "충북", "천안": "충남", "포항": "경북", "창원": "경남",
  "제주": "제주", "춘천": "강원", "강릉": "강원",
  "여수": "전남", "순천": "전남", "목포": "전남",
  "구미": "경북", "경주": "경북", "진주": "경남", "충주": "충북", "원주": "강원",
  "미추홀구": "인천", "종로구": "서울", "관악구": "서울", "달서구": "대구",
};
const PROVINCE_LEVEL_TOKENS = new Set(["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종"]);

function tokenProvinceAbbr(token: string): string | undefined {
  if (PROVINCE_LEVEL_TOKENS.has(token)) return token;
  return CITY_TO_PROVINCE_ABBR[token];
}

function ownTokens(profile: UserProfile): { province?: string; city?: string } {
  const province = profile.residence?.province ? (PROVINCE_ABBR[profile.residence.province] ?? profile.residence.province.slice(0, 2)) : undefined;
  const city = profile.residence?.city;
  return { province, city };
}

// Known frozen-catalog data-quality artifact: ~1,047/10,967 rows carry the
// literal organization placeholder "전남광주통합특별시" as a prefix (a
// synthetic/anonymized-looking jurisdiction name, not a real MOIS org) ahead
// of the actual local suffix (e.g. "동구", "화순군"). Left in place, its
// "광주"/"전남" substrings falsely trigger locality-token matches unrelated
// to the item's real jurisdiction. Stripped here so the heuristic falls back
// to "ambiguous" (no usable locality signal) instead of a confident but
// spurious "clearly_wrong_region" for these rows.
const KNOWN_SYNTHETIC_ORG_PREFIX = "전남광주통합특별시";

function classifyMoisMetadata(b: Benefit, own: { province?: string; city?: string }): "clearly_compatible" | "clearly_wrong_region" | "ambiguous" {
  if (!b.id.startsWith("mois-")) return "ambiguous";
  if (!own.province) return "ambiguous"; // no residence info to compare against at all
  const text = `${b.title} ${b.source.organization ?? ""}`.split(KNOWN_SYNTHETIC_ORG_PREFIX).join("");
  const foundTokens = REGION_NAME_TOKENS.filter((t) => text.includes(t));
  if (foundTokens.length === 0) return "ambiguous"; // no locality signal in metadata at all
  // Exact own-city token match (e.g. own city "이천시" vs found token "이천").
  const cityMatch = own.city ? foundTokens.some((f) => own.city!.includes(f) || f.includes(own.city!)) : false;
  if (cityMatch) return "clearly_compatible";
  // Same-province match via the city/province abbreviation table.
  const resolvedProvinces = foundTokens.map(tokenProvinceAbbr).filter((p): p is string => p !== undefined);
  if (resolvedProvinces.length === 0) return "ambiguous"; // found tokens we can't confidently map to a province
  if (resolvedProvinces.some((p) => p === own.province)) return "clearly_compatible";
  return "clearly_wrong_region";
}

function loadFrozenCatalog() {
  const moisRawList: MOISRawServiceListItem[] = JSON.parse(fs.readFileSync(MOIS_LIST_PATH, "utf8"));
  const moisRawConditions: MOISRawSupportCondition[] = JSON.parse(fs.readFileSync(MOIS_CONDITIONS_PATH, "utf8"));
  const youthRaw: YouthRawPolicy[] = JSON.parse(fs.readFileSync(YOUTH_PATH, "utf8"));
  return { moisRawList, moisRawConditions, youthRaw };
}

function buildBenefits(
  moisRawList: MOISRawServiceListItem[],
  moisRawConditions: MOISRawSupportCondition[],
  youthRaw: YouthRawPolicy[],
  variant: "old" | "new"
): Benefit[] {
  const conditionsById = new Map<string, MOISRawSupportCondition>();
  for (const row of moisRawConditions) conditionsById.set(row.서비스ID, row);
  const normalizeItem = variant === "old" ? normalizeMOISServiceListItemOld : normalizeMOISServiceListItem;
  const normalizeConditions = variant === "old" ? normalizeMOISSupportConditionsOld : normalizeMOISSupportConditions;
  const moisBenefits: Benefit[] = moisRawList.map((raw) => {
    const condRow = conditionsById.get(raw.서비스ID);
    const ageGroup = condRow ? normalizeConditions(condRow) : undefined;
    return normalizeItem(raw, ageGroup);
  });
  const youthBenefits: Benefit[] = youthRaw.map(normalizeYouthPolicy);
  return [...moisBenefits, ...youthBenefits];
}

function computeTop10(allBenefits: Benefit[], profile: UserProfile) {
  const detailed = matchBenefitsDetailed(allBenefits, profile);
  const statusById = new Map<string, EligibilityStatus>();
  const positiveEvidenceById = new Map<string, boolean>();
  const evidenceById = new Map<string, PersonalizationEvidence>();
  for (const m of detailed) {
    statusById.set(m.benefitId, m.status);
    positiveEvidenceById.set(m.benefitId, m.hasPositiveEvidence);
    evidenceById.set(m.benefitId, m.personalization);
  }
  const relevant = allBenefits.filter((b) => isRelevantForFeed(statusById.get(b.id)!, positiveEvidenceById.get(b.id)!));
  const recommended = getRecommendedBenefits(relevant, statusById, profile, HOME_PREVIEW_LIMIT, {
    evidenceById,
    excludeWeakUnknown: true,
  });
  const top20 = getRecommendedBenefits(relevant, statusById, profile, 20, { evidenceById });
  return { recommended, top20, evidenceById };
}

async function main() {
  const { moisRawList, moisRawConditions, youthRaw } = loadFrozenCatalog();
  console.log(`Frozen snapshot: MOIS ${moisRawList.length} rows, Youth ${youthRaw.length} rows`);

  const benefitsOld = buildBenefits(moisRawList, moisRawConditions, youthRaw, "old");
  const benefitsNew = buildBenefits(moisRawList, moisRawConditions, youthRaw, "new");

  const perProfile = PROFILES.map(({ key, label, profile }) => {
    const own = ownTokens(profile);
    const before = computeTop10(benefitsOld, profile);
    const after = computeTop10(benefitsNew, profile);

    const beforeIds = before.recommended.map((b) => b.id);
    const afterIds = after.recommended.map((b) => b.id);
    const removedIds = beforeIds.filter((id) => !afterIds.includes(id));
    const addedIds = afterIds.filter((id) => !beforeIds.includes(id));
    const byId = new Map(benefitsNew.map((b) => [b.id, b] as const));
    const byIdOld = new Map(benefitsOld.map((b) => [b.id, b] as const));

    const removed = removedIds.map((id) => {
      const b = byIdOld.get(id)!;
      return { id, title: b.title, source: b.source.type, organization: b.source.organization };
    });
    const added = addedIds.map((id) => {
      const b = byId.get(id)!;
      return { id, title: b.title, source: b.source.type, organization: b.source.organization };
    });

    // Section 5: metadata-only MOIS local-scope compatibility classification
    // over the Top-20 (AFTER) for this profile.
    const metaClassified = after.top20.map((b) => ({
      id: b.id,
      title: b.title,
      source: b.source.type,
      organization: b.source.organization,
      classification: classifyMoisMetadata(b, own),
    }));
    const wrongRegionInTop20 = metaClassified.filter((m) => m.classification === "clearly_wrong_region");

    return {
      key,
      label,
      top10Before: beforeIds,
      top10After: afterIds,
      removedFromTop10: removed,
      addedToTop10: added,
      icheonBugItemStillPresent: id_351050000123_present(afterIds),
      moisTop20MetadataAudit: {
        clearlyCompatible: metaClassified.filter((m) => m.classification === "clearly_compatible").length,
        clearlyWrongRegion: wrongRegionInTop20.length,
        ambiguous: metaClassified.filter((m) => m.classification === "ambiguous").length,
        wrongRegionSamples: wrongRegionInTop20,
      },
    };
  });

  function id_351050000123_present(ids: string[]): boolean {
    return ids.some((id) => id.includes("351050000123"));
  }

  const artifact = {
    generatedAt: new Date().toISOString(),
    checkpoint: "MOIS region-clause precision correction — Top-10 before/after impact (Section 5)",
    snapshot: { moisCount: moisRawList.length, youthCount: youthRaw.length },
    profiles: perProfile,
  };
  fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
  fs.writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2));
  console.log(`Written to ${ARTIFACT_PATH}`);

  for (const p of perProfile) {
    console.log(`\n--- ${p.key} ---`);
    console.log(`removed: ${p.removedFromTop10.map((r) => r.id + " " + r.title).join(" | ") || "(none)"}`);
    console.log(`added:   ${p.addedToTop10.map((r) => r.id + " " + r.title).join(" | ") || "(none)"}`);
    console.log(`icheon bug item (351050000123) present after fix: ${p.icheonBugItemStillPresent}`);
    console.log(`top20 metadata audit: ${JSON.stringify(p.moisTop20MetadataAudit, (k, v) => (k === "wrongRegionSamples" ? undefined : v))}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
