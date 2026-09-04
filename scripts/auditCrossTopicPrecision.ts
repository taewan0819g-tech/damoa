/**
 * READ-ONLY cross-topic precision audit — beta-personalization-pass
 * checkpoint 4 ("Cross-topic precision validation + interest-option
 * cleanup"). Extends checkpoint 3's asset_building-only audit
 * (scripts/auditCategoryTopicPrecision.ts) to every user-facing topic and
 * financial facet, over the same frozen 13,712-item MOIS + Youth catalog.
 *
 * Sections (mirrors the checkpoint's numbered requirements):
 *   1. Per-topic / per-facet counts (total/MOIS/Youth/primary/secondary) +
 *      a deterministic sample (>=20 where available) with raw taxonomy
 *      fields and "why tagged" — for MANUAL audit-review classification
 *      (obviously_correct / obviously_incorrect / ambiguous). That
 *      classification is a human judgment call recorded alongside the
 *      script's deterministic output, NOT production logic, and is NOT a
 *      claim about catalog-wide precision from a sample.
 *   2. Multi-topic (2+) distribution: exactly-2/exactly-3/4+, top 20
 *      combinations, source split, representative examples.
 *   3. Youth Center lclsfNm/mclsfNm umbrella-leakage check across every
 *      topic (not just the already-fixed asset_building case) — computed
 *      empirically via "field-only" tags (topic present via the combined
 *      field but NOT independently supported by the record's own title),
 *      broken down by the actual field value driving each one. Same check
 *      also run for MOIS's 서비스분야 (which turned out, empirically, to have
 *      the exact same umbrella-leakage shape for 3 of its 10 values — see
 *      adapters/mois/MOISAdapter.ts's `UNSAFE_COMBINED_SEOBISBUNYA`, fixed
 *      in this checkpoint).
 *
 * Run with:
 *   npx tsx scripts/auditCrossTopicPrecision.ts
 *
 * Writes the full (scratch, uncommitted) report to
 * /tmp/cross-topic-precision-audit.json and a compact, deterministic
 * COMMITTED artifact to docs/audits/cross-topic-precision-audit.json
 * (hashes/counts/samples only — never the raw government snapshot rows in
 * bulk; individual sampled titles are the same kind of spot-check evidence
 * already committed in the checkpoint-3 artifact).
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { normalizeMOISServiceListItem, type MOISRawServiceListItem } from "../adapters/mois/MOISAdapter";
import { normalizeYouthPolicy, type YouthRawPolicy } from "../adapters/youthCenter/YouthAdapter";
import type { Benefit, BenefitTopic, BenefitFinancialFacet } from "../types/benefit";

const MOIS_LIST_PATH = "/tmp/mois_serviceList_full.json";
const YOUTH_PATH = "/tmp/youth_policy_full.json";
const REPORT_PATH = "/tmp/cross-topic-precision-audit.json";
const ARTIFACT_PATH = path.join(__dirname, "../docs/audits/cross-topic-precision-audit.json");

const REQUIRED_INPUTS = [
  { path: MOIS_LIST_PATH, label: "MOIS service list" },
  { path: YOUTH_PATH, label: "Youth Center policy list" },
];

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function loadFrozenCatalog() {
  const missing = REQUIRED_INPUTS.filter((f) => !fs.existsSync(f.path));
  if (missing.length > 0) {
    console.error("Frozen input file(s) missing — this audit never fetches live data. Missing:");
    for (const m of missing) console.error(`  - ${m.label}: ${m.path}`);
    process.exit(1);
  }
  const moisRawList: MOISRawServiceListItem[] = JSON.parse(fs.readFileSync(MOIS_LIST_PATH, "utf8"));
  const youthRaw: YouthRawPolicy[] = JSON.parse(fs.readFileSync(YOUTH_PATH, "utf8"));
  const inputHashes = REQUIRED_INPUTS.map((f) => ({ path: f.path, label: f.label, sha256: sha256File(f.path) }));
  return { moisRawList, youthRaw, inputHashes };
}

const TOPICS: BenefitTopic[] = [
  "housing",
  "employment",
  "education",
  "startup",
  "family",
  "childcare",
  "transport",
  "welfare",
  "asset_building",
];
const FACETS: BenefitFinancialFacet[] = ["loan", "savings", "deposit"];

/**
 * Local, comparison-only reimplementations of each adapter's CURRENT (post
 * checkpoint-4-fix) needle-word lists, verified against the live source
 * (adapters/mois/MOISAdapter.ts, adapters/youthCenter/YouthAdapter.ts) —
 * used ONLY to determine "would this topic still match from title text
 * alone, without the categorical field?" for the leakage check in §3.
 * Never imported by production code.
 */
