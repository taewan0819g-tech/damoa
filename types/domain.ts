/**
 * Domain types used throughout the app. UI code should always consume these
 * (never raw DB rows) so the Demo and Supabase repositories are interchangeable.
 */

export type UUID = string;

export type RelationshipStatus = "pending" | "accepted" | "blocked";

export type Visibility = "public" | "friends" | "network_anonymous" | "private";

export type RevisitIntention = "definitely" | "maybe" | "probably_not" | "no";

export type PlaceCategory =
  | "cafe"
  | "korean"
  | "japanese"
  | "italian"
  | "bar"
  | "bakery"
  | "culture"
  | "outdoors";

export type ReviewTag =
  | "date"
  | "friends"
  | "solo"
  | "family"
  | "work"
  | "gathering"
  | "photo"
  | "quiet_talk"
  | "special_day";

export type ReactionType = "helpful";

export type ReportReason =
  | "misinformation"
  | "spam"
  | "abusive"
  | "personal_info"
  | "conflict_of_interest"
  | "other";

export type NotificationType =
  | "friend_request_accepted"
  | "saved_place_visited_by_friend"
  | "network_trend"
  | "review_reaction";

export interface UserProfile {
  id: UUID;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  homeArea: string | null;
  createdAt: string;
}

export interface PrivacySettings {
  userId: UUID;
  defaultVisitVisibility: Visibility;
  defaultReviewVisibility: Visibility;
  showVisitHistory: boolean;
  showToFriendsOfFriends: boolean;
  allowRecommendationUsage: boolean;
}

export interface Circle {
  id: UUID;
  ownerId: UUID;
  name: string;
  description: string | null;
  memberIds: UUID[];
  createdAt: string;
}

export interface Place {
  id: UUID;
  name: string;
  category: PlaceCategory;
  subcategory: string | null;
  address: string;
  neighborhood: string;
  latitude: number;
  longitude: number;
  priceLevel: 1 | 2 | 3 | 4;
  imageUrl: string;
  images: string[];
  isOpenNow: boolean | null;
}

export interface Visit {
  id: UUID;
  userId: UUID;
  placeId: UUID;
  visitedAt: string;
  visibility: Visibility;
  photoUrl: string | null;
  companionIds: UUID[];
}

export interface Review {
  id: UUID;
  userId: UUID;
  placeId: UUID;
  visitId: UUID | null;
  rating: number; // 0.5 - 5, half-star increments
  reviewText: string | null;
  revisitIntention: RevisitIntention;
  priceRating: number | null;
  noiseRating: number | null;
  waitRating: number | null;
  tags: ReviewTag[];
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
}

export interface SavedPlace {
  id: UUID;
  userId: UUID;
  placeId: UUID;
  collectionId: UUID | null;
  createdAt: string;
}

export interface Collection {
  id: UUID;
  userId: UUID;
  name: string;
  createdAt: string;
}

export interface AppNotification {
  id: UUID;
  userId: UUID;
  type: NotificationType;
  actorId: UUID | null;
  entityType: "place" | "review" | "user" | null;
  entityId: UUID | null;
  readAt: string | null;
  createdAt: string;
  message: string;
}

/** Relationship distance between the viewer and the content's owner. */
export type SocialDistance = "self" | "direct_friend" | "friend_of_friend" | "shared_circle" | "network" | "stranger";

/**
 * The only representation of a review author the client is ever allowed to see.
 * For anonymous/network-anonymous reviews there is no author id, username, or
 * avatar in this object — the server never sends it in the first place.
 */
export interface SafeAuthor {
  id: UUID;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface SafeReview {
  id: UUID;
  placeId: UUID;
  rating: number;
  text: string | null;
  revisitIntention: RevisitIntention;
  tags: ReviewTag[];
  visibility: Visibility;
  /** Human-readable, privacy-safe stand-in for "who wrote this". */
  displayIdentity: string;
  /** Present only for attributed (public/friends) reviews the viewer is allowed to identify. */
  author: SafeAuthor | null;
  /** Coarse time bucket for anonymous content; ISO timestamp for attributed content. */
  approximateTime: string;
  isAnonymous: boolean;
  helpfulCount: number;
  viewerFoundHelpful: boolean;
  canModerate: boolean;
}

export interface RecommendationReason {
  code: string;
  label: string;
}

export interface PlaceSocialSummary {
  placeId: UUID;
  friendVisitCount: number;
  secondDegreeVisitCount: number;
  trustedRating: number | null;
  trustedRatingCount: number;
  revisitRate: number | null;
  revisitYesCount: number;
  revisitSampleCount: number;
  recentVisitors: SafeAuthor[];
  recommendationReasons: RecommendationReason[];
  recentNetworkActivity: string | null;
  recommendationScore: number;
}

export interface FeedItem {
  id: string;
  place: Place;
  socialSummary: PlaceSocialSummary;
  headline: string;
  subline: string | null;
  actorAvatars: SafeAuthor[];
  highlightReview: SafeReview | null;
  createdAt: string;
}

export interface MapPinData {
  place: Place;
  friendVisitCount: number;
  secondDegreeVisitCount: number;
  signalStrength: "strong" | "medium" | "weak";
  recentVisitorAvatars: SafeAuthor[];
}

export interface TasteProfile {
  categories: Partial<Record<PlaceCategory, number>>;
  moods: Record<string, number>;
}

export interface ReviewBreakdown {
  date: number;
  friends: number;
  solo: number;
  family: number;
  quiet: number;
  value: number;
}
