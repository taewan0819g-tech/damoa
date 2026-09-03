# Median-income `fixed_reference_household` manual review (Phase 3 checkpoint-4)

## Purpose

`scripts/auditMedianIncomeEligibilityFrozen.ts` classifies a "기준중위소득 N%"
clause as `householdSizeMode: "fixed"` whenever exactly one distinct
household-size number (e.g. "4인가구") sits within its ±40/+20-character
extraction window. Before this review, the production parser
(`lib/eligibility/extraction/koreanEligibilityParser.ts`) mirrored that same
heuristic and emitted `fixed_reference_household` + `fixedHouseholdSize`
whenever it saw that shape.

This review manually reads every one of the 16 real hits (15 distinct MOIS
services) the audit script classified this way against the frozen snapshot
(`/tmp/mois_serviceList_full.json`, 10,967 rows) and classifies each into:

- **A** — truly fixed-reference: the policy evaluates every applicant against
  one fixed N-person household figure, regardless of the applicant's actual
  household size.
- **B** — actually applicant-household-size dependent (a full per-size table
  exists; the regex window just didn't capture more than one row of it, or
  the source text explicitly says the amount varies by household size).
- **C** — table/example/descriptive text (not applicable to this batch — no
  hits fell here; folded into B/D below where the closest real category
  applied).
- **D** — ambiguous: no reliable in-record signal either way.

**Only category A may keep `fixed_reference_household`. Everything else must
be unresolved.** Per the project's safety philosophy: false negatives (extra
unresolved clauses) are acceptable; a false-positive household-income rule
(wrong threshold applied to a real user) is not.

## Result