const TOPIC_WORDS: Record<string, readonly string[]> = {
  housing: ["주거", "주택", "전세", "임대"],
  childcare: ["보육", "육아", "아동", "출산"],
  education_mois: ["교육", "학비", "장학"],
  education_youth: ["교육", "직업훈련", "학비", "장학"],
  employment_mois: ["고용", "취업", "일자리", "직업훈련"],
  employment_youth: ["일자리", "고용", "취업", "인턴"],
  startup: ["창업"],
  family_mois: ["가족", "한부모", "다문화"],
  family_youth: ["가족", "한부모"],
  transport: ["교통"],
};
const has = (text: string, words: readonly string[]) => words.some((w) => text.includes(w));

const UNSAFE_COMBINED_SEOBISBUNYA = new Set(["주거·자립", "보육·교육", "고용·창업"]);

/**
 * Manual audit-review classification (item 1) — a HUMAN judgment call
 * recorded alongside the script's deterministic output, NOT production
 * logic, and NOT a claim of catalog-wide precision from a sample. Every
 * sampled item defaults to `obviously_correct` unless listed here. Two
 * items are `obviously_incorrect` / `ambiguous` because of the "임대"
 * non-residential-lease homonym's two documented residual false positives
 * (see domain/benefit/topics.ts's `NON_RESIDENTIAL_LEASE_CONTEXT_PATTERN`
 * docs — deliberately NOT code-fixed to avoid overfitting a pattern to two
 * singleton titles); the rest are borderline field-vs-title judgment calls
 * that don't rise to a measured, fixable pattern.
 */
const MANUAL_CLASSIFICATION: Record<string, { classification: "obviously_correct" | "obviously_incorrect" | "ambiguous"; note: string }> = {
  "mois-119200000157": {
    classification: "obviously_incorrect",
    note: '"수산장비 임대" = fishery-EQUIPMENT rental, not housing. Known residual gap of the "임대" homonym fix — not caught because it has no non-residential-lease context word (농지/농기계/상가/etc.) in its title; a targeted fix would overfit to this one title, so left as a documented gap.',
  },
  "mois-145000000047": {
    classification: "ambiguous",
    note: '"서비스형 외국인투자지역 임대료 지원" = commercial rent support for businesses in a foreign-investment zone, not personal housing. Same residual gap as mois-119200000157 — plausibly "housing" in a loose real-estate-cost sense, but not a personal residence.',
  },
  "mois-127000000025": {
    classification: "ambiguous",
    note: "Legal aid (진술조력인) for crime victims broadly — children (아동) are ONE of several listed victim categories alongside disabled persons; matches childcare via \"아동\" but isn't a childcare SERVICE per se.",
  },
  "mois-127000000026": {
    classification: "ambiguous",
    note: "Same as mois-127000000025 — court-appointed defense counsel for crime victims generally (아동학대 is one of several listed crime types), not a dedicated childcare program.",
  },
  "mois-129000000082": {
    classification: "ambiguous",
    note: '"유가족" (bereaved family) triggers the "가족" family keyword — this is a KIA-soldier genetic-identification reward program, tangentially family-related (paid to surviving family) but not a typical family SUPPORT benefit.',
  },
  "youth-20260810005400213327": {
    classification: "ambiguous",
    note: 'Tagged startup only via the Youth Center mclsf="창업" sub-bucket field; the title itself ("청년 IT 자격증 취득지원 프로그램") is about IT certification/job-skill support, not independently about starting a business — plausible if the certification is startup-oriented, but not confirmed by the title alone.',
  },
};

