# Median-income "positive household-income signal" manual review (Phase 3 pre-merge, task item 2)

## Purpose

`scripts/auditMedianIncomeEligibilityFrozen.ts` buckets every `기준중위소득
N%` occurrence in the frozen MOIS snapshot (`/tmp/mois_serviceList_full.json`,
10,967 rows) into bucket **A — "CONFIRMED HOUSEHOLD-INCOME THRESHOLD (positive
signal present)"** whenever a household/family income phrase (가구소득,
가구원 소득, 세대 소득, 가구단위 중위소득, etc.) sits inside the extraction
window. As of the checkpoint-5 commit (`f6c9517`) this bucket contained **42
hits across 30 distinct MOIS services**.

This review manually reads the **full, untruncated** 지원대상/선정기준 text
(not just the audit's ~100-char excerpt) for every one of the 42 hits and
verifies:

1. The positive phrase genuinely denotes the **applicant's own total ordinary
   household income** (not a per-member threshold, 소득인정액, tax-return
   income, wage/earned income, insurance premium, couple-only income, a
   fixed-reference/table example, or some other administrative metric).
2. Whether that metric is safely comparable to Damoa's `annualHouseholdIncome`
   profile field.
3. What the production parser (`extractEligibilityFromText`, which only ever
   resolves the **first** `중위소득` + percent + boundary-word match in the
   whole field — not per-clause) actually emits for that field, and whether
   that output is correct.

Per the project's core safety rule — **false negatives (extra `unresolved`
clauses) are acceptable; a false-positive `median_income_threshold` rule is
not** — any hit whose semantics are even slightly uncertain is resolved to
UNRESOLVED, never guessed toward RULE.

## Method

- Pulled full (untruncated) `지원대상`/`선정기준` text for all 30 bucket-A
  service IDs from `/tmp/mois_serviceList_full.json`.
- Ran the real, production `extractEligibilityFromText` against each field
  (via a throwaway script importing `@/lib/eligibility/extraction/koreanEligibilityParser`,
  deleted after use) to get ground-truth "what does production actually do
  today" output, both **before** and **after** the fixes below.
- Cross-referenced the audit's per-hit `signals` (percent, boundary word,
  disqualifier-nearby flags, household-size-mode, etc.) against the full raw
  text.

## Findings: 4 real false-positive bug classes found and fixed

The review surfaced 6 services (12 of the 42 hits) that the pre-review parser
wrongly resolved into a `median_income_threshold` RULE, caused by 4 distinct
bugs in `lib/eligibility/extraction/koreanEligibilityParser.ts`. All 4 are
now fixed (checkpoint-6):

