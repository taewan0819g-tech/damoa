import type { AppNotification, Collection, Place, PrivacySettings, Review, SavedPlace, UserProfile, Visit } from "@/types/domain";
import type { Relationship } from "@/lib/repositories/types";
import {
  SEED_CIRCLES,
  SEED_COLLECTIONS,
  SEED_NOTIFICATIONS,
  SEED_PLACES,
  SEED_PRIVACY_SETTINGS,
  SEED_RELATIONSHIPS,
  SEED_REVIEWS,
  SEED_SAVED_PLACES,
  SEED_USERS,
  SEED_VISITS,
} from "./seedData";

/**
 * A single process-lifetime, in-memory store seeded with demo data. This is
 * intentionally simple (no persistence) — Demo Mode is for local exploration
 * and user interviews, not durable storage. The Supabase repositories in
 * lib/repositories/supabase implement the same interfaces against Postgres.
 */
class DemoStore {
  users: UserProfile[] = SEED_USERS.map(({ taste: _taste, ...u }) => u);
  places: Place[] = [...SEED_PLACES];
  relationships: Relationship[] = [...SEED_RELATIONSHIPS];
  circles = [...SEED_CIRCLES];
  visits: Visit[] = [...SEED_VISITS];
  reviews: Review[] = [...SEED_REVIEWS];
  savedPlaces: SavedPlace[] = [...SEED_SAVED_PLACES];
  collections: Collection[] = [...SEED_COLLECTIONS];
  notifications: AppNotification[] = [...SEED_NOTIFICATIONS];
  privacySettings: Record<string, PrivacySettings> = { ...SEED_PRIVACY_SETTINGS };
  reactions: { id: string; userId: string; reviewId: string }[] = [];
  reports: { id: string; reporterId: string; reviewId: string; reason: string; details: string | null; createdAt: string }[] = [];
  blocks: { blockerId: string; blockedId: string }[] = [];

  nextId(prefix: string) {
    return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

// Survive Next.js dev HMR by stashing the singleton on globalThis.
const g = globalThis as unknown as { __localgraphDemoStore?: DemoStore };
export const demoStore = g.__localgraphDemoStore ?? new DemoStore();
g.__localgraphDemoStore = demoStore;