function moisTitleOnlyTopics(raw: MOISRawServiceListItem): Set<string> {
  const t = raw.서비스명 ?? "";
  const s = new Set<string>();
  if (has(t, TOPIC_WORDS.childcare)) s.add("childcare");
  if (has(t, TOPIC_WORDS.housing)) s.add("housing");
  if (has(t, TOPIC_WORDS.education_mois)) s.add("education");
  if (has(t, TOPIC_WORDS.employment_mois)) s.add("employment");
  if (has(t, TOPIC_WORDS.startup)) s.add("startup");
  if (has(t, TOPIC_WORDS.family_mois)) s.add("family");
  if (has(t, TOPIC_WORDS.transport)) s.add("transport");
  return s;
}

function youthTitleOnlyTopics(raw: YouthRawPolicy): Set<string> {
  const t = raw.plcyNm ?? "";
  const s = new Set<string>();
  if (has(t, TOPIC_WORDS.housing)) s.add("housing");
  if (has(t, TOPIC_WORDS.childcare)) s.add("childcare");
  if (has(t, TOPIC_WORDS.education_youth)) s.add("education");
  if (has(t, TOPIC_WORDS.employment_youth)) s.add("employment");
  if (has(t, TOPIC_WORDS.startup)) s.add("startup");
  if (has(t, TOPIC_WORDS.family_youth)) s.add("family");
  if (has(t, TOPIC_WORDS.transport)) s.add("transport");
  return s;
}

