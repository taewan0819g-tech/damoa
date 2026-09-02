/**
 * READ-ONLY Phase 2 (marital/family) source audit against the FROZEN MOIS
 * snapshot at /tmp/mois_serviceList_full.json (10,967 rows, captured during
 * Phase 1). Does not call any production matching/extraction code and does
 * not modify any production file — it only greps the real 지원대상/선정기준
 * free text and buckets it into semantic categories so Phase 2's canonical
 * family model can be designed FROM real phrasing, not from imagination.
 *
 * Run with:
 *   npx tsx scripts/auditFamilyEligibilityFrozen.ts
 *
 * Writes a full JSON report to /tmp/family-audit.json with the TRUE, UNCAPPED
 * per-bucket hit population (every match's serviceId/sourceField/excerpt,
 * plus matchCount and distinctRecordCount computed from that same uncapped
 * population — never from a capped display sample). stdout stays capped to
 * the first 10 excerpts per bucket for readability only; the cap never
 * affects the JSON report or the reported counts.
 *
 * Checkpoint-2 revision: the 한부모 bucket regex is refined to exclude two
 * real false-positive shapes found on re-audit (see `isGenuineSingleParentHit`
 * below) — a naive `/한\s?부모/` bucket over-counts them.
 */
import fs from "fs";

interface MoisRow {
  서비스ID: string;
  지원대상?: string;
  선정기준?: string;
  [key: string]: unknown;
}

const rows: MoisRow[] = JSON.parse(fs.readFileSync("/tmp/mois_serviceList_full.json", "utf-8"));
console.log(`Loaded frozen MOIS snapshot: ${rows.length} rows`);

/**
 * True word-boundary check (mirrors koreanEligibilityParser.ts's
 * `isHangulBoundaryOk`): a genuine word start is preceded by string-start or
 * a non-Hangul character, never by another Hangul character.
 */
function isHangulBoundaryOk(text: string, idx: number): boolean {
  if (idx === 0) return true;
  return !/[가-힣]/.test(text[idx - 1]);
}

/**
 * Refined 한부모 matcher. Two real false-positive shapes found on re-audit of
 * the raw `/한\s?부모/` bucket (28 space-separated hits manually reviewed):
 *
 * 1. "-한 부모" verb-ending collision (space-separated form ONLY — the fused
 *    "한부모" spelling has zero observed false positives: "법정한부모",
 *    "미혼한부모", "청소년한부모", "저소득한부모" are all genuine): "카드를
 *    소지한 부모" (parents who HOLD a card), "아동을 입양한 부모" (parents who
 *    ADOPTED), "출산한 부모" (parents who GAVE BIRTH), "위한 부모" ("for
 *    parents"). Filtered via the Hangul word-boundary check on "한".
 * 2. "한(부모| 부모) 이상" numeral idiom: "한 부모 이상과 학생이" (real MOIS
 *    540000000110/114/129, 지원대상) AND its fused 선정기준 spelling
 *    "한부모이상" (same three services) both mean "one parent OR MORE", not
 *    the legal 한부모 category. Filtered by rejecting a bare "이상"
 *    immediately following the match when no 가족/가정 suffix was captured.
 */
