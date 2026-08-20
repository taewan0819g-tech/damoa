-- LocalGraph initial schema.
--
-- Architecture note on Row Level Security in this app: the privacy model
-- (friend-of-friend visibility, k-anonymity gating on anonymous reviews,
-- recommendation scoring) is intentionally implemented once, in application
-- code (lib/privacy/privacyService.ts, lib/social/socialGraphService.ts),
-- not duplicated as SQL. Reproducing k-anonymity thresholds or graph-distance
-- checks in RLS policies would create a second copy of the same business
-- rule that could silently drift from the app-layer copy — a classic source
-- of privacy bugs. So the Supabase repositories (lib/repositories/supabase)
-- are written to run exclusively with the service-role client
-- (createSupabaseServiceRoleClient in lib/supabase/server.ts) from trusted
-- Next.js Server Components/Server Actions, which bypasses RLS by design,
-- and the application layer is the single source of truth for who can see
-- what.
--
-- RLS is still enabled on every table below as defense-in-depth: it ensures
-- that if the anon/browser client (createSupabaseBrowserClient) is ever used
-- to query these tables directly, it can only ever see/mutate the calling
-- user's own rows — never another user's private content, and never table
-- rows that require cross-user privacy logic to interpret safely.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type relationship_status as enum ('pending', 'accepted', 'blocked');
create type visibility as enum ('public', 'friends', 'network_anonymous', 'private');
create type revisit_intention as enum ('definitely', 'maybe', 'probably_not', 'no');
create type place_category as enum ('cafe', 'korean', 'japanese', 'italian', 'bar', 'bakery', 'culture', 'outdoors');
create type review_tag as enum ('date', 'friends', 'solo', 'family', 'work', 'gathering', 'photo', 'quiet_talk', 'special_day');
create type reaction_type as enum ('helpful');
create type report_reason as enum ('misinformation', 'spam', 'abusive', 'personal_info', 'conflict_of_interest', 'other');
create type report_status as enum ('open', 'resolved', 'dismissed');
create type notification_type as enum ('friend_request_accepted', 'saved_place_visited_by_friend', 'network_trend', 'review_reaction');
create type notification_entity_type as enum ('place', 'review', 'user');

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  display_name text not null,
  avatar_url text,
  bio text,
  home_area text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles are readable by any authenticated user"
  on profiles for select to authenticated using (true);

create policy "users manage their own profile"
  on profiles for insert to authenticated with check (id = auth.uid());

create policy "users update their own profile"
  on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Relationships (friendships)
-- ---------------------------------------------------------------------------

create table relationships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles (id) on delete cascade,
  addressee_id uuid not null references profiles (id) on delete cascade,
  status relationship_status not null default 'pending',
  created_at timestamptz not null default now(),
  constraint relationships_no_self_friend check (requester_id <> addressee_id),
  constraint relationships_unique_pair unique (requester_id, addressee_id)
);

create index relationships_requester_idx on relationships (requester_id);
create index relationships_addressee_idx on relationships (addressee_id);

alter table relationships enable row level security;

create policy "participants read their relationships"
  on relationships for select to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "users create relationships as requester"
  on relationships for insert to authenticated with check (auth.uid() = requester_id);

create policy "participants update their relationships"
  on relationships for update to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id)
  with check (auth.uid() = requester_id or auth.uid() = addressee_id);

-- ---------------------------------------------------------------------------
-- Circles (small trusted groups)
-- ---------------------------------------------------------------------------

create table circles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table circle_members (
  circle_id uuid not null references circles (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);

create index circle_members_user_idx on circle_members (user_id);
create index circle_members_circle_idx on circle_members (circle_id);

alter table circles enable row level security;
alter table circle_members enable row level security;

create policy "members read their circles"
  on circles for select to authenticated
  using (
    owner_id = auth.uid()
    or exists (select 1 from circle_members cm where cm.circle_id = circles.id and cm.user_id = auth.uid())
  );

create policy "users create circles they own"
  on circles for insert to authenticated with check (owner_id = auth.uid());

create policy "owners update their circles"
  on circles for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "members read circle membership"
  on circle_members for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from circle_members cm where cm.circle_id = circle_members.circle_id and cm.user_id = auth.uid())
  );

create policy "circle owners manage membership"
  on circle_members for insert to authenticated
  with check (exists (select 1 from circles c where c.id = circle_members.circle_id and c.owner_id = auth.uid()));