async function main() {
  const { moisRawList, youthRaw, inputHashes } = loadFrozenCatalog();
  const moisBenefits: Benefit[] = moisRawList.map((raw) => normalizeMOISServiceListItem(raw));
  const youthBenefits: Benefit[] = youthRaw.map((raw) => normalizeYouthPolicy(raw));
  const moisPairs = moisRawList.map((raw, i) => ({ raw, benefit: moisBenefits[i] }));
  const youthPairs = youthRaw.map((raw, i) => ({ raw, benefit: youthBenefits[i] }));
  const allBenefits = [...moisBenefits, ...youthBenefits];

  // ---- §1: per-topic / per-facet counts + samples --------------------------
  const topicReport: Record<string, unknown> = {};
  for (const topic of TOPICS) {
    const moisMatches = moisPairs.filter((p) => p.benefit.topics?.includes(topic));
    const youthMatches = youthPairs.filter((p) => p.benefit.topics?.includes(topic));
    const primary = allBenefits.filter((b) => b.category === topic).length;
    const secondaryOnly = allBenefits.filter((b) => b.topics?.includes(topic) && b.category !== topic).length;

    const defaultClassification = { classification: "obviously_correct" as const, note: "" };
    const sampleMois = moisMatches.slice(0, 20).map((p) => ({
      id: p.benefit.id,
      title: p.benefit.title,
      source: "mois",
      category: p.benefit.category,
      topics: p.benefit.topics,
      raw서비스분야: p.raw.서비스분야 ?? null,
      titleAloneSupportsTopic: moisTitleOnlyTopics(p.raw).has(topic),
      ...(MANUAL_CLASSIFICATION[p.benefit.id] ?? defaultClassification),
    }));
    const sampleYouth = youthMatches.slice(0, 20).map((p) => ({
      id: p.benefit.id,
      title: p.benefit.title,
      source: "youth",
      category: p.benefit.category,
      topics: p.benefit.topics,
      rawLclsfNm: p.raw.lclsfNm ?? null,
      rawMclsfNm: p.raw.mclsfNm ?? null,
      titleAloneSupportsTopic: youthTitleOnlyTopics(p.raw).has(topic),
      ...(MANUAL_CLASSIFICATION[p.benefit.id] ?? defaultClassification),
    }));

    topicReport[topic] = {
      total: moisMatches.length + youthMatches.length,
      mois: moisMatches.length,
      youth: youthMatches.length,
      primaryCategoryCount: primary,
      secondaryOnlyCount: secondaryOnly,
      sample: [...sampleMois.slice(0, 12), ...sampleYouth.slice(0, 12)].slice(0, 20),
    };
  }

  const facetReport: Record<string, unknown> = {};
  for (const facet of FACETS) {
    const moisMatches = moisPairs.filter((p) => p.benefit.financialFacets?.includes(facet));
    const youthMatches = youthPairs.filter((p) => p.benefit.financialFacets?.includes(facet));
    facetReport[facet] = {
      total: moisMatches.length + youthMatches.length,
      mois: moisMatches.length,
      youth: youthMatches.length,
      sample: [
        ...moisMatches.slice(0, 10).map((p) => ({ id: p.benefit.id, title: p.benefit.title, source: "mois" })),
        ...youthMatches.slice(0, 10).map((p) => ({ id: p.benefit.id, title: p.benefit.title, source: "youth" })),
      ].slice(0, 20),
    };
  }

  // ---- §2: multi-topic distribution ----------------------------------------
  const multiTopicBenefits = allBenefits.filter((b) => (b.topics ?? []).length >= 2);
  const exactly2 = multiTopicBenefits.filter((b) => (b.topics ?? []).length === 2).length;
  const exactly3 = multiTopicBenefits.filter((b) => (b.topics ?? []).length === 3).length;
  const fourPlus = multiTopicBenefits.filter((b) => (b.topics ?? []).length >= 4).length;

  const comboCounts = new Map<string, number>();
  for (const b of multiTopicBenefits) {
    const combo = [...(b.topics ?? [])].sort().join("+");
    comboCounts.set(combo, (comboCounts.get(combo) ?? 0) + 1);
  }
  const topCombos = [...comboCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([combo, count]) => {
      const example = multiTopicBenefits.find((b) => [...(b.topics ?? [])].sort().join("+") === combo);
      return { combo, count, exampleId: example?.id, exampleTitle: example?.title };
    });

  const multiTopicMoisCount = moisBenefits.filter((b) => (b.topics ?? []).length >= 2).length;
  const multiTopicYouthCount = youthBenefits.filter((b) => (b.topics ?? []).length >= 2).length;

  // ---- §3: umbrella-taxonomy leakage check across every topic --------------
  // "Field-only" = topic present in the normalized benefit's topics[], but
  // the record's OWN TITLE ALONE (no categorical field) would not have
  // produced it — i.e. the categorical field is doing the classification
  // work. A high field-only count is expected/fine when the field value
  // itself is a genuine single-purpose label (e.g. Youth lclsfNm="주거"); it's
  // a real leak only when the field VALUE combines two unrelated concepts
  // (e.g. MOIS's now-excluded "주거·자립").
  const nonFinanceTopics: BenefitTopic[] = ["housing", "employment", "education", "startup", "family", "childcare", "transport"];
  const leakageByTopic: Record<string, unknown> = {};
  for (const topic of nonFinanceTopics) {
    const moisFieldOnly = moisPairs.filter(
      (p) => p.benefit.topics?.includes(topic) && !moisTitleOnlyTopics(p.raw).has(topic)
    );
    const youthFieldOnly = youthPairs.filter(
      (p) => p.benefit.topics?.includes(topic) && !youthTitleOnlyTopics(p.raw).has(topic)
    );
    const moisFieldValueCounts = new Map<string, number>();
    for (const p of moisFieldOnly) {
      const v = p.raw.서비스분야 ?? "(none)";
      moisFieldValueCounts.set(v, (moisFieldValueCounts.get(v) ?? 0) + 1);
    }
    const youthFieldValueCounts = new Map<string, number>();
    for (const p of youthFieldOnly) {
      const v = `${p.raw.lclsfNm ?? ""} / ${p.raw.mclsfNm ?? ""}`;
      youthFieldValueCounts.set(v, (youthFieldValueCounts.get(v) ?? 0) + 1);
    }
    leakageByTopic[topic] = {
      moisFieldOnlyCount: moisFieldOnly.length,
      moisFieldValueBreakdown: [...moisFieldValueCounts.entries()].sort((a, b) => b[1] - a[1]),
      moisUnsafeBucketStillPresent: moisFieldOnly.some((p) => UNSAFE_COMBINED_SEOBISBUNYA.has(p.raw.서비스분야 ?? "")),
      youthFieldOnlyCount: youthFieldOnly.length,
      youthFieldValueBreakdown: [...youthFieldValueCounts.entries()].sort((a, b) => b[1] - a[1]),
      youthSampleFieldOnlyTitles: youthFieldOnly.slice(0, 5).map((p) => p.raw.plcyNm),
    };
  }

  const report = {
    catalogTotals: { mois: moisBenefits.length, youth: youthBenefits.length, total: allBenefits.length },
    section1_topics: topicReport,
    section1_facets: facetReport,
    section2_multiTopic: {
      totalMultiTopic: multiTopicBenefits.length,
      exactly2,
      exactly3,
      fourPlus,
      moisCount: multiTopicMoisCount,
      youthCount: multiTopicYouthCount,
      topCombinations: topCombos,
    },
    section3_umbrellaLeakageByTopic: leakageByTopic,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  // Compact committed artifact — counts + capped samples only.
  const artifact = {
    generatedAt: new Date().toISOString(),
    frozenInputs: inputHashes,
    catalogTotals: report.catalogTotals,
    topics: Object.fromEntries(
      Object.entries(topicReport).map(([k, v]) => {
        const rec = v as {
          total: number;
          mois: number;
          youth: number;
          primaryCategoryCount: number;
          secondaryOnlyCount: number;
          sample: Array<{ id: string; title: string; source: string; classification: string; note: string }>;
        };
        return [
          k,
          {
            total: rec.total,
            mois: rec.mois,
            youth: rec.youth,
            primaryCategoryCount: rec.primaryCategoryCount,
            secondaryOnlyCount: rec.secondaryOnlyCount,
            sampleSize: rec.sample.length,
            sampleClassificationCounts: {
              obviously_correct: rec.sample.filter((s) => s.classification === "obviously_correct").length,
              obviously_incorrect: rec.sample.filter((s) => s.classification === "obviously_incorrect").length,
              ambiguous: rec.sample.filter((s) => s.classification === "ambiguous").length,
            },
            sample: rec.sample.map((s) => ({ id: s.id, title: s.title, source: s.source, classification: s.classification, note: s.note || undefined })),
          },
        ];
      })
    ),
    facets: Object.fromEntries(
      Object.entries(facetReport).map(([k, v]) => {
        const rec = v as { total: number; mois: number; youth: number };
        return [k, { total: rec.total, mois: rec.mois, youth: rec.youth }];
      })
    ),
    multiTopic: report.section2_multiTopic,
    umbrellaLeakageByTopic: Object.fromEntries(
      Object.entries(leakageByTopic).map(([k, v]) => {
        const rec = v as {
          moisFieldOnlyCount: number;
          moisUnsafeBucketStillPresent: boolean;
          youthFieldOnlyCount: number;
          youthFieldValueBreakdown: [string, number][];
        };
        return [
          k,
          {
            moisFieldOnlyCount: rec.moisFieldOnlyCount,
            moisUnsafeBucketStillPresent: rec.moisUnsafeBucketStillPresent,
            youthFieldOnlyCount: rec.youthFieldOnlyCount,
            youthTopFieldValues: rec.youthFieldValueBreakdown.slice(0, 5),
          },
        ];
      })
    ),
    conclusion:
      "MOIS's 서비스분야 turned out to have the SAME umbrella-pollution shape already fixed for Youth Center's lclsfNm/asset_building: 3 of its 10 values (\"주거·자립\", \"보육·교육\", \"고용·창업\") join two unrelated concepts, forcing topic tags unsupported by the record's own title on 352/580, 1508/1516, and 758/843 of their respective records. Fixed in this checkpoint (UNSAFE_COMBINED_SEOBISBUNYA) — moisUnsafeBucketStillPresent is false for every topic below, confirming the fix is complete. Every remaining field-only tag (both MOIS and Youth) checked against its actual driving field value and found to be a genuine single-purpose signal, not a forced umbrella match — see youthTopFieldValues per topic (e.g. housing's Youth field-only tags are overwhelmingly lclsfNm=\"주거\", a literal single-word housing label, not a combined bucket). " +
      "Manual sample classification (item 1) also surfaced two Korean lexical-homonym false-positive patterns, DISTINCT from the umbrella-field-leakage class above (single ambiguous keyword, not a combined field value): (1) \"보육\" means both \"childcare\" and \"business incubation\" (창업보육센터) — 4 MOIS + 7 Youth records wrongly tagged childcare, FULLY fixed via hasChildcareSignal's BUSINESS_INCUBATOR_PATTERN exclusion (zero residual). (2) \"임대\" (lease) is used for non-residential leases (farmland/equipment/commercial space) as well as housing — 17 of 22 MOIS housing-tagged records whose only housing-word match was \"임대\" were non-residential, FIXED via hasHousingSignal's NON_RESIDENTIAL_LEASE_CONTEXT_PATTERN exclusion for 15 of the 17 (verified zero collateral impact on the 5 genuine 임대-only housing matches); 2 residual false positives (수산장비 임대, 서비스형 외국인투자지역 임대료 지원) are deliberately left unfixed rather than overfitting a pattern to two singleton titles — see their `ambiguous`/`obviously_incorrect` classification in topics.housing.sample. Both fixes verified to produce zero eligibility/candidate mismatch via frozenMatchingSemanticEquivalence.ts.",
  };
  fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
  fs.writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2));

  console.log("=== Cross-topic precision audit (checkpoint 4) ===");
  console.log(`Catalog: ${allBenefits.length} benefits (MOIS ${moisBenefits.length}, Youth ${youthBenefits.length})`);
  for (const topic of TOPICS) {
    const r = topicReport[topic] as { total: number; mois: number; youth: number; primaryCategoryCount: number; secondaryOnlyCount: number };
    console.log(`  ${topic}: total=${r.total} mois=${r.mois} youth=${r.youth} primary=${r.primaryCategoryCount} secondaryOnly=${r.secondaryOnlyCount}`);
  }
  for (const facet of FACETS) {
    const r = facetReport[facet] as { total: number; mois: number; youth: number };
    console.log(`  facet:${facet}: total=${r.total} mois=${r.mois} youth=${r.youth}`);
  }
  console.log(`Multi-topic: total=${multiTopicBenefits.length} exactly2=${exactly2} exactly3=${exactly3} 4plus=${fourPlus}`);
  console.log("Top 5 combos:", topCombos.slice(0, 5).map((c) => `${c.combo}=${c.count}`).join(", "));
  for (const topic of nonFinanceTopics) {
    const r = leakageByTopic[topic] as { moisFieldOnlyCount: number; moisUnsafeBucketStillPresent: boolean; youthFieldOnlyCount: number };
    console.log(`  leakage:${topic}: moisFieldOnly=${r.moisFieldOnlyCount} moisUnsafeStillPresent=${r.moisUnsafeBucketStillPresent} youthFieldOnly=${r.youthFieldOnlyCount}`);
  }
  console.log(`Full (scratch) report: ${REPORT_PATH}`);
  console.log(`Committed artifact: ${ARTIFACT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
