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
 * Writes a full JSON report to /tmp/family-audit.json (every bucket's full
 * match list, for later manual sampling) and prints a condensed per-bucket
 * summary (count + up to 10 representative excerpts with service ID/source
 * field) to stdout.
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

// ---------------------------------------------------------------------------
// Bucket definitions. Each bucket is a REGEX over raw text, intentionally
// broad/overlapping (a single record can land in several buckets) — this is
// a MEASUREMENT tool, not the production parser. Buckets mirror the
// categories requested in the Phase 2 spec.
// ---------------------------------------------------------------------------
const BUCKETS: Record<string, RegExp> = {
  미혼: /미혼/,
  기혼: /기혼/,
  혼인: /혼인/,
  신혼부부: /신혼부부/,
  "혼인기간 N년 이내": /혼인(?:신고)?\s*(?:일)?\s*(?:후|기간)?\s*[^.\n]{0,6}?(\d{1,2})\s*년\s*(?:이내|미만|이하)/,
  "예비신혼부부/혼인예정": /예비\s*신혼부부|혼인\s*예정/,
  "자녀 N명 이상": /자녀\s*\d+\s*명\s*(?:이상|초과)/,
  다자녀: /다자녀/,
  한부모: /한\s?부모/,
  다문화가족: /다문화\s?가족|다문화가정/,
  조손가족: /조손\s?가족|조손가정/,
  배우자: /배우자/,
  "출산/임신": /출산|임신/,
  "세대/가구구성": /세대\s?(?:주|원|구성)|가구\s?(?:주|원|구성)/,
  이혼: /이혼/,
  사별: /사별/,
  새터민: /새터민|북한이탈주민/,
};

interface BucketHit {
  serviceId: string;
  sourceField: "지원대상" | "선정기준";
  excerpt: string;
}

const SAMPLE_CAP = 30; // how many excerpts we KEEP per bucket (for manual review)
const bucketHits: Record<string, BucketHit[]> = Object.fromEntries(Object.keys(BUCKETS).map((k) => [k, []]));
// True occurrence counts, uncapped (counts MATCHES, so one record with the
// same bucket firing in both 지원대상 AND 선정기준 counts twice here — the
// per-bucket "distinct records" count is tracked separately below).
const bucketMatchCount: Record<string, number> = Object.fromEntries(Object.keys(BUCKETS).map((k) => [k, 0]));
const bucketServiceIds: Record<string, Set<string>> = Object.fromEntries(Object.keys(BUCKETS).map((k) => [k, new Set<string>()]));
// Union of all buckets: how many DISTINCT records have ANY family/marital signal at all.
const anySignalServiceIds = new Set<string>();

function excerptAround(text: string, re: RegExp, pad = 40): string {
  const m = re.exec(text);
  if (!m) return text.slice(0, 80);
  const start = Math.max(0, m.index - pad);
  const end = Math.min(text.length, m.index + m[0].length + pad);
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
    for (const [bucket, re] of Object.entries(BUCKETS)) {
      if (re.test(raw)) {
        hitAny = true;
        bucketMatchCount[bucket]++;
        bucketServiceIds[bucket].add(row.서비스ID);
        if (bucketHits[bucket].length < SAMPLE_CAP) {
          bucketHits[bucket].push({ serviceId: row.서비스ID, sourceField: field, excerpt: excerptAround(raw, re) });
        }
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
    matchCount: bucketMatchCount[bucket],
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
      buckets: Object.fromEntries(Object.entries(bucketHits).map(([k, v]) => [k, { count: v.length, hits: v }])),
    },
    null,
    2
  )
);
console.log("\nFull report written to /tmp/family-audit.json");
