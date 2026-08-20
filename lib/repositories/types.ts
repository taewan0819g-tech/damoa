import type {
  AppNotification,
  Circle,
  Collection,
  Place,
  PrivacySettings,
  RelationshipStatus,
  Review,
  ReviewTag,
  SavedPlace,
  UserProfile,
  UUID,
  Visit,
} from "@/types/domain";

export interface Relationship {
  id: UUID;
  requesterId: UUID;
  addresseeId: UUID;
  status: RelationshipStatus;
  createdAt: string;
}

export interface CreateVisitInput {
  userId: UUID;
  placeId: UUID;
  visitedAt: string;
  visibility: Visit["visibility"];
  companionIds?: UUID[];
}

export interface CreateReviewInput {
  userId: UUID;
  placeId: UUID;
  visitId: UUID | null;
  rating: number;
  reviewText: string | null;
  revisitIntention: Review["revisitIntention"];
  tags: ReviewTag[];
  visibility: Review["visibility"];
}

export interface PlaceRepository {
  getById(id: UUID): Promise<Place | null>;
  list(): Promise<Place[]>;
  search(query: string): Promise<Place[]>;
  getNearby(lat: number, lng: number, radiusKm: number): Promise<Place[]>;
}

export interface VisitRepository {
  getByPlace(placeId: UUID): Promise<Visit[]>;
  getByUser(userId: UUID): Promise<Visit[]>;
  create(input: CreateVisitInput): Promise<Visit>;
  remove(visitId: UUID, requesterId: UUID): Promise<void>;
}

export interface ReviewRepository {
  getById(id: UUID): Promise<Review | null>;
  getByPlace(placeId: UUID): Promise<Review[]>;
  getByUser(userId: UUID): Promise<Review[]>;
  create(input: CreateReviewInput): Promise<Review>;
  addReaction(reviewId: UUID, userId: UUID): Promise<void>;
  getHelpfulCount(reviewId: UUID): Promise<number>;
  hasReacted(reviewId: UUID, userId: UUID): Promise<boolean>;
  report(reviewId: UUID, reporterId: UUID, reason: string, details: string | null): Promise<void>;
}

export interface SocialRepository {
  getProfile(userId: UUID): Promise<UserProfile | null>;
  getProfileByUsername(username: string): Promise<UserProfile | null>;
  listUsers(): Promise<UserProfile[]>;
  getRelationships(userId: UUID): Promise<Relationship[]>;
  isBlocked(userIdA: UUID, userIdB: UUID): Promise<boolean>;
  getCircles(userId: UUID): Promise<Circle[]>;
  addFriend(requesterId: UUID, addresseeId: UUID): Promise<void>;
}

export interface SavedPlaceRepository {
  getByUser(userId: UUID): Promise<SavedPlace[]>;
  getCollections(userId: UUID): Promise<Collection[]>;
  save(userId: UUID, placeId: UUID, collectionId: UUID | null): Promise<SavedPlace>;
  unsave(userId: UUID, placeId: UUID): Promise<void>;
  createCollection(userId: UUID, name: string): Promise<Collection>;
}

export interface NotificationRepository {
  getByUser(userId: UUID): Promise<AppNotification[]>;
  markRead(notificationId: UUID): Promise<void>;
}

export interface PrivacyRepository {
  getSettings(userId: UUID): Promise<PrivacySettings>;
  updateSettings(userId: UUID, patch: Partial<PrivacySettings>): Promise<PrivacySettings>;
}
