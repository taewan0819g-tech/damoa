# Damoa Closed-Beta Readiness Audit

**Status: AUDIT ONLY (original checkpoint below).** No production code was changed by the original Checkpoint D. Only this file, `docs/audits/beta-readiness.json`, `docs/audits/beta-readiness-personalization.json`, and `scripts/auditBetaReadiness.ts` (a new, read-only audit script) were added by that checkpoint.

- Branch: `wip/beta-personalization-pass`, audited at SHA `d8296250349dad384d14633cf0b0bdf5547c1270` (HEAD before this checkpoint's own commit).
- Diverged from `main` @ `b4f5eb923930ff85ff6d35e103160dcb247970b4`; `main` is a strict ancestor (clean linear history, no conflicts).
- **Verdict: `READY_AFTER_SMALL_FIXES`**

---

## Addendum — MOIS Region-Clause Precision correction checkpoint (real fix, not audit-only)

Started from SHA `fcca37277703a65f9f45f90130b8d9482fdb7c2d`. Unlike the checkpoint below, this one **did** change production code: `lib/eligibility/extraction/koreanEligibilityParser.ts`.

**Bug found and fixed.** A direct review of this audit found a false positive: an 이천시(Icheon)/Gyeonggi resident's Home Top-10 incorrectly contained `mois-351050000123` ("미추홀구 청년 면접수당 지원"), whose actual applicant-residence requirement is "인천광역시 미추홀구에 주민등록된 청년" — a later, separate clause naming 서울/경기/인천 describes the **interview location**, not applicant residence. Root cause: `findProvinceRegionSpecs()` scanned every province mention in the whole clause text with no requirement that the mention be positively bound to a residence signal (거주/주민등록/주소...), unlike the already-correct lone-city path (`isNearAnyIndex`/`CITY_PROXIMITY_WINDOW`). Fixed by requiring a province mention to be bound via the existing char-proximity window **or** the same "○"-delimited MOIS clause as an actual residence signal (`isBoundToResidenceSignal`).

- **Before → after** for 351050000123: `[{인천광역시,미추홀구}, {서울특별시}, {경기도}, {인천광역시}, {서울특별시}, {인천광역시}]` → `[{인천광역시,미추홀구}]`. Confirmed absent from the Icheon profiles' Home Top-10 after the fix.
- **Catalog-wide** (frozen 10,967-row MOIS snapshot, `docs/audits/mois-region-binding-precision.json`): 28 records affected, 61 specs removed / 6 added, 16 fields lost their region rule entirely. Removal classification: 0 confirmed-false-residence(A) / 7 valid-spec-accidentally-removed(B, disclosed tradeoff — see `__tests__/fixtures/regionGoldSampleReal.ts`'s `real-rule-multi-region-large-list` note) / 54 ambiguous(C, heuristic classifier, not claimed as verified).
- **Safety**: `unexpectedNonRegionMismatchCount = 0` — every changed rule across the whole catalog was a `region_in` change; no other eligibility dimension moved.
- **Top-10/Top-20 impact** (`docs/audits/mois-region-top10-impact.json`, all 6 profiles, before/after): confirmed bug item removed for profile A; small unrelated Top-10 churn for profiles A and B (1-2 items each swapped, expected side effect of removing false specs); C/D/E/F unchanged.
- **New blind spot closed, new residual found**: extended metadata-only auditing (title/organization locality tokens vs profile province — never production logic) to ALL MOIS Top-20 items, not just Youth. This surfaced a **different, pre-existing, unchanged-by-this-fix** bug shape still reaching Home Top-10 for 2/6 profiles: single-○-clause (or no-○) text where an illustrative/comparison province mention (e.g. `mois-401000000112`'s "(예시) 서울시 소재 학교...") sits within the same binding window as the one true residence signal, with no clause boundary available to discriminate them. Verified byte-identical extraction before/after this checkpoint (not a regression). Tracked as new issue **P1-5** for a future, separately-scoped checkpoint — not fixed here (out of scope, different root cause, would need its own frozen-catalog audit before choosing an implementation).
- **Regression tests**: added A-G coverage to `__tests__/eligibility/koreanEligibilityParser.test.ts` (describe block "province-spec residence binding (region-clause precision fix)"); updated `__tests__/fixtures/regionGoldSampleReal.ts`'s `real-rule-multi-region-large-list` fixture to the correct, disclosed post-fix expectation. Full suite: 942/942 tests, 57/57 files passing.
- **Verdict unchanged: `READY_AFTER_SMALL_FIXES`.** The confirmed false positive is fixed; P1-1..P1-4 (dead 예금 filter, empty 금융상품 tab, `likely_eligible` unreachable, Youth zipCd) remain exactly as before, explicitly deferred to their own next checkpoints; P1-5 is newly added, not newly introduced.

See `docs/audits/beta-readiness.json` → `supersededByCheckpoint` / `moisRegionLeakage` / `issues.p1[4]` for the machine-readable version of all of the above.

---

## 1. WIP delta summary (main vs branch, 70 files, +14445/-592)

13 commits since `main`, in order: personalization-baseline audit → wire personalization ranker into API + dedupe home preview → show unknown-status label on home + harden OR-branch evidence → collapse ANY-group evidence → derive category/topic centrally + fix Youth `asset_building` over-tagging → cross-topic precision fix (보육/임대 homonyms) → split employment/education profile inputs → canonical province/city `<Select>` input → region gazetteer freshness correction → region-transition containment matching → region OR-union hardening → benefits list URL state + validated `returnTo` navigation.

Beta-facing changes:
- **Personalization/ranking**: `domain/benefit/personalization.ts` (new) — deterministic strength/dimension/region-specificity evidence; `recommend.ts` now sorts by status → strength → dimension count → region specificity → interest → deadline → id (fully deterministic, no numeric score shown to users).
- **Eligibility-status presentation**: Home now passes `statuses` through to `BenefitMiniRow`, which renders "확인이 필요해요" on every UNKNOWN card.
- **Category/topic semantics**: `domain/benefit/topics.ts` (new) centralizes category/facet derivation; Youth Center's `asset_building` false-positive rate dropped from 396→29 (removed 371 false positives triggered by the bare "금융" token in Youth's combined `lclsfNm`).
- **Employment/education fidelity**: now independent onboarding/profile fields (107 real catalog records require both simultaneously, per the original baseline audit).
- **Province/city input**: converted from free-text to a canonical `<Select>` seeded per-province from the gazetteer, in both onboarding and profile-edit.
- **Administrative transition compatibility**: `matchRegion()` now containment- and OR-union-aware for the two verified 2026-07-01 transitions (Gwangju/Jeonnam, three Incheon splits).
- **Navigation/list-state persistence**: `/benefits` query/group/category/sort/page now live in the URL; detail pages carry a validated `returnTo` (allow-list: `/benefits[?...]`, `/home`, `/saved`).

No changes to: onboarding-profile shape beyond the employment/education split, Youth `zipCd` (still unwired), API provider/cache architecture.

---

## 2. Core user journeys (code-level, not just test names)

| # | Journey | Result | Evidence |
|---|---|---|---|
| A | Onboarding → profile stored → Home recommendations | **PASS** | `OnboardingFlow.tsx`: `setProfile(profile); completeOnboarding(); router.push("/home")`; `useMatchedBenefits` fetches on profile-key change. |
| B | Home rec → detail → back to /home | **PASS** | `BenefitMiniRow returnTo="/home"` (home/page.tsx); `resolveReturnTo` allow-lists `/home`; `benefitDetailBackLink.test.ts`. |
| C | List: search→group→category→sort→page2+→detail→back→exact state restored | **PASS** | `BenefitsPageClient.tsx` URL-as-source-of-truth + `currentListUrl` threaded as `returnTo`; `benefitsPageClient.test.ts` (13 tests), all passing. |
| D | Saved → detail → back to /saved | **PASS** | `saved/page.tsx` passes `returnTo="/saved"`; `benefitDetailBackLink.test.ts`. |
| E | Profile edit recalculates without deleting independent fields | **PASS** | `profileStore.updateProfile`: `{...state.profile, ...patch}` spread merge, never `setProfile` on partial edits. |
| F | Province/city edit → canonical residence | **PASS** | Both onboarding and `/profile` use the same `getCitiesForProvince`-seeded `<Select>`; city cleared (never fuzzy-mapped) on province change. |
| G | Refresh/deep-link `/benefits?...` → identical resolved request | **PASS** | `parseListState` is total/pure; `benefitsPageClient.test.ts` test 1 asserts exact POST body from a deep-link URL. |

All 7: **PASS**.

---

## 3. Frozen-catalog personalization audit — current state (13,712 items, re-run this checkpoint)

Script: `scripts/auditBetaReadiness.ts` (new, read-only, reuses the real `matchBenefitsDetailed`/`getRecommendedBenefits`/`getUnknownBenefits` exactly as `app/api/benefits/match/route.ts` calls them). Artifact: `docs/audits/beta-readiness-personalization.json`.

| Profile | likely_eligible | unknown | not_eligible | relevant feed | Home recommended | Home needsReview |
|---|---|---|---|---|---|---|
| A 이천 무직 청년 | 0 | 7805 | 5907 | 6413 | 10 (100% unknown) | 10 |
| B 서울 대학생 | 0 | 7974 | 5738 | 6365 | 10 (100% unknown) | 10 |
| C 수원 고소득 직장인 | 0 | 7557 | 6155 | 6149 | 10 (100% unknown) | 10 |
| D 이천 신혼부부 | 0 | 7950 | 5762 | 6248 | 10 (100% unknown) | 10 |
| E 전남 한부모 | 0 | 8032 | 5680 | 6305 | 10 (100% unknown) | 10 |
| F 최소 입력 | 0 | 9844 | 3868 | 8091 | **0** (empty state) | 10 |

Top-10 (Home "다모아 추천", the bucket that actually ships to a beta tester): for profiles A–E, **100% `strong` personalization strength, 100% `government` (MOIS) source, 0% `youth_policy`.** Region-specific evidence present in 5/10 (A) to 10/10 (C, D, E) of Top-10; interest overlap 0–10/10 depending on profile. `likely_eligible` is still **0 for every profile**, unchanged from the pre-pass baseline (`docs/beta-personalization-audit.md` §1) — this is the same known, previously-flagged, deliberately-unresolved root cause (MOIS/Youth adapters unconditionally mark partial rule trees `incomplete`), not a regression.

---

## 4. Youth region leakage (measured, not fixed)

For both Icheon profiles (A, D): **Home Top-10 and Top-20 contain 0 Youth Center items** — the new strength-based ranking (§3) already deprioritizes Youth's single-dimension, region-blind matches below MOIS's multi-dimension strong matches, as a side effect of the personalization-ranker checkpoint, not a deliberate region fix.

However, Youth Center items remain **831/6413 (13.0%)** of Profile A's full "relevant feed" (**604/6248, 9.7%** for D) — reachable via `/benefits` list browsing, especially if sorted away from "recommended". Of those, a title/org heuristic (audit-only, matches other Korean city/province names, never used in production logic) flags **545 (A) / 476 (D)** as *looking* geographically local to somewhere other than Icheon, with **no verified `region_in` evidence**. Representative examples (Profile A, org `전남광주통합특별시`):
- `youth-20260831005400213366` — "[남구] 2026년 청년 구직자(근로자) 취업장려금 지원"
- `youth-20260831005400213363` — "2026년 전남광주통합특별시 청년축제"
- `youth-20260828005400213360` — "[소진 마감]2026 동구 청년 웰컴 박스"

**Risk classification: LOW for the Home surface (primary entry point, measured 0/10 and 0/20), MODERATE for full-catalog `/benefits` browsing.** `zipCd` remains unresolved by design (out of scope for this checkpoint) — not implemented here.

---

## 5. Eligibility-status product risk

- `likely_eligible` = 0 across all 6 profiles, entire 13,712-item catalog (§3) — unchanged from baseline.
- 100% of non-empty Home "recommended" items are UNKNOWN status.
- Every UNKNOWN card (`BenefitMiniRow`, `EligibilityBadge` in `BenefitCard`) **always** visibly renders "확인이 필요해요" — verified in component source, no code path omits it for UNKNOWN.
- Real risk: the section heading "다모아 추천" plus a small, easy-to-miss badge could still read as "these are your matches" to a first-time tester, even though nothing is mislabeled. This is a **product-copy/comprehension question, not a bug** — flagged as P1, and is the specific thing the beta test plan (§12) is designed to measure via the "확인이 필요해요 이해도" question.

---

## 6. Dead/misleading user controls

- **Confirmed: the `/benefits` list's category-filter chip row still exposes a dead "예금" (deposit) chip.** `ALL_CATEGORIES = Object.keys(CATEGORY_LABELS)` (`BenefitsPageClient.tsx:29`) includes `deposit`, which has **0/13,712** real coverage on both `category` and `financialFacets` (`docs/audits/category-topic-precision-audit.json`: `financialFacetCoverage.deposit: 0`). Tapping it always yields the empty state. (`savings`/`loan` chips are NOT dead — `matchesBenefitFacet` checks `financialFacets`, which has real coverage: 36/488.) Onboarding's `INTEREST_CATEGORIES` already correctly excludes `deposit` — this is a straggler on the list page specifically.
- **Newly confirmed: the "금융상품" (Financial Products) top-level group tab is always empty in production.** `getSourceGroup()` only returns `"financial"` for `source.type ∈ {bank, savings_bank, financial_institution, card, insurance, securities}`; neither `MOISAdapter` (`government`) nor `YouthAdapter` (`youth_policy`) ever produce those types, and `FSSFinancialProductProvider` is never registered in `providers/index.ts` (only MOIS/Youth are wired regardless of env). Not a crash — the existing "조건에 맞는 혜택이 없어요" empty state renders correctly — but it's an always-empty primary nav tab.
- No other dead category/interest chips found; province/city selects are gazetteer-seeded and always produce a valid, matchable value.

---

## 7. Performance readiness

Benchmarked locally with `scripts/benchmarkProductionStability.ts` (frozen snapshots, zero live calls):

| Stage | Cold | Warm |
|---|---|---|
| MOIS catalog build | 422.1ms | 0.0ms |
| Youth catalog build | 98.8ms | 0.0ms |
| Merged catalog + candidate index | 34.4ms | 0.1ms |
| **Total (first request in a fresh process)** | **~555ms** | **~0.1ms** |
| Representative match request (candidates=6850/12356) | 38.3ms | — |

These are **local benchmark numbers only** — not a substitute for real Vercel production timing, which is not claimed here. `lib/cache/resilientCache.ts` correctly distinguishes `uninitialized`/`healthy`/`stale`/`unavailable` and serves stale-if-error last-known-good data on upstream failure (never silently empties). The cache is **process-local** (in-memory, not shared across serverless instances) — acceptable for 5 concurrent testers at low request volume (worst case ~600ms on a genuinely cold instance, then fast), but a real blocker for wider/production scale-up if the hosting platform recycles instances frequently. **Not a blocker for a 5-person beta.**

---

## 8. Error/safety audit

| Check | Result |
|---|---|
| No mock backfill when a real provider key is configured | **PASS** — `providers/index.ts`: `realProviders.length > 0 ? realProviders : [Mock]` (all-or-nothing, never blended) |
| Server-only API keys never reach the client bundle | **PASS** — `MOIS_API_KEY`/`YOUTH_POLICY_API_KEY` read only in `providers/index.ts`/adapters (no `"use client"` in those files); no matches outside server code |
| No secrets committed | **PASS** — only `.env.example` tracked; `.env*` gitignored |
| Invalid `returnTo` cannot cause an open redirect | **PASS** — exact-pathname allow-list (`/benefits[?...]`, `/home`, `/saved`); `benefitReturnTo.test.ts` covers `https://evil.com`, `//evil.com`, `javascript:`, `data:`, path traversal, unknown paths |
| Missing official/application URL hidden, never invented | **PASS** — `ExternalLinkButton`: `if (!href) return null` |
| `not_eligible` never shown as a personalized recommendation | **PASS** — `getRecommendedBenefits`/`isRelevantForFeed` filter it out before ranking |
| UNKNOWN never presented as confirmed eligibility | **PASS** (see §5 caveat — correctly labeled, comprehension risk only) |
| Malformed benefits-list URL params fail safely | **PASS** — `parseListState` is total, falls back to defaults (`benefitListState.test.ts`) |
| API failure has a user-visible, non-crashing state | **PASS** — Home, `/benefits`, and detail all render an `EmptyState` on `error`/`notFound`, never a blank crash |

No safety issues found.

---

## 9. Mobile/basic UX (code-level)

- `AppShell` is `max-w-md mx-auto` mobile-first single-column shell with `pb-24` clearance for `BottomNav` — low horizontal-overflow risk by construction.
- Filter/category chip rows use `-mx-4 overflow-x-auto px-4 scrollbar-none` (horizontal scroll, not wrap/clip).
- All selects (`components/ui/select.tsx`) are native `<select>` elements — uses the OS picker, no custom-dropdown mobile usability risk.
- Every checked surface (Home, `/benefits`, detail) has an `EmptyState` with actionable recovery copy ("필터를 변경해 보세요" / "잠시 후 다시 시도해 주세요") — no dead ends found.
- Not exhaustively pixel-audited on a real device; this is a code-level pass only.

---

## 10. Quality gates

| Gate | Result |
|---|---|
| `npm run typecheck` | ✅ pass |
| `npm run lint` | ✅ 0 errors (1 pre-existing warning, unrelated file: `scripts/auditPersonalizationBaseline.ts:421`, unused var) |
| `npm test` | ✅ 937/937 tests, 57/57 files |
| `npm run build` | ✅ success; route shapes unchanged (`/benefits` ○ static, `/benefits/[id]` ƒ dynamic) |
| `git diff --check` | ✅ clean (no whitespace errors) |
| Branch relation | `main` is a strict ancestor of `wip/beta-personalization-pass` (linear, no conflicts) |

No GitHub Actions run is claimed or referenced — none was checked/exists for this SHA.

---

## 11. Verdict and issues

### Verdict: `READY_AFTER_SMALL_FIXES`

No P0s. Two of the four P1s below are trivial, zero-risk UI-list fixes; the other two are pre-existing, already-flagged, deliberately-deferred product decisions that this very beta is well suited to inform — none of the four blocks running the 5-person smoke test itself, but the two cheap ones should land first since they cost nothing and remove confusing dead surfaces.

**P0 (blocks beta): none found.**

**P1 (should fix before testers):**
1. **Dead "예금" category filter chip** (§6). Evidence: `BenefitsPageClient.tsx:29`, `financialFacetCoverage.deposit: 0`. Smallest next checkpoint: exclude `deposit` from the list page's `ALL_CATEGORIES` the same way `INTEREST_CATEGORIES` already excludes it (one-line change, no logic risk).
2. **Always-empty "금융상품" group tab** (§6). Evidence: `domain/benefit/sourceGroup.ts`, `providers/index.ts` (FSS never registered). Smallest next checkpoint: hide the `financial` tab from `GROUP_FILTERS` until FSS is a real provider, or add a "곧 추가돼요" empty-state variant for that specific tab.
3. **`likely_eligible` structurally unreachable** (§1/§5, pre-existing). Not touched here per scope. Smallest next checkpoint: explicit product sign-off on loosening the MOIS/Youth "incomplete" downgrade for specific well-verified dimension combinations, OR a copy-only change strengthening the "다모아 추천" section's disclaimer — this beta's comprehension question (§12) is designed to inform that decision.
4. **Youth Center region leakage in full-catalog browse** (§4). Mitigated for Home (0/10, 0/20) but present at 13%/9.7% of the Icheon profiles' full relevant feed. Smallest next checkpoint: a `zipCd`→행정동 crosswalk research spike (no implementation yet).

**P2 (can learn from beta safely):**
1. Process-local/cold-start cache architecture (§7) — fine at 5-tester scale, revisit before wider rollout.
2. Youth `zipCd` remains fundamentally unresolved (root cause of P1-4) — same item, tracked separately as the underlying architecture gap.
3. "확인이 필요해요" comprehension — explicitly the subject of the §12 test plan; genuinely better learned from real testers than guessed at.

---

## 12. 5-person beta smoke-test plan

Manual instrumentation only — **no analytics infrastructure exists in this codebase today** (confirmed: no analytics SDK/event-tracking imports found in `app/`/`components/`/`hooks/`). Everything below must be recorded manually (a shared spreadsheet/form, moderator notes, or a short post-session interview) — do not assume any of it is auto-logged.

Per tester, record:
1. **Onboarding completion** — did they finish onboarding without abandoning? (yes/no, and if no, at which step)
2. **Onboarding time** — wall-clock start-to-finish (stopwatch or timestamp the moderator notes)
3. **Top-10 perceived relevance** — ask directly: "처음 나온 10개 중 실제로 나와 관련 있다고 느낀 혜택이 몇 개였나요?" (0–10)
4. **Useful new benefit discovered** — did they name at least one benefit they didn't already know about and found genuinely useful? (yes/no + which one)
5. **Obvious mismatch count** — how many of the 10 felt clearly irrelevant to them (wrong region, wrong life stage, etc.)?
6. **Detail clicks** — count of benefit detail pages opened
7. **Official-link clicks** — count of "신청하러 가기"/"공식 안내 페이지" taps
8. **Save usage** — did they use the save/bookmark feature at all? how many saves?
9. **"확인이 필요해요" understanding** — ask directly: did they understand this means "not yet confirmed, please check yourself" rather than "you don't qualify" or "you're approved"? (this is the direct probe for the P1-3 risk in §11)
10. **Loading/error complaints** — any spontaneous mention of slowness, blank screens, or broken-feeling states

Suggested moderation: watch each session live or via screen-share where possible (especially for items 3/5/9, which need a follow-up question, not just click data) rather than relying solely on self-reported logs.
