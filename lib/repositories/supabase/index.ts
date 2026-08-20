import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AppNotification,
  Circle,
  Collection,
  Place,
  PrivacySettings,
  Review,
  SavedPlace,
  UserProfile,
  UUID,
  Visit,
} from "@/types/domain";
import type {
  CreateReviewInput,
  CreateVisitInput,
  NotificationRepository,
  PlaceRepository,
  PrivacyRepository,
  Relationship,
  ReviewRepository,
  SavedPlaceRepository,
  SocialRepository,
  VisitRepository,
} from "@/lib/repositories/types";
import { mapPlaceRow, mapProfileRow, mapReviewRow, mapSavedPlaceRow, mapVisitRow } from "./mappers";

/**
 * Supabase-backed repositories. Structurally mirror the Demo repositories so
 * the rest of the app never has to know which backend is active (see
 * lib/repositories/factory.ts). Requires the schema in supabase/migrations.
 */

export class SupabasePlaceRepository implements PlaceRepository {
  constructor(private db: SupabaseClient) {}

  async getById(id: UUID): Promise<Place | null> {
    const { data } = await this.db.from("places").select("*").eq("id", id).maybeSingle();
    return data ? mapPlaceRow(data) : null;
  }

  async list(): Promise<Place[]> {
    const { data } = await this.db.from("places").select("*").limit(500);
    return (data ?? []).map(mapPlaceRow);
  }

  async search(query: string): Promise<Place[]> {
    const { data } = await this.db
      .from("places")
      .select("*")
      .or(`name.ilike.%${query}%,neighborhood.ilike.%${query}%,category.ilike.%${query}%`)
      .limit(50);
    return (data ?? []).map(mapPlaceRow);
  }

  async getNearby(lat: number, lng: number, radiusKm: number): Promise<Place[]> {
    // MVP approximation using a lat/lng bounding box; a PostGIS `ll_to_earth`
    // radius query is the natural upgrade once the extension is enabled.
    const degreeRadius = radiusKm / 111;
    const { data } = await this.db
      .from("places")
      .select("*")
      .gte("latitude", lat - degreeRadius)
      .lte("latitude", lat + degreeRadius)
      .gte("longitude", lng - degreeRadius)
      .lte("longitude", lng + degreeRadius);
    return (data ?? []).map(mapPlaceRow);
  }
}

export class SupabaseVisitRepository implements VisitRepository {
  constructor(private db: SupabaseClient) {}

  async getByPlace(placeId: UUID): Promise<Visit[]> {
    const { data } = await this.db.from("visits").select("*").eq("place_id", placeId);
    return (data ?? []).map(mapVisitRow);
  }

  async getByUser(userId: UUID): Promise<Visit[]> {
    const { data } = await this.db.from("visits").select("*").eq("user_id", userId).order("visited_at", { ascending: false });
    return (data ?? []).map(mapVisitRow);
  }

