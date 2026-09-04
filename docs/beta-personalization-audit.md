# Beta Personalization Audit — Baseline (Frozen Catalog)

**Status: AUDIT ONLY. No production code was changed. No PR opened.**

Date: 2026-09-04
Branch: `wip/beta-personalization-pass` (currently identical to `main` @ `b4f5eb923930ff85ff6d35e103160dcb247970b4` — zero diff, confirmed via `git diff main...HEAD --stat`)
Script: [`scripts/auditPersonalizationBaseline.ts`](../scripts/auditPersonalizationBaseline.ts) (read-only; imports and calls the real, unmodified `evaluateEligibilityDetailed`, `getRecommendedBenefits`, `isRelevantForFeed`, and adapter normalizer functions — never reimplements matching/ranking logic, only mirrors adapter `mapCategory` internally for keyword-attribution reporting)

## 0. Method

- Catalog: a **frozen** snapshot of the real MOIS (`/serviceList` + `/supportConditions`) and Youth Center (`getPlcy`) APIs, fetched live on **2026-09-02** and cached at `/tmp/mois_serviceList_full.json` (10,967 rows), `/tmp/mois_supportConditions_full.json` (10,967 rows), `/tmp/youth_policy_full.json` (2,745 rows). Combined catalog after normalization: **13,712 benefits**. The script reuses these files if present (reproducible, no live-API dependency); if absent it re-fetches and re-caches to the same paths.
- 6 representative profiles (A–F), chosen to exercise: the region PASS/FAIL example from the product spec (경기도 이천시 vs 수원시), asset_building/interest pollution, marital/family rules, and a "just finished onboarding, minimal fields" degenerate case. Full profile definitions are in the script.
- Run: `node --env-file=.env.local -r tsx/cjs scripts/auditPersonalizationBaseline.ts`. Full JSON: `/tmp/personalization-audit.json` (not committed — regenerate on demand).

---

## 1. Headline finding (not in the original hypothesis list): `likely_eligible` is unreachable for real catalog data

**Measured: `likely_eligible` count = 0, for every one of the 6 profiles, across the entire 13,712-item catalog. Every single result is either `unknown` or `not_eligible` — never `likely_eligible`.**

| Profile | likely_eligible | unknown (+evidence) | unknown (no evidence) | not_eligible |
|---|---|---|---|---|
| A. 이천시 청년 무직 | 0 | 6418 | 1392 | 5902 |
| B. 서울 대학생 | 0 | 6370 | 1609 | 5733 |
| C. 수원시 직장인 고소득 | 0 | 6153 | 1408 | 6151 |
| D. 이천시 신혼부부 | 0 | 6253 | 1702 | 5757 |
| E. 전남 한부모가족 | 0 | 6310 | 1727 | 5675 |
| F. 최소 입력(온보딩 직후) | 0 | 8091 | 1753 | 3868 |