create policy "circle owners remove membership"
  on circle_members for delete to authenticated
  using (exists (select 1 from circles c where c.id = circle_members.circle_id and c.owner_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Places (shared reference data — not user-owned)
-- ---------------------------------------------------------------------------

create table places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category place_category not null,
  subcategory text,
  address text not null,
  neighborhood text not null,
  latitude double precision not null,
  longitude double precision not null,
  price_level smallint not null check (price_level between 1 and 4),
  image_url text not null,
  images text[] not null default '{}',
  is_open_now boolean,
  created_at timestamptz not null default now()
);

create index places_neighborhood_idx on places (neighborhood);
create index places_category_idx on places (category);
create index places_location_idx on places (latitude, longitude);

alter table places enable row level security;

create policy "places are readable by any authenticated user"
  on places for select to authenticated using (true);

-- No insert/update/delete policy for places: place data is curated
-- server-side (service role) only, never written by end users directly.

-- ---------------------------------------------------------------------------
-- Visits
-- ---------------------------------------------------------------------------

create table visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  place_id uuid not null references places (id) on delete cascade,
  visited_at timestamptz not null,
  visibility visibility not null default 'friends',
  photo_url text,
  companion_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index visits_place_idx on visits (place_id);
create index visits_user_idx on visits (user_id, visited_at desc);

alter table visits enable row level security;

-- Anon/browser-client reads are restricted to the owner's own visits only.
-- Friend/FoF-visible visits are read through the service-role-backed
-- repositories, where lib/privacy/privacyService.ts applies the real
-- visibility rules before any data reaches the client.
create policy "users read their own visits"
  on visits for select to authenticated using (user_id = auth.uid());

create policy "users create their own visits"
  on visits for insert to authenticated with check (user_id = auth.uid());

create policy "users delete their own visits"
  on visits for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Reviews + tags
-- ---------------------------------------------------------------------------

create table reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  place_id uuid not null references places (id) on delete cascade,
  visit_id uuid references visits (id) on delete set null,
  rating numeric(2, 1) not null check (rating between 0.5 and 5 and mod(rating * 10, 5) = 0),
  review_text text,
  revisit_intention revisit_intention not null,
  price_rating smallint check (price_rating between 1 and 4),
  noise_rating smallint check (noise_rating between 1 and 4),
  wait_rating smallint check (wait_rating between 1 and 4),
  visibility visibility not null default 'friends',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table review_tags (
  review_id uuid not null references reviews (id) on delete cascade,
  tag review_tag not null,
  primary key (review_id, tag)
);

create index reviews_place_idx on reviews (place_id);
create index reviews_user_idx on reviews (user_id);
create index review_tags_review_idx on review_tags (review_id);

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger reviews_set_updated_at before update on reviews
  for each row execute function set_updated_at();

alter table reviews enable row level security;
alter table review_tags enable row level security;

create policy "users read their own reviews"
  on reviews for select to authenticated using (user_id = auth.uid());

create policy "users create their own reviews"
  on reviews for insert to authenticated with check (user_id = auth.uid());

create policy "users update their own reviews"
  on reviews for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "users read tags on their own reviews"
  on review_tags for select to authenticated
  using (exists (select 1 from reviews r where r.id = review_tags.review_id and r.user_id = auth.uid()));

create policy "users tag their own reviews"
  on review_tags for insert to authenticated
  with check (exists (select 1 from reviews r where r.id = review_tags.review_id and r.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Saved places + collections
-- ---------------------------------------------------------------------------

create table collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table saved_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  place_id uuid not null references places (id) on delete cascade,
  collection_id uuid references collections (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint saved_places_unique unique (user_id, place_id)
);

create index saved_places_user_idx on saved_places (user_id);
create index collections_user_idx on collections (user_id);

alter table collections enable row level security;
alter table saved_places enable row level security;

create policy "users manage their own collections"
  on collections for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "users manage their own saved places"
  on saved_places for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Reactions + reports (moderation)
-- ---------------------------------------------------------------------------

create table reactions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references reviews (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  type reaction_type not null default 'helpful',
  created_at timestamptz not null default now(),
  constraint reactions_unique unique (review_id, user_id, type)
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references reviews (id) on delete cascade,
  reporter_id uuid not null references profiles (id) on delete cascade,
  reason report_reason not null,
  details text,
  status report_status not null default 'open',
  created_at timestamptz not null default now()
);

create index reactions_review_idx on reactions (review_id);
create index reports_review_idx on reports (review_id);

alter table reactions enable row level security;
alter table reports enable row level security;

-- Raw reaction rows carry a user_id, so exposing them to the anon client
-- would let it work out *who* reacted to an anonymous review — a
-- deanonymization vector. Aggregate helpful counts are computed server-side
-- (getHelpfulCount) with the service-role client instead.
create policy "users read their own reactions"
  on reactions for select to authenticated using (user_id = auth.uid());

create policy "users create their own reactions"
  on reactions for insert to authenticated with check (user_id = auth.uid());

create policy "users delete their own reactions"
  on reactions for delete to authenticated using (user_id = auth.uid());

create policy "reporters read their own reports"
  on reports for select to authenticated using (reporter_id = auth.uid());

create policy "users file reports as themselves"
  on reports for insert to authenticated with check (reporter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  type notification_type not null,
  actor_id uuid references profiles (id) on delete set null,
  entity_type notification_entity_type,
  entity_id uuid,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on notifications (user_id, created_at desc);

alter table notifications enable row level security;

create policy "users read their own notifications"
  on notifications for select to authenticated using (user_id = auth.uid());

create policy "users mark their own notifications read"
  on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Privacy settings
-- ---------------------------------------------------------------------------

create table privacy_settings (
  user_id uuid primary key references profiles (id) on delete cascade,
  default_visit_visibility visibility not null default 'friends',
  default_review_visibility visibility not null default 'friends',
  show_visit_history boolean not null default true,
  show_to_friends_of_friends boolean not null default true,
  allow_recommendation_usage boolean not null default true,
  updated_at timestamptz not null default now()
);

create trigger privacy_settings_set_updated_at before update on privacy_settings
  for each row execute function set_updated_at();

alter table privacy_settings enable row level security;

create policy "users manage their own privacy settings"
  on privacy_settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
