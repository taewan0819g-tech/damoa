import { IS_SUPABASE_CONFIGURED } from "@/config/constants";
import { DemoNotificationRepository } from "@/lib/repositories/demo/notificationRepository";
import { DemoPlaceRepository } from "@/lib/repositories/demo/placeRepository";
import { DemoPrivacyRepository } from "@/lib/repositories/demo/privacyRepository";
import { DemoReviewRepository } from "@/lib/repositories/demo/reviewRepository";
import { DemoSavedPlaceRepository } from "@/lib/repositories/demo/savedPlaceRepository";
import { DemoSocialRepository } from "@/lib/repositories/demo/socialRepository";
import { DemoVisitRepository } from "@/lib/repositories/demo/visitRepository";
import type {
  NotificationRepository,
  PlaceRepository,
  PrivacyRepository,
  ReviewRepository,
  SavedPlaceRepository,
  SocialRepository,
  VisitRepository,
} from "@/lib/repositories/types";

/**
 * Single place that decides Demo vs Supabase. Everything else in the app
 * imports repositories from here rather than reaching into lib/demo or
 * lib/supabase directly, so swapping backends never touches UI code.
 *
 * Note: real Supabase wiring requires an authenticated server client per
 * request; see lib/supabase/server.ts. Until credentials are configured, all
 * repositories resolve to the in-memory Demo implementations.
 */
export function getPlaceRepository(): PlaceRepository {
  return new DemoPlaceRepository();
}

export function getVisitRepository(): VisitRepository {
  return new DemoVisitRepository();
}

export function getReviewRepository(): ReviewRepository {
  return new DemoReviewRepository();
}

export function getSocialRepository(): SocialRepository {
  return new DemoSocialRepository();
}

export function getSavedPlaceRepository(): SavedPlaceRepository {
  return new DemoSavedPlaceRepository();
}

export function getNotificationRepository(): NotificationRepository {
  return new DemoNotificationRepository();
}

export function getPrivacyRepository(): PrivacyRepository {
  return new DemoPrivacyRepository();
}

export const backendMode = IS_SUPABASE_CONFIGURED ? "supabase" : "demo";