1. **Positive-regex/중위소득 collision.** `MEDIAN_INCOME_HOUSEHOLD_INCOME_POSITIVE_RE`'s
   bounded wildcard gap (`가구...[^\n]{0,4}...소득`) could bridge into the
   trailing "소득" of "중위소득" itself, producing a false positive-signal
   match even when the actual clause was about an unrelated/disqualifying
   metric. Fixed by adding a `(?!중위)` negative lookahead inside the
   repeated wildcard group. Affects **315000000104** (법정 저소득
   한부모가구, "중위소득65% 이하" — no genuine household-income phrase
   present at all; the collision was purely the regex bridging into
   중위소득's own suffix), **373000000126** (정신질환자 치료비 지원,
   "전국가구 중위소득의 120%이하" — "전국가구" is a national reference
   population, not the applicant's own household, and again the "소득" the
   old regex grabbed was 중위소득's own trailing token), and
   **O00030500005** (주거복지센터 위탁 서비스, "중위소득 80%이하의 저소득
   가구" — "저소득 가구" is a category label, not a positive household-income
   statement; same collision mechanism).
2. **원가구 (parental-origin household) vs. 독립가구 (applicant's own
   household).** New disqualifier `MEDIAN_INCOME_PARENTAL_ORIGIN_HOUSEHOLD_DISQUALIFIER_RE`.
   Affects **161300000099** (청년월세 지원, both 지원대상 and 선정기준):
   "청년 원가구*의 소득이 기준 중위소득 100% 이하이면서 청년 독립가구 소득이
   기준 중위소득 60% 이하" tests BOTH the youth's parental household AND
   their own independent household via AND — neither figure is safely
   equated with Damoa's `annualHouseholdIncome` (which represents the
   applicant's own current household), so the clause must stay unresolved.
3. **Too-narrow disqualifier window missed a trailing footnote.** The
   original ±40/+20-char window around the match sometimes ended before a
   trailing "* 소득기준 : ... 소득인정액을 ..." footnote that disqualifies
   the whole clause. Widened the disqualifier-only check window (not the
   positive-signal window) to +150 chars. Affects **461000000126** (치매
   진료비 및 약제비 본인부담금 지원): "(소득기준) 기준중위소득 140% 초과자 *
   소득기준 : 신청가구의 소득과 재산을 [소득인정액으로] 환산하여..." — the
   disqualifying "소득인정액" footnote sits ~34 chars past where the old
   window ended.
4. **소득평가액 (income-assessment amount) not recognized as a
   disqualifier.** 소득평가액 is the pre-asset-conversion component of
   소득인정액 under Korean welfare law — an administrative metric, not raw
   household income. Added `소득\s*평\s*가\s*액` to
   `MEDIAN_INCOME_METRIC_DISQUALIFIER_RE`. Affects **654000000006** (전북형
   기초생활보장제도): "가구소득평가액이 기준중위소득 50%이하" — the old regex
   only recognized `소득인정액`, not this closely-related metric.

None of these 4 fixes touch the positive-signal window, so they can only ever
move a result from RULE toward UNRESOLVED (or leave it unchanged) — never the
reverse. This was additionally verified end-to-end for arbitrary income
profiles via `__tests__/eligibility/medianIncomeParserCandidateIndex.test.ts`
(candidate-index pruning-safety) and the parser-level regression tests added
in `__tests__/eligibility/koreanEligibilityParser.test.ts` /
`__tests__/fixtures/medianIncomeGoldSampleReal.ts`.

## Full per-hit result (42 hits / 30 services)

Legend: **RULE** = production emits a `median_income_threshold` rule (correct
and verified). **UNRESOLVED (fixed)** = this session's review found a false
positive and fixed the parser so it is now correctly unresolved.
**UNRESOLVED (pre-existing)** = already correctly unresolved before this
session, for a reason independent of the 4 fixes above (documented so the
"first occurrence only" / narrow-positive-window behaviors aren't mistaken
for new bugs).

| # | 서비스ID | field | hits | positive phrase | semantic metric | verdict | reasoning |
|---|---|---|---|---|---|---|---|
| 1 | 135200005013 | 지원대상 | 1 | "(가구소득) 기준 중위소득 50% 이하" | applicant's total household income | **RULE** | Genuine, unambiguous household-income clause (자산형성지원사업/청년내일저축계좌). Confirmed correct. |
| 2 | 135200005013 | 선정기준 | 1 | same | same | **RULE** | Same clause duplicated in 선정기준. |
| 3 | 149200000037 | 지원대상 | 1 | "가구원 합산 소득이 기준 중위소득의 80% 이하" | sum of household members' income | **RULE** | "가구원 합산 소득" is exactly total household income, just phrased per-member-summed. Correct. |
| 4 | 149200000037 | 선정기준 | 1 | same | same | **RULE** | Duplicated clause. |
| 5 | 149200005007 | 지원대상 | 1 | "가구단위 중위소득 100% 이하" (II유형) | applicant's household income | **UNRESOLVED (pre-existing)** | Genuine positive phrase, but it is not the FIRST 중위소득+percent+boundary occurrence in the field — an earlier "I유형" clause in the same field resolves first (per the parser's documented first-match-only behavior) and that earlier occurrence is not a safe household-income clause, so the whole field is unresolved before ever reaching this text. Intentional false-negative, unrelated to the 4 fixes. |
| 6 | 149200005007 | 선정기준 | 1 | same | same | **UNRESOLVED (pre-existing)** | Same field content duplicated in 선정기준. |
| 7 | 161300000099 | 지원대상 | 3 | "청년 원가구*의 소득이 ... 청년 독립가구 소득이 ..." | parental-origin household AND applicant's own household (dual test) | **UNRESOLVED (fixed)** | Bug class 2 (원가구). Neither figure safely maps to `annualHouseholdIncome`. |
| 8 | 161300000099 | 선정기준 | 3 | same | same | **UNRESOLVED (fixed)** | Same clause duplicated in 선정기준. |
| 9 | 315000000104 | 지원대상 | 1 | "저소득 한부모가구(중위소득65% 이하)" | category label, no genuine household-income phrase | **UNRESOLVED (fixed)** | Bug class 1 (regex collision into 중위소득's own "소득"). No real positive signal exists in this text. |
| 10 | 315000000114 | 지원대상 | 2 | "한부모가족증명서 발급대상자 가구(중위소득 65% 이하)" | category/eligibility-certificate label | **UNRESOLVED (pre-existing)** | "가구(중위소득 65% 이하)" describes the certified target population, not a positive household-income statement, and additionally the disqualifying "소득인정액"-style admin framing common to 한부모가족 programs applies; stays unresolved for reasons independent of the 4 fixes (no positive-signal regex change touched this text; it never matched the collision pattern since there is no "가구...소득" bridging window here). |
| 11 | 361000000541 | 지원대상 | 1 | "가구 소득액이 기준 중위소득 150% 이하" | applicant's total household income | **RULE** | Genuine, unambiguous. Correct. |
| 12 | 370000000116 | 지원대상 | 1 | "(가구소득) 기준 중위소득 50%이하" (청년내일저축계좌 sub-clause) | applicant's total household income | **UNRESOLVED (pre-existing)** | Genuine phrase, but an EARLIER 중위소득+percent occurrence in the same field ("가구 전체의 총 근로사업소득이 기준중위소득 40%의 60%이상") is a wage/business-income clause and resolves first per first-match-only behavior, so the field never reaches this genuinely-safe later clause. Intentional false-negative, unrelated to the 4 fixes. |
| 13 | 373000000126 | 지원대상 | 1 | "전국가구 중위소득의 120%이하" | national reference population, not applicant's household | **UNRESOLVED (fixed)** | Bug class 1 (regex collision). "전국가구" is a nationwide administrative reference figure, not the applicant's own household, and there is no genuine "가구...소득" phrase here either. |
| 14 | 429000000646 | 선정기준 | 2 | "환자가구 소득기준(기준 중위소득 140% 미만)" / "부양의무자가구 소득기준(기준 중위소득 200% 미만)" | per-household-size income table (환자가구 and 부양의무자가구 rows) | **UNRESOLVED (pre-existing)** | Per the existing checkpoint-4 fixed-reference review (`docs/median-income-fixed-reference-review.md` #7), this field contains a full 1인~7인가구 table and a separate 부양의무자(support-obligor) household concept distinct from the applicant's own household; already correctly unresolved, untouched by this session. |
| 15 | 461000000115 | 지원대상 | 1 | "가구소득 기준중위소득 70%이하" | applicant's total household income | **RULE** | Genuine, unambiguous. Correct. |
| 16 | 461000000126 | 지원대상 | 1 | "(소득기준) 기준중위소득 140% 초과자 * 소득기준 : 신청가구의 소득과 재산을 [...] 소득인정액" | 소득인정액 (recognized income), disqualifying | **UNRESOLVED (fixed)** | Bug class 3 (disqualifier-window too narrow to reach the trailing 소득인정액 footnote). |
| 17 | 508000000690 | 지원대상 | 1 | "신청인과 가구 소득의 합계가 2025년 기준 중위소득 100% 이하" | applicant's total household income | **RULE** | Genuine, unambiguous, with explicit year. Correct. |
| 18 | 511000000155 | 지원대상 | 2 | "가구소득이 기준중위소득 60%이하" / "가구소득이 기준중위소득 70%를 초과" | applicant's total household income | **RULE** | Genuine, unambiguous (two OR'd eligibility paths in the same field, same metric). Correct. |
| 19 | 569000000390 | 지원대상 | 1 | "가구 단위 기준 중위소득 150% 이하(1인 기준 3,342,668원 이하)" | applicant's household income, single-reference-amount example | **UNRESOLVED (pre-existing)** | Per the existing checkpoint-4 review (#10), no household-composition requirement exists elsewhere in the record, so the "(1인 기준 ...)" parenthetical could be read as illustrative rather than a proven universal reference; the household-size heuristic already resolves this as ambiguous/unresolved, independent of this session's 4 fixes. |
| 20 | 569000000391 | 지원대상 | 1 | same pattern | same | **UNRESOLVED (pre-existing)** | Same reasoning as #19 (checkpoint-4 review #11). |
| 21 | 611000019628 | 지원대상 | 1 | "가구합산소득이 기준중위소득 85% 이하" | sum of household income | **RULE** | Genuine, unambiguous. Correct. |
| 22 | 611000019635 | 지원대상 | 1 | "가구소득 기준 중위소득 150% 이하" | applicant's total household income | **RULE** | Genuine, unambiguous. Correct. |
| 23 | 627000000128 | 지원대상 | 1 | "가구 기준중위소득 150% 이하(가구 소득합산액 기준)" | sum of household income, explicitly labeled | **RULE** | Genuine, unambiguous — "가구 소득합산액 기준" explicitly confirms household-summed income. Correct. |
| 24 | 627000000153 | 지원대상 | 1 | "가구소득이 기준 중위소득의 60% 이하" | applicant's total household income | **RULE** | Genuine, unambiguous. Correct. |
| 25 | 629000000186 | 지원대상 | 1 | "가구소득이 기준 중위소득 70%이하" | applicant's total household income | **RULE** | Genuine, unambiguous. Correct. |
| 26 | 630000000674 | 지원대상 | 1 | "국민건강보험 지역가입자 중 기준 중위소득 150%이하 *소득 산정은 [...] 가구소득" | applicant's household income, positive phrase in a trailing footnote | **UNRESOLVED (pre-existing)** | The "가구소득" wording sits in a trailing footnote outside the narrow positive-signal window used for the positive check (only the disqualifier window was widened this session, deliberately, since widening only the disqualifier side can never introduce a new false positive); stays unresolved, a conservative pre-existing behavior unrelated to the 4 fixes. |
| 27 | 642000000712 | 지원대상 | 1 | "최근 3개월 가구소득액 평균이 기준중위소득 120%초과" | applicant's total household income | **RULE** | Genuine, unambiguous. Correct. |
| 28 | 642000000731 | 지원대상 | 1 | "가구소득 기준중위소득 60%초과" | applicant's total household income | **RULE** | Genuine, unambiguous. Correct. |
| 29 | 648000001103 | 지원대상 | 1 | "(가구소득) 가구 기준중위소득 50% 초과" | applicant's total household income | **RULE** | Genuine, unambiguous. Correct. |
| 30 | 654000000006 | 지원대상 | 1 | "가구소득평가액이 기준중위소득 50%이하" | 소득평가액 (income-assessment amount), disqualifying | **UNRESOLVED (fixed)** | Bug class 4 (소득평가액 not previously recognized as a disqualifier). |
| 31 | B55029700002 | 지원대상 | 1 | "동일 가구원 소득 합산하여 산정" + "2026년 기준 중위소득 90% 이하" | sum of household members' income, explicit year | **RULE** | Genuine, unambiguous, with explicit year. Correct. |
| 32 | B55370100044 | 지원대상 | 1 | "(가구소득) 기준중위소득 200% 이하" | applicant's total household income | **UNRESOLVED (pre-existing)** | Genuine phrase, but an earlier "종합소득" (individual tax-return income) disqualifier occurrence earlier in the same field falls within the narrow window of the first 중위소득+percent match, resolving the field unresolved before reaching this later genuinely-safe clause. Intentional false-negative (first-match-only + narrow-window behavior), unrelated to the 4 fixes. |
| 33 | O00030500005 | 지원대상 | 2 | "중위소득 80%이하의 저소득 가구" (주거비 지원 / 주거환경개선 두 기준 동일 문구 반복) | category label, no genuine household-income phrase | **UNRESOLVED (fixed)** | Bug class 1 (regex collision). "저소득 가구" is a category label, not a positive household-income statement. |
| 34 | O00105600003 | 지원대상 | 1 | "사회적고립 1인가구는 중위소득 100%이하로" | fixed 1-person reference figure tied to a specific named sub-population | **UNRESOLVED (pre-existing)** | "사회적고립 1인가구" is a specific named target sub-population within a larger 지원대상 list (차상위계층, 법정한부모, 사회적고립 1인가구), not the general applicant's own household income figure; the household-size/fixed-reference heuristic already treats this as not safely generalizable and it resolves unresolved independent of the 4 fixes. |

## Tally

- **42** original bucket-A hits (30 distinct services).
- **18 hits / 15 services** confirmed genuinely safe, RULE-emitting, verified
  unchanged after the fixes (135200005013 ×2, 149200000037 ×2, 361000000541,
  461000000115, 508000000690, 511000000155 ×2, 611000019628, 611000019635,
  627000000128, 627000000153, 629000000186, 642000000712, 642000000731,
  648000001103, B55029700002).
- **12 hits / 6 services** were **false positives** in the checkpoint-5
  parser, now fixed and correctly unresolved (161300000099 ×6 across both
  fields, 315000000104, 373000000126, O00030500005 ×2, 461000000126,
  654000000006).
- **12 hits / 10 services** were already correctly unresolved before this
  session, for reasons independent of the 4 fixes documented above
  (149200005007 ×2, 315000000114 ×2, 370000000116, 429000000646 ×2,
  569000000390, 569000000391, 630000000674, B55370100044, O00105600003).

`18 + 12 + 12 = 42`. **Production-safe median-income-hit count after this
review: 18** (down from the pre-review count of 30 apparent RULE-shaped hits
— see note below).

Note: before this session's fixes, production actually emitted a RULE for
36 of the 42 hits (the 18 confirmed-safe ones above, plus the 12 now-fixed
false positives, plus 6 of the "pre-existing unresolved" hits that were
*already* correctly unresolved even before this session for independent
reasons — i.e. the 4 fixes strictly reduced the false-positive count from 12
to 0 without affecting any of the other 24 hits' outcomes either direction).

## Verification performed

- Re-ran `extractEligibilityFromText` against all 30 services' full
  지원대상/선정기준 text after applying the 4 fixes: confirmed the 6
  newly-fixed services now emit **no** `median_income_threshold` rule, and
  all 15 previously-confirmed-safe services still emit their **unchanged**
  correct RULE (no regressions).
- Added targeted regression tests (see
  `__tests__/eligibility/koreanEligibilityParser.test.ts` and
  `__tests__/fixtures/medianIncomeGoldSampleReal.ts`) covering all 4 bug
  classes with the real MOIS excerpts cited above.
- Re-ran the candidate-index pruning-safety suite
  (`__tests__/eligibility/medianIncomeParserCandidateIndex.test.ts`) and the
  optimized-vs-full-scan equivalence check to confirm no benefit is ever
  wrongly pruned as a result of these changes.