| # | 서비스ID | sourceField | detected size | class | reason |
|---|---|---|---|---|---|
| 1 | 119200000007 | 선정기준 | 4 | **D** | Single "중위소득(4인가구 기준) 60%이하" line, one of several OR'd eligibility criteria for appointing 국선 심판변론인 to maritime-accident victims. No disclaimer, no table, no population constraint tying applicants to 4-person households. Cannot rule out this is just an illustrative reference amount. |
| 2 | 149200000009 | 지원대상/선정기준 (×2 occurrences, same underlying clause) | 3 | **A** | "월평균 소득이 3인가구 기준 중위소득 2분의 1 이하인 노동자" (근로복지공단 생활안정자금 융자). Corroborated via external web search: this program's documented income standard is defined against the 3-person-household reference figure as a nationwide legal standard for "저소득 근로자", independent of the applicant's real household size (multiple public sources describe it as "3인 가구 기준 중위소득"의 fixed cutoff for this specific loan program, not a per-size table). |
| 3 | 314000000271 | 지원대상 | 1 | **A** | Program name/target population is explicitly "결식우려 1인가구" (양천 반올림 밑반찬 지원). The referenced "1인가구" is the service's entire target population, not a table row — every eligible applicant is by definition a 1-person household, so the fixed 1-person threshold is correct by construction. |
| 4 | 373000000116 | 지원대상 | 2 | **A** | 울주군 신혼부부 주거비용 지원: "부부합산소득이 기준중위소득 200%(8,398천원) 이하인 가구(2인 가구 기준)". Target is newlywed *couples*; the criterion is explicitly the couple's combined income only (not full household), and "(2인 가구 기준)" pins the reference amount regardless of how many total people live in the home. |
| 5 | 378000000139 | 지원대상 | 1 | **A** | 성남시 "1인가구" 간병비 지원 — target population is explicitly 1인가구 by the service's own name and criteria, same reasoning as #3. |
| 6 | 391000000144 | 지원대상 | 1 | **A** | 평택시 청년 월세 지원: an EARLIER bullet in the same 지원대상 field explicitly requires "(주소) ... 청년 1인 가구" — the 1-person reference figure matches the mandatory target-population constraint stated elsewhere in the same record. |
| 7 | 429000000646 | 선정기준 | 1 (window-truncated) | **B** | 희귀질환자 의료비 지원사업: the FULL 선정기준 field contains a complete 1인~7인가구 income table ("· 1인 가구 : 3,589,933원 · 2인 가구 : 5,879,009원 ... · 7인 가구 : 13,321,210원"). The narrow ±40/+20 extraction window only captured the "1인 가구" row, making this look like a single fixed reference when it is clearly a full per-household-size table. |
| 8 | 447000000140 | 지원대상 | 4 | **A** | 음성군 다자녀가정 주택자금 대출이자 지원: "부부 합산 2026년도 기준 중위소득 135% 이하 ※ [보건복지부 고시] 2026년 4인가구 기준 연 105,214,752원 이하" — no other household-size figure appears anywhere in the record; reads as a single administrative cutoff applied uniformly to all 다자녀가정 (2+ children) applicants regardless of actual family size. |
| 9 | 554000000185 | 지원대상 | 1 | **A** | 광주시 "청년 1인가구" 이사비 지원 — target population explicitly 1인가구 by service name, same reasoning as #3/#5. |
| 10 | 569000000390 | 지원대상 | 1 | **D** | 세종시 청년 구직활동비 지원: "(소득) 가구 단위 기준 중위소득 150% 이하(1인 기준 3,342,668원 이하)". Unlike #6, there is NO household-composition requirement anywhere else in the record (any 19-39세 job seeker qualifies regardless of household size) — the "(1인 기준 ...)" parenthetical reads as an illustrative absolute-amount example, not a proven universal fixed reference. |
| 11 | 569000000391 | 지원대상 | 1 | **D** | 세종시 면접스타일링 지원 — identical wording/structure to #10 ("가구 단위 기준 중위소득 150% 이하(1인 기준 3,342,668원 이하)"), same reasoning. |
| 12 | 641000000164 | 지원대상 | 4 | **B** | 경기도형긴급복지지원: "기준 중위소득100% 이하(4인가구 기준 650만 원) ※ 가구원 수에 따라 기준금액 상이" — the record itself explicitly states "가구원 수에 따라 기준금액 상이" ("the standard amount varies by number of household members") immediately after the 4-person example. This is direct textual proof the clause is profile-scaled, not fixed. |
| 13 | 645000000122 | 지원대상 | 4 | **D** | 아토피 예방관리: "기준중위소득 100%(4인가구 5,121,080원)이하 가정의 아토피 피부염 진단자" — general "가정" (any family), no household-size constraint on the target population, single reference figure with no table and no disclaimer either way. Given #12 shows this exact "(N인가구 기준 X원)" phrasing pattern is used even for genuinely profile-scaled clauses, this is treated as ambiguous rather than assumed fixed. |
| 14 | 999000000061 | 선정기준 | 4 | **D** | 독립유공자 (손)자녀 생활지원금: "기준 중위소득 70% 이하자 - '26년 기준 4인가구 4,546,317원" — same reasoning as #13: single reference figure, no population constraint, no table, no disclaimer. |
| 15 | WLU000000020 | 선정기준 | 1 (window-truncated) | **B** | 차상위 본인부담 경감대상자 지원: the FULL 선정기준 field says "2026년 **가구 규모별** 기준 중위소득의 50% 이하" followed by a complete 1인~7인가구 table. "가구 규모별" ("by household size") is direct textual proof of table-based scaling; the ±40/+20 window only captured the "1인 가구" row. (This record's earlier text also contains "소득인정액", a disqualifying metric, for the *other* percent occurrence in the same field — unrelated to this specific hit but reinforces that this record needs careful, not regex-shortcut, handling.) |

## Tally

- **A (genuinely fixed-reference):** 7 of 15 distinct services (149200000009, 314000000271, 373000000116, 378000000139, 391000000144, 447000000140, 554000000185)
- **B (actually table/profile-scaled — window-truncation or explicit disclaimer proved it):** 3 of 15 (429000000646, 641000000164, WLU000000020)
- **D (ambiguous, no reliable textual signal):** 5 of 15 (119200000007, 569000000390, 569000000391, 645000000122, 999000000061)

## Production parser action taken

Critically, **not one of the 7 genuine "A" cases was distinguishable from the
8 "B"/"D" cases using only the text visible inside the parser's local
extraction window** — the A/B/D split above relies on cross-field reasoning
(a population constraint stated in a *different* bullet of the same record)
or external corroboration (a web search confirming a named program's
documented eligibility standard) that a generic regex-based parser cannot
safely replicate for arbitrary future MOIS records.

Given that, `parseMedianIncomeClause` in
`lib/eligibility/extraction/koreanEligibilityParser.ts` was changed to **never
auto-infer `fixed_reference_household` from a nearby household-size number,
one or many** — every such clause now falls back to `unresolved`. This is a
strictly more conservative behavior than before (0 new false positives, 16
additional real clauses now correctly left unresolved instead of risking 8
wrong thresholds). `fixed_reference_household` remains a valid
`MedianIncomeThresholdSpec` shape for hand-authored/evaluation-time specs
(see `domain/medianIncome/evaluate.ts` and its tests) — it is simply never
emitted by the text extractor on its own.

Two additional general-purpose (not hit-specific) parser hardenings came out
of this review:

1. **`MEDIAN_INCOME_TABLE_MARKER_RE`** — an explicit "가구원 수에 따라" /
   "가구 규모별" / "가구원수별" marker anywhere in the window now
   unconditionally forces `unresolved`, independent of the household-size
   digit count (defense in depth for cases like #12 where the marker and the
   size number are both present).
2. **Whitespace-tolerant metric disqualifier check** — the old
   `MEDIAN_INCOME_METRIC_DISQUALIFIERS` literal-substring list missed real
   MOIS spacing irregularities ("소득 인정액", "소득인 정액" — both meaning
   소득인정액) found while auditing the separate fraction-notation hits (see
   section 5 of the Phase 3 checkpoint-4 task). Replaced with a
   whitespace-tolerant regex and added 종합소득(금액) (an individual
   tax-return income figure, also not household income).