**Root cause:** [`adapters/mois/MOISAdapter.ts:143-145`](../adapters/mois/MOISAdapter.ts#L143-L145) and [`adapters/youthCenter/YouthAdapter.ts:355-357`](../adapters/youthCenter/YouthAdapter.ts#L355-L357) both **unconditionally** return `eligibilityDataStatus: "incomplete"` whenever a benefit has *any* structured eligibility rule at all, and neither adapter ever sets `eligibilityUnrestricted`. In [`lib/eligibility/ruleEngine.ts:300-302`](../lib/eligibility/ruleEngine.ts#L300-L302), `isIncomplete` downgrades any full rule-tree "pass" to `"unknown"` — so on real data, **no benefit can ever reach `likely_eligible`**, regardless of how precisely age/region/income/etc. line up.

This is very plausibly the single largest contributor to complaint #1 ("추천 결과가 충분히 personalized하게 느껴지지 않는다"): the UI state that's supposed to be the payoff of accurate onboarding — `likely_eligible` → "받을 가능성이 있어요" — **structurally never fires**. Everything the user sees is "확인이 필요해요", forever, no matter how well their profile matches.

This downgrade is intentional and documented (see the comment at `MOISAdapter.ts:130-141`): dozens of undecoded MOIS `JA02xx/JA03xx/...` condition codes are known to exist beyond what's parsed, so a full pass on partial rules is deliberately not promoted, to avoid false-positive over-claiming. **This needs an explicit product decision, not a silent code flip** — flagged for your sign-off before any implementation.

---

## 2. The "personalized" feed is 45–59% of the ENTIRE catalog

| Profile | Feed size | % of 13,712-item catalog |
|---|---|---|
| A | 6418 | 46.8% |
| B | 6370 | 46.5% |
| C | 6153 | 44.9% |
| D | 6253 | 45.6% |
| E | 6310 | 46.0% |
| F (minimal) | 8091 | 59.0% |

The gate is `hasPositiveEvidence = passedRules > 0` ([`domain/eligibility/matchBenefits.ts:58-62`](../domain/eligibility/matchBenefits.ts#L58-L62)). Since age rules alone appear **12,443 times** across the MOIS catalog (see §7) and Youth Center's region dimension is never checked at all (see §3), nearly any record can find *some* rule to pass against *any* profile — including a profile with only a birthdate filled in (Profile F: 59% of the whole catalog counts as "personalized").

---

## 3. Root cause of "feels generic": Youth Center's 2,745 records (20% of catalog) have **zero** region enforcement

Field-utilization measurement (§7) shows **`residence`/`region_in`: 0 occurrences** in the entire Youth Center rule set — vs. 2,606/10,967 (23.8%) on MOIS.

[`adapters/youthCenter/YouthAdapter.ts:96-112`](../adapters/youthCenter/YouthAdapter.ts#L96-L112) and [`:303-306`](../adapters/youthCenter/YouthAdapter.ts#L303-L306): `zipCd` is real, populated region data on essentially every Youth Center record, but is deliberately **never wired into `buildEligibility()`** (only contributes to `hasUnresolvedEligibility`) — documented reason: no verified zipCd → Korean administrative-region crosswalk exists yet.

**Concrete effect, directly observed in Top-20 output:**
- Profile A (경기도 **이천시** unemployed youth) — 19/20 Top-20 recommendations are `youth_policy` source, dominated by purely regional programs from *other* cities with zero region check: "2026년 MICE **광주** 관광기업 성장단계별 맞춤지원", "**부산** 남구 청년 창업 아이디어 경진대회", "**용인시** 일자리센터를 통한 청년 취업 지원".
- Profile E (전라남도) and Profile F (blank profile) show the same pattern — a near-identical Top-20 regardless of the user's actual region, because region is simply never checked for the majority-share Youth Center source.

This is a **bigger** driver of "doesn't feel personalized" than the original targetScope-only hypothesis (§5) — most of every profile's Top-20 is regionally irrelevant Youth Center content admitted purely because an unrelated rule (usually age) happened to pass.

---

## 4. Root cause of asset_building pollution: traced to Youth Center's own combined top-level taxonomy string

Catalog-wide: **422 benefits tagged `asset_building`** (26 MOIS + 396 Youth = **14.4% of the entire Youth Center catalog**).

Of those 422: 24 contain a deposit/savings word (예금/적금/저축), 20 contain a loan word (대출/융자), 6 contain "자산형성" itself.

**372 / 422 (88.2%) match ONLY the bare "금융" keyword, with no deposit/savings/loan/자산형성-specific signal anywhere in the text.**

Exact mechanism (confirmed by direct record lookup, not guessed):

| Title | `lclsfNm` (대분류) | `mclsfNm` (중분류) |
|---|---|---|
| 청년 자살예방 조기검진 및 심리지원 | `금융·복지·문화` | 건강 |
| 충남 음악창작소운영 | `금융·복지·문화` | 문화활동 및 생활지원 |
| 청년의 날 행사 | `금융·복지·문화` | 문화활동 및 생활지원 |
| 청년내일저축계좌 지원 | `금융·복지·문화` | 취약계층 및 금융지원 |

Youth Center's own top-level category (`lclsfNm`) is the literal combined string **"금융·복지·문화"** ("Finance·Welfare·Culture") for its entire welfare/health/culture supercategory. [`adapters/youthCenter/YouthAdapter.ts:116-129`](../adapters/youthCenter/YouthAdapter.ts#L116-L129)'s `mapCategory` checks `has("금융", "자산형성", "저축")` against `${lclsfNm} ${mclsfNm} ${plcyNm}` — since `lclsfNm` contains "금융" for the *entire* welfare/culture/health bucket, every record in it that isn't caught by an earlier, more specific keyword (주거/보육/교육/취업/창업/가족/교통) silently falls into `asset_building` instead of `welfare`, independent of actual content.

Confirmed in Top-20: Profile C (interests include `asset_building`, `loan`) gets **20/20** Top-20 items tagged `asset_building` — nearly all are mental-health counseling, music/culture programs, or youth-day events. Zero are actual financial products.

---

## 5. targetScope-only evidence pollution: real, but small — NOT the dominant driver as originally hypothesized

Original hypothesis: `hasPositiveEvidence = passedRules > 0` lets a broad targetScope PASS (`개인`) alone admit an otherwise-uninformative benefit into the personalized feed.

**Measured:** only **0.5%–0.7%** of each profile's personalized feed has `hasPositiveEvidence` sourced *exclusively* from a `target_scope_in` pass, and **0/20 in every profile's actual Top-20**.

| Profile | Feed target-scope-only % | Top-20 target-scope-only count |
|---|---|---|
| A | 0.6% | 0 |
| B | 0.6% | 0 |
| C | 0.7% | 0 |
| D | 0.6% | 0 |
| E | 0.6% | 0 |
| F | 0.5% | 0 |

**Verdict:** real, worth closing (cheap, zero-risk), but §1 and §3 are much larger effects — the actual dominant "free pass" into the feed is an **age** rule passing (12,443 age-rule instances on MOIS alone; see §7), not `target_scope_in`.

---

## 6. interests / category / benefitType: confirmed total semantics mismatch for deposit/savings/loan

`INTEREST_CATEGORIES` ([`lib/constants/interests.ts:3-15`](../lib/constants/interests.ts#L3-L15)) explicitly offers `deposit`, `savings`, `loan` as user-selectable interests. Measured across the **entire 13,712-item catalog**:

| category | MOIS count | Youth count |
|---|---|---|
| `deposit` | **0** | **0** |
| `savings` | **0** | **0** |
| `loan` | **0** | **0** |

Zero benefits, ever, from either source, carry these category values — [`adapters/mois/MOISAdapter.ts:88-102`](../adapters/mois/MOISAdapter.ts#L88-L102) and [`adapters/youthCenter/YouthAdapter.ts:116-129`](../adapters/youthCenter/YouthAdapter.ts#L116-L129) only ever produce `asset_building` for anything finance-related. Any user selecting `deposit`/`savings`/`loan` gets **zero** interest-match ranking boost from [`domain/benefit/recommend.ts:27`](../domain/benefit/recommend.ts#L27) for their entire session — a UI-offered preference that structurally never pays off.

`benefitType` coverage (separate field, also checked for the same gap):

| benefitType | MOIS count | Youth count |
|---|---|---|
| cash | 6212 | 760 |
| **savings** | **0** | **0** |
| **deposit** | **0** | **0** |
| loan | 0 | 46 |
| **housing** | **0** | **0** |
| discount | 1277 | 0 |
| service | 1568 | 1192 |
| other | 1910 | 747 |

`savings`/`deposit`/`housing` are dead enum values for both real adapters ([`MOISAdapter.ts:104-111`](../adapters/mois/MOISAdapter.ts#L104-L111), YouthAdapter equivalent) — `loan` (46, Youth only) is the only one of the three finance-specific values that's ever reachable at all. **A user who says "I care about deposits/savings" has no field in the current data model Damoa can match that intent against.**

---

## 7. UserProfile field utilization across the whole catalog's structured rules

| Field / operator | MOIS count | Youth count |
|---|---|---|
| `age` | 12,443 | 1,264 |
| `target_scope_in` (사용자구분) | 10,967 | — (not modeled) |
| `residence` (region_in) | 2,606 | **0** |
| `educationStatus` | 882 | 274 |
| `singleParentFamily` | 370 | — (not modeled) |
| `employmentStatus` | 178 | 494 |
| `homeowner` | 170 | — (not modeled) |
| `multiculturalFamily` | 130 | — (not modeled) |
| `marriageDate` (marriage_duration_within) | 62 | — (not modeled) |
| `maritalStatus` | 39 | 71 |
| `individualIncomeRange` | 37 | 29 |
| `childrenCount` | 32 | — (not modeled) |
| `businessOwner` | 19 | — (not modeled) |
| `median_income_threshold` (householdIncomeRange) | 19 | — (not modeled) |
| `householdIncomeRange` (direct) | 0 | 0 |
| `smeEmployee` | 0 | 0 |
| `totalAssets`/`financialAssets` | 0 | 0 |
| `housingType` | 0 | 0 |

MOIS uses far more of the profile surface than Youth (which only ever produces age/employment/education/marital/individual-income rules). `businessOwner`/`homeowner`/`smeEmployee`/`totalAssets`/`financialAssets`/`housingType` are collected in onboarding but rarely or never actually gate a real rule today.

---

## 8. employmentStatus / educationStatus: measured evidence for keeping them independent

| | employmentStatus only | educationStatus only | both |
|---|---|---|---|
| MOIS | 134 | 822 | 38 |
| Youth | 425 | 205 | 69 |
| **combined** | 559 | 1027 | **107** |

Both dimensions are exercised independently at meaningful volume (education-only is actually *more* common than employment-only on MOIS: 822 vs 134), and **107 real catalog records require both simultaneously** — e.g. "employed AND university student" or "unemployed AND high-school-graduate" combinations that a single merged select cannot represent.

The `UserProfile` type already models these as two independent fields ([`types/profile.ts:104-105`](../types/profile.ts#L104-L105)) — the limitation is purely in the onboarding UI layer: `CURRENT_STATUS_TO_PROFILE` ([`domain/profile/currentStatus.ts:27-38`](../domain/profile/currentStatus.ts#L27-L38)) forces one of 7 fixed options onto both fields at once, so a user can never express e.g. "employed, also currently in grad school." This confirms the user's design suspicion with measured data (107 dual-constraint records), not just intuition.

---

## 9. Region free-text UX

- Onboarding: province is a `<Select>` from a fixed list ([`lib/constants/regions.ts`](../lib/constants/regions.ts)); city is a free-text `<Input>` ([`components/onboarding/OnboardingFlow.tsx:145-149`](../components/onboarding/OnboardingFlow.tsx#L145-L149)).
- [`lib/eligibility/region.ts:79-118`](../lib/eligibility/region.ts#L79-L118) `matchRegion` does exact, trimmed string equality on city — **no alias/gazetteer normalization applies at the city level** (only province has an alias table, `region.ts:17-63`). `regionGazetteer.ts` exists (metadata: `version: "2023-07-gunwi-transfer.1"`, explicitly `authoritative: false`) but is currently consumed only by the MOIS free-text parser, never by the user-facing city input or by `matchRegion`'s city comparison.
- Consequence: a user typing "이천" instead of "이천시" (or any spacing/spelling variant) silently fails every city-scoped rule, with zero feedback that their input didn't match anything recognized.

---

## 10. Navigation state loss (confirmed, code-level)

- [`app/(app)/benefits/page.tsx:37-41`](<../app/(app)/benefits/page.tsx#L37-L41>): `query`/`group`/`category`/`sort`/`page` are local `useState`, never synced to the URL.
- [`app/(app)/benefits/[id]/page.tsx:120-129`](<../app/(app)/benefits/[id]/page.tsx#L120-L129>): detail page `BackLink` is hardcoded to `href="/benefits"` — always resets filters/search/sort/page to defaults regardless of where the user navigated from.

---

## 11. Proposed implementation priorities (NOT implemented — audit only, pending sign-off)

1. **P0 — Youth Center region enforcement.** Wire `zipCd` into a real `region_in` rule (or at minimum filter/deprioritize by region in ranking) — needs a verified zipCd → 행정동 crosswalk first (per `YouthAdapter.ts`'s own `ZIP_CD_NEXT_STEP` note); may need a short research spike before implementation. Addresses §3, the single biggest "feels generic" driver.
2. **P0 — Fix Youth Center `mapCategory`'s asset_building trigger.** Stop matching against `lclsfNm`'s combined "금융·복지·문화" label; require a genuine deposit/savings/loan/자산형성-specific signal (`mclsfNm` alone, or `plcyKywdNm`) before tagging `asset_building`. Addresses §4.
3. **P1 — Explicit product decision on `likely_eligible` reachability** (§1). Options: loosen the "incomplete" downgrade for specific, well-verified dimension combinations; invest in decoding more `JA0xxx` codes; or explicitly accept "unknown-only" as the honest state and redesign the UI copy/hierarchy around it instead. This is a PASS/UNKNOWN/FAIL-semantics-adjacent decision — flagged for explicit sign-off per your product principles, not something to silently change.
4. **P1 — Close the residual targetScope-only gap** (§5) as a cheap, safe follow-on once P0/P1 above land.
5. **P2 — Give deposit/savings/loan interests something to match.** Either populate those `BenefitCategory` values from `mclsfNm`/지원유형 keywords, or extend `recommend.ts`'s interest-match to also compare against `benefitType`. Addresses §6.
6. **P2 — Split the onboarding "현재 상태" question into independent employment/education inputs**, backed by the 107-record dual-constraint evidence in §8.
7. **P2 — Region UX**: convert city free-text to a `<Select>` seeded per-province from the (non-authoritative but internally consistent) `regionGazetteer`, and make `matchRegion`/the input use the same normalized city list.
8. **P3 — Persist benefits-page filter/search/sort/page state in the URL**; make the detail page `BackLink` return to the actual previous list state instead of a hardcoded reset to `/benefits`.

Each of these should land as its own reviewable change — none of them should touch PASS/UNKNOWN/FAIL semantics without an explicit separate discussion (see #3 above in particular).