const SINGLE_PARENT_RE = /한(\s?)부모(\s?(?:가족|가정))?/g;
function isGenuineSingleParentHit(text: string, match: RegExpExecArray): boolean {
  const hasSpace = match[1] === " ";
  const hasFamilySuffix = Boolean(match[2]);
  if (hasSpace && !isHangulBoundaryOk(text, match.index)) return false;
  if (!hasFamilySuffix) {
    const endIdx = match.index + match[0].length;
    if (/^\s?이상/.test(text.slice(endIdx, endIdx + 3))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Bucket definitions. Each bucket is either a plain REGEX over raw text
// (intentionally broad/overlapping — a single record can land in several
// buckets, this is a MEASUREMENT tool, not the production parser) or, for
// 한부모, a `match`-based filter function applying the false-positive guards
// above. Buckets mirror the categories requested in the Phase 2 spec.
// ---------------------------------------------------------------------------
interface BucketDef {
  /** Finds the next match starting at/after `fromIndex`, or undefined if none (after applying any false-positive filter). */
  exec(text: string, fromIndex: number): RegExpExecArray | undefined;
}

function fromRegex(re: RegExp): BucketDef {
  return {
    exec(text, fromIndex) {
      const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
      r.lastIndex = fromIndex;
      const m = r.exec(text);
      return m ?? undefined;
    },
  };
}

const SINGLE_PARENT_BUCKET: BucketDef = {
  exec(text, fromIndex) {
    const r = new RegExp(SINGLE_PARENT_RE.source, "g");
    r.lastIndex = fromIndex;
    let m: RegExpExecArray | null;
    while ((m = r.exec(text)) !== null) {
      if (isGenuineSingleParentHit(text, m)) return m;
      r.lastIndex = m.index + 1; // keep scanning past a rejected hit
    }
    return undefined;
  },
};

const BUCKETS: Record<string, BucketDef> = {
  미혼: fromRegex(/미혼/g),
  기혼: fromRegex(/기혼/g),
  혼인: fromRegex(/혼인/g),
  신혼부부: fromRegex(/신혼부부/g),
  "혼인기간 N년 이내": fromRegex(/혼인(?:신고)?\s*(?:일)?\s*(?:후|기간)?\s*[^.\n]{0,6}?(\d{1,2})\s*년\s*(?:이내|미만|이하)/g),
  "예비신혼부부/혼인예정": fromRegex(/예비\s*신혼부부|혼인\s*예정/g),
  "자녀 N명 이상": fromRegex(/자녀\s*\d+\s*명\s*(?:이상|초과)/g),
  다자녀: fromRegex(/다자녀/g),
  "한부모 (refined)": SINGLE_PARENT_BUCKET,
  "한부모 (raw, unfiltered — for comparison only)": fromRegex(/한\s?부모/g),
  다문화가족: fromRegex(/다문화\s?가족|다문화가정/g),
  조손가족: fromRegex(/조손\s?가족|조손가정/g),
  배우자: fromRegex(/배우자/g),
  "출산/임신": fromRegex(/출산|임신/g),
  "세대/가구구성": fromRegex(/세대\s?(?:주|원|구성)|가구\s?(?:주|원|구성)/g),
  이혼: fromRegex(/이혼/g),
  사별: fromRegex(/사별/g),
  새터민: fromRegex(/새터민|북한이탈주민/g),
};

interface BucketHit {
  serviceId: string;
  sourceField: "지원대상" | "선정기준";
  excerpt: string;
}

// Uncapped per-bucket hit lists — every match, no sampling. This IS the true
// population; matchCount/distinctRecordCount below are derived from it, not
// from any capped display subset.
const bucketHits: Record<string, BucketHit[]> = Object.fromEntries(Object.keys(BUCKETS).map((k) => [k, []]));
const bucketServiceIds: Record<string, Set<string>> = Object.fromEntries(Object.keys(BUCKETS).map((k) => [k, new Set<string>()]));
// Union of all buckets: how many DISTINCT records have ANY family/marital signal at all.
const anySignalServiceIds = new Set<string>();

function excerptAround(text: string, match: RegExpExecArray, pad = 40): string {
  const start = Math.max(0, match.index - pad);
  const end = Math.min(text.length, match.index + match[0].length + pad);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

for (const row of rows) {
  const fields: Array<["지원대상" | "선정기준", string | undefined]> = [
    ["지원대상", row.지원대상],
    ["선정기준", row.선정기준],
  ];
  let hitAny = false;
  for (const [field, raw] of fields) {
    if (!raw) continue;
    for (const [bucket, def] of Object.entries(BUCKETS)) {
      let fromIndex = 0;
      let matchedThisField = false;
      for (;;) {
        const m = def.exec(raw, fromIndex);
        if (!m) break;
        matchedThisField = true;
        bucketHits[bucket].push({ serviceId: row.서비스ID, sourceField: field, excerpt: excerptAround(raw, m) });
        fromIndex = m.index + Math.max(m[0].length, 1);
      }
      if (matchedThisField) {
        bucketServiceIds[bucket].add(row.서비스ID);
        hitAny = true;
      }
    }
  }
  if (hitAny) anySignalServiceIds.add(row.서비스ID);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const summary = Object.entries(bucketHits)
  .map(([bucket, hits]) => ({
    bucket,
    matchCount: hits.length,
    distinctRecords: bucketServiceIds[bucket].size,
    sample: hits.slice(0, 10),
  }))
  .sort((a, b) => b.matchCount - a.matchCount);

console.log(`\nAny marital/family signal (union of all buckets): ${anySignalServiceIds.size} / ${rows.length} records`);
console.log("\n=== Bucket counts ===");
console.table(summary.map((s) => ({ bucket: s.bucket, matchCount: s.matchCount, distinctRecords: s.distinctRecords })));

for (const s of summary) {
  console.log(`\n--- ${s.bucket} (matchCount=${s.matchCount}, distinctRecords=${s.distinctRecords}) ---`);
  for (const h of s.sample) {
    console.log(`  [${h.serviceId}/${h.sourceField}] ${h.excerpt}`);
  }
}

fs.writeFileSync(
  "/tmp/family-audit.json",
  JSON.stringify(
    {
      totalRows: rows.length,
      anySignalCount: anySignalServiceIds.size,
      buckets: Object.fromEntries(
        Object.entries(bucketHits).map(([k, v]) => [
          k,
          { matchCount: v.length, distinctRecordCount: bucketServiceIds[k].size, hits: v },
        ])
      ),
    },
    null,
    2
  )
);
console.log("\nFull (uncapped) report written to /tmp/family-audit.json");
