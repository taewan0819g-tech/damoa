# LocalGraph

A trust-based local social graph: **where are people I trust actually going?**

LocalGraph answers that question by showing you places through the lens of your
real social graph — direct friends first, then friends-of-friends, then your
wider trusted network — instead of star-rating averages from strangers or paid
placements. No DMs, no Stories, no live location tracking, no ads, no
gamification. Just: who you actually know, and where they actually went.

The product name is a placeholder centralized in [`config/constants.ts`](config/constants.ts)
(`APP_NAME`) — nothing else in the codebase hard-codes the literal string, so
rebranding is a one-line change.

## Table of contents

- [Product](#product)
- [Quick start](#quick-start)
- [Demo Mode](#demo-mode)
- [Architecture](#architecture)
- [Privacy model](#privacy-model)
- [Recommendation system](#recommendation-system)
- [Database](#database)
- [Project structure](#project-structure)
- [Scripts](#scripts)
- [Roadmap / known limitations](#roadmap--known-limitations)

## Product

- **Home feed** — a chronological, grouped feed of visits and reviews from
  your social graph, filterable by 전체 / 친구 (friends) / 친구의 친구
  (friends-of-friends).
- **Map** — trust-weighted pins (color reflects how close the visitors are to
  you socially), with a bottom sheet preview and full place detail on tap.
- **Place detail** — social proof ("예린 외 4명이 다녀왔어요"), a "왜
  추천됐나요?" explanation of the recommendation, a review breakdown
  (% who'd revisit, go solo, etc.), and a network reviews list.
- **Add / Review flow** — a lightweight multi-step flow to log a visit or
  leave a review (star rating → tags → optional note → visibility), not a
  full-blown content-creation tool.
- **Saved, Profile, Circles, Search, Notifications, Settings** — the
  supporting surfaces, including a dedicated privacy settings page
  (`/settings/privacy`) that controls friend-of-friend visibility.
- **Anonymous reviews** — a reviewer can post anonymously; the display
  identity degrades gracefully by social distance ("친구 네트워크 사용자" →
  "친구의 친구" → "LocalGraph 사용자") and is enforced server-side with
  k-anonymity (see [Privacy model](#privacy-model)).

**Explicitly out of scope** (by design, not by omission): direct messages,
Stories/ephemeral content, live location tracking, payments/reservations,
ads, gamification (points/badges/leaderboards), and public global rankings
disconnected from your own network.

Mobile-first (bottom nav), with a desktop layout that switches to a side nav
rail once the viewport clears the `md` breakpoint (`app/(app)/layout.tsx`).
All UI copy is Korean-first.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). With no environment
variables set, the app boots straight into **Demo Mode** — no Supabase
project, no API keys, no signup required.

## Demo Mode

`IS_SUPABASE_CONFIGURED` (`config/constants.ts`) is `true` only when both
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set.
Whenever it's `false` — i.e. out of the box — `DEMO_MODE` is `true` and:

- Auth is bypassed: you're automatically signed in as a seeded demo user
  (`DEMO_PRIMARY_USERNAME = "taewan"`).
- All data reads/writes hit an in-memory store (`lib/demo/store.ts`) seeded
  deterministically from a fixed PRNG seed (`lib/demo/seedData.ts`), so the
  same social graph, places, visits, and reviews appear on every run.
- The full social graph (direct friends, friends-of-friends, shared circles),
  privacy settings, and a k-anonymity edge case (a place with a visitor set
  smaller than the threshold) are seeded on purpose, so every privacy rule in
  the app is exercisable without any manual setup.

You can force either mode explicitly with `NEXT_PUBLIC_DEMO_MODE=true|false`.

To run against real Supabase, copy `.env.example` to `.env.local` and fill in
your project's URL/keys — see [Database](#database) for the current state of
that wiring.

## Architecture

- **Next.js 16 App Router**, TypeScript, Tailwind, shadcn-style components
  (Radix primitives + `class-variance-authority`).
- **Repository pattern**: every data access goes through an interface in
  [`lib/repositories/types.ts`](lib/repositories/types.ts), with two
  implementations — `lib/repositories/demo/*` (in-memory) and
  `lib/repositories/supabase/*` (Postgres via Supabase). UI code and server
  actions never import either implementation directly; they call
  [`lib/repositories/factory.ts`](lib/repositories/factory.ts), which is the
  single place that decides which backend to use.
- **Business logic lives in `lib/`, not in components or SQL**:
  - `lib/social/socialGraphService.ts` — social distance (`self` →
    `direct_friend` → `friend_of_friend`/`shared_circle` → `network` →
    `stranger`), shared circles, per-place social summaries.
  - `lib/privacy/privacyService.ts` — the single gate for "can this viewer
    see this visit/review," and the **only** place that assembles
    client-facing `SafeReview`/`SafeVisit` objects. Nothing else is allowed
    to hand raw `Review`/`Visit` rows to the client.
  - `lib/recommendations/recommendationService.ts` — the scoring formula
    (see below).
  - `lib/ranking/decay.ts` — recency decay math.
- **Three Supabase client variants** (`lib/supabase/*`): a server client
  bound to the request's cookies (RLS-scoped, anon key), a service-role
  client (bypasses RLS, server-only, used by the real repositories), and a
  browser client (anon key, for any client-side Supabase Auth calls).

## Privacy model

Privacy is enforced in two layers, deliberately not one:

1. **Application layer (authoritative)** — `lib/privacy/privacyService.ts`
   decides visibility using the social graph and each user's settings:
   - `private` → owner only.
   - `friends` → direct friends (visits also extend to friends-of-friends,
     but only if the sharer opted in via `showToFriendsOfFriends`; **review**
     visibility is stricter and never extends past direct friends).
   - `public` → visible to anyone, *unless* a block exists between the two
     users in either direction, which overrides every other rule.
   - **k-anonymity** (`K_ANONYMITY_THRESHOLD = 4`): an anonymous review's
     display identity is only allowed to be as specific as the viewer's
     social distance to the author *if* the place's total visible-visitor
     set is ≥ 4. Below that threshold, every viewer — even the author's
     direct friend — sees a fully generic label ("LocalGraph 사용자"). The
     true author (`SafeReview.author`) is never attached to anonymous
     content, for any viewer, at any distance.
2. **Database layer (defense-in-depth)** — every table in
   `supabase/migrations/0001_init.sql` has RLS enabled. The real
   repositories run with the **service-role client**, which bypasses RLS
   entirely, because the k-anonymity/graph-distance rules above are business
   logic that can't be expressed correctly as row-level SQL policies without
   duplicating (and risking drift from) the app-layer implementation. RLS
   policies exist to constrain any *other* client that might one day query
   Postgres directly (e.g. a future mobile client hitting Supabase with the
   anon key) to strictly own-rows-only access — they are a safety net, not
   the primary enforcement mechanism.

This is tested end-to-end in [`__tests__/privacyService.test.ts`](__tests__/privacyService.test.ts)
across five scenarios: private content, friends-only visibility, opt-in
friend-of-friend visibility, k-anonymity fallback, and blocking.

## Recommendation system

```
Score = 0.35·SocialProximity + 0.25·Recency + 0.20·TasteSimilarity
      + 0.15·NetworkQuality + 0.05·Novelty
```

All weights live in [`config/ranking.ts`](config/ranking.ts), not scattered
through components, so the model can be re-tuned in one place.

- **SocialProximity** — `1.0` direct friend, `0.65` friend-of-friend, `0.55`
  shared circle, `0.25` general network, `0` no connection.
- **Recency** — `exp(-daysSince / 21)`, i.e. exponential (e-folding) decay
  clamped to `[0, 1]`; a visit today scores ≈1, one from 21 days ago scores
  `e⁻¹ ≈ 0.37`.
- **TasteSimilarity** — overlap between the viewer's stated interests/past
  behavior and the place's category/tags.
- **NetworkQuality** — the place's average rating *within the viewer's
  network*, adjusted with a Bayesian shrinkage prior (`priorMean = 3.4`,
  `priorWeight = 5`) so a single 5-star review from one friend doesn't
  outrank a place with a dozen consistently-positive reviews.
- **Novelty** — a small boost for places the viewer hasn't already visited.

`generateReasons()` turns the winning components into the human-readable
"왜 추천됐나요?" copy shown in the UI — it never leaks raw weights or scores
into that copy (enforced by a test assertion). All of the above are pure,
side-effect-free functions, unit-tested in
[`__tests__/recommendationService.test.ts`](__tests__/recommendationService.test.ts)
and [`__tests__/decay.test.ts`](__tests__/decay.test.ts).

## Database

The full schema is in
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql):
`profiles`, `relationships`, `circles`/`circle_members`, `places`, `visits`,
`reviews`/`review_tags`, `collections`/`saved_places`, `reactions`,
`reports`, `notifications`, and `privacy_settings` — with indexes on every
hot query path, an `updated_at` trigger, and RLS policies on every table
(see [Privacy model](#privacy-model) for why RLS is defense-in-depth rather
than the primary gate). Notably, `reactions` restricts `SELECT` to a user's
own rows, since a raw reaction row carries `user_id` and could otherwise be
used to de-anonymize who "helpful"-reacted on an anonymous review; `places`
has no client-facing write policies (curated server-side only).

**Current state**: `lib/repositories/supabase/*` implements the full
repository interface against this schema, but
[`lib/repositories/factory.ts`](lib/repositories/factory.ts) is currently
hardcoded to always return the Demo repositories. Wiring the factory to
switch on `backendMode`/`IS_SUPABASE_CONFIGURED` and connecting real
Supabase Auth is the next step for anyone taking this past demo mode — see
[Roadmap](#roadmap--known-limitations).

## Project structure

```
app/
  (app)/            authenticated shell — home, map, place, add, review,
                     saved, profile, circles, search, notifications, settings
  login/, onboarding/
components/          UI components, grouped by feature (settings/, add/, search/, ...)
config/              constants.ts (app name, demo mode, nav) + ranking.ts (weights)
lib/
  repositories/      types.ts (interfaces) + demo/ + supabase/ + factory.ts
  social/            social graph distance, shared circles, place summaries
  privacy/           visibility rules, k-anonymity, SafeReview/SafeVisit assembly
  recommendations/   scoring formula
  ranking/           recency decay math
  demo/              in-memory store + deterministic seed data
  auth/, supabase/, feed/, map/, reviews/, i18n/, analytics/, utils/
supabase/migrations/ SQL schema + RLS policies
types/               shared TS domain types
__tests__/           vitest unit tests for the business logic above
```

## Scripts

```bash
npm run dev         # start the dev server
npm run build        # production build (Turbopack)
npm run start        # run the production build
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm run test          # vitest run
```

## Roadmap / known limitations

- Wire `lib/repositories/factory.ts` to actually switch to the Supabase
  repositories when configured (currently always Demo, by design, until real
  Supabase Auth is connected end-to-end).
- Real photo uploads (Demo Mode uses stock photography for visit/review
  images).
- Push notifications for the in-app notification center.