  async create(input: CreateVisitInput): Promise<Visit> {
    const { data, error } = await this.db
      .from("visits")
      .insert({
        user_id: input.userId,
        place_id: input.placeId,
        visited_at: input.visitedAt,
        visibility: input.visibility,
        companion_ids: input.companionIds ?? [],
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapVisitRow(data);
  }

  async remove(visitId: UUID, requesterId: UUID): Promise<void> {
    await this.db.from("visits").delete().eq("id", visitId).eq("user_id", requesterId);
  }
}

export class SupabaseReviewRepository implements ReviewRepository {
  constructor(private db: SupabaseClient) {}

  async getById(id: UUID): Promise<Review | null> {
    const { data } = await this.db.from("reviews").select("*, review_tags(tag)").eq("id", id).maybeSingle();
    return data ? mapReviewRow(data) : null;
  }

  async getByPlace(placeId: UUID): Promise<Review[]> {
    const { data } = await this.db.from("reviews").select("*, review_tags(tag)").eq("place_id", placeId);
    return (data ?? []).map(mapReviewRow);
  }

  async getByUser(userId: UUID): Promise<Review[]> {
    const { data } = await this.db.from("reviews").select("*, review_tags(tag)").eq("user_id", userId);
    return (data ?? []).map(mapReviewRow);
  }

  async create(input: CreateReviewInput): Promise<Review> {
    const { data, error } = await this.db
      .from("reviews")
      .insert({
        user_id: input.userId,
        place_id: input.placeId,
        visit_id: input.visitId,
        rating: input.rating,
        review_text: input.reviewText,
        revisit_intention: input.revisitIntention,
        visibility: input.visibility,
      })
      .select("*")
      .single();
    if (error) throw error;
    if (input.tags.length > 0) {
      await this.db.from("review_tags").insert(input.tags.map((tag) => ({ review_id: data.id, tag })));
    }
    return mapReviewRow({ ...data, review_tags: input.tags.map((tag) => ({ tag })) });
  }

  async addReaction(reviewId: UUID, userId: UUID): Promise<void> {
    const { data: existing } = await this.db
      .from("reactions")
      .select("id")
      .eq("review_id", reviewId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) {
      await this.db.from("reactions").delete().eq("id", existing.id);
      return;
    }
    await this.db.from("reactions").insert({ review_id: reviewId, user_id: userId, type: "helpful" });
  }

  async getHelpfulCount(reviewId: UUID): Promise<number> {
    const { count } = await this.db.from("reactions").select("id", { count: "exact", head: true }).eq("review_id", reviewId);
    return count ?? 0;
  }

  async hasReacted(reviewId: UUID, userId: UUID): Promise<boolean> {
    const { data } = await this.db.from("reactions").select("id").eq("review_id", reviewId).eq("user_id", userId).maybeSingle();
    return Boolean(data);
  }

  async report(reviewId: UUID, reporterId: UUID, reason: string, details: string | null): Promise<void> {
    await this.db.from("reports").insert({ review_id: reviewId, reporter_id: reporterId, reason, details, status: "open" });
  }
}

export class SupabaseSocialRepository implements SocialRepository {
  constructor(private db: SupabaseClient) {}

  async getProfile(userId: UUID): Promise<UserProfile | null> {
    const { data } = await this.db.from("profiles").select("*").eq("id", userId).maybeSingle();
    return data ? mapProfileRow(data) : null;
  }

  async getProfileByUsername(username: string): Promise<UserProfile | null> {
    const { data } = await this.db.from("profiles").select("*").eq("username", username).maybeSingle();
    return data ? mapProfileRow(data) : null;
  }

  async listUsers(): Promise<UserProfile[]> {
    const { data } = await this.db.from("profiles").select("*").limit(200);
    return (data ?? []).map(mapProfileRow);
  }

  async getRelationships(userId: UUID): Promise<Relationship[]> {
    const { data } = await this.db.from("relationships").select("*").or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
    return (data ?? []).map((r) => ({
      id: r.id,
      requesterId: r.requester_id,
      addresseeId: r.addressee_id,
      status: r.status,
      createdAt: r.created_at,
    }));
  }

  async isBlocked(userIdA: UUID, userIdB: UUID): Promise<boolean> {
    const { data } = await this.db
      .from("relationships")
      .select("id")
      .eq("status", "blocked")
      .or(
        `and(requester_id.eq.${userIdA},addressee_id.eq.${userIdB}),and(requester_id.eq.${userIdB},addressee_id.eq.${userIdA})`
      )
      .maybeSingle();
    return Boolean(data);
  }

  async getCircles(userId: UUID): Promise<Circle[]> {
    const { data } = await this.db.from("circle_members").select("circle_id, circles(*)").eq("user_id", userId);
    const rows = (data ?? []) as unknown as {
      circle_id: string;
      circles: { id: string; owner_id: string; name: string; description: string | null; created_at: string };
    }[];
    if (rows.length === 0) return [];

    const circleIds = rows.map((r) => r.circle_id);
    const { data: memberRows } = await this.db.from("circle_members").select("circle_id, user_id").in("circle_id", circleIds);
    const membersByCircle = new Map<string, UUID[]>();
    for (const m of (memberRows ?? []) as { circle_id: string; user_id: string }[]) {
      membersByCircle.set(m.circle_id, [...(membersByCircle.get(m.circle_id) ?? []), m.user_id]);
    }

    return rows.map(({ circles: c }) => ({
      id: c.id,
      ownerId: c.owner_id,
      name: c.name,
      description: c.description,
      memberIds: membersByCircle.get(c.id) ?? [],
      createdAt: c.created_at,
    }));
  }

  async addFriend(requesterId: UUID, addresseeId: UUID): Promise<void> {
    await this.db.from("relationships").insert({ requester_id: requesterId, addressee_id: addresseeId, status: "accepted" });
  }
}

export class SupabaseSavedPlaceRepository implements SavedPlaceRepository {
  constructor(private db: SupabaseClient) {}

  async getByUser(userId: UUID): Promise<SavedPlace[]> {
    const { data } = await this.db.from("saved_places").select("*").eq("user_id", userId);
    return (data ?? []).map(mapSavedPlaceRow);
  }

  async getCollections(userId: UUID): Promise<Collection[]> {
    const { data } = await this.db.from("collections").select("*").eq("user_id", userId);
    return (data ?? []).map((c) => ({ id: c.id, userId: c.user_id, name: c.name, createdAt: c.created_at }));
  }

  async save(userId: UUID, placeId: UUID, collectionId: UUID | null): Promise<SavedPlace> {
    const { data, error } = await this.db
      .from("saved_places")
      .insert({ user_id: userId, place_id: placeId, collection_id: collectionId })
      .select("*")
      .single();
    if (error) throw error;
    return mapSavedPlaceRow(data);
  }

  async unsave(userId: UUID, placeId: UUID): Promise<void> {
    await this.db.from("saved_places").delete().eq("user_id", userId).eq("place_id", placeId);
  }

  async createCollection(userId: UUID, name: string): Promise<Collection> {
    const { data, error } = await this.db.from("collections").insert({ user_id: userId, name }).select("*").single();
    if (error) throw error;
    return { id: data.id, userId: data.user_id, name: data.name, createdAt: data.created_at };
  }
}

export class SupabaseNotificationRepository implements NotificationRepository {
  constructor(private db: SupabaseClient) {}

  async getByUser(userId: UUID): Promise<AppNotification[]> {
    const { data } = await this.db.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    return (data ?? []).map((n) => ({
      id: n.id,
      userId: n.user_id,
      type: n.type,
      actorId: n.actor_id,
      entityType: n.entity_type,
      entityId: n.entity_id,
      readAt: n.read_at,
      createdAt: n.created_at,
      message: n.message,
    }));
  }

  async markRead(notificationId: UUID): Promise<void> {
    await this.db.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", notificationId);
  }
}

export class SupabasePrivacyRepository implements PrivacyRepository {
  constructor(private db: SupabaseClient) {}

  async getSettings(userId: UUID): Promise<PrivacySettings> {
    const { data } = await this.db.from("privacy_settings").select("*").eq("user_id", userId).maybeSingle();
    if (!data) {
      return {
        userId,
        defaultVisitVisibility: "friends",
        defaultReviewVisibility: "friends",
        showVisitHistory: true,
        showToFriendsOfFriends: true,
        allowRecommendationUsage: true,
      };
    }
    return {
      userId: data.user_id,
      defaultVisitVisibility: data.default_visit_visibility,
      defaultReviewVisibility: data.default_review_visibility,
      showVisitHistory: data.show_visit_history,
      showToFriendsOfFriends: data.show_to_friends_of_friends,
      allowRecommendationUsage: data.allow_recommendation_usage,
    };
  }

  async updateSettings(userId: UUID, patch: Partial<PrivacySettings>): Promise<PrivacySettings> {
    const { data, error } = await this.db
      .from("privacy_settings")
      .upsert({
        user_id: userId,
        default_visit_visibility: patch.defaultVisitVisibility,
        default_review_visibility: patch.defaultReviewVisibility,
        show_visit_history: patch.showVisitHistory,
        show_to_friends_of_friends: patch.showToFriendsOfFriends,
        allow_recommendation_usage: patch.allowRecommendationUsage,
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error) throw error;
    return {
      userId: data.user_id,
      defaultVisitVisibility: data.default_visit_visibility,
      defaultReviewVisibility: data.default_review_visibility,
      showVisitHistory: data.show_visit_history,
      showToFriendsOfFriends: data.show_to_friends_of_friends,
      allowRecommendationUsage: data.allow_recommendation_usage,
    };
  }
}
