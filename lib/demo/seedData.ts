import type {
  AppNotification,
  Circle,
  Collection,
  Place,
  PlaceCategory,
  PrivacySettings,
  Review,
  ReviewTag,
  RevisitIntention,
  SavedPlace,
  UserProfile,
  Visit,
  Visibility,
} from "@/types/domain";
import type { Relationship } from "@/lib/repositories/types";

/**
 * All demo/seed content is clearly fictional and only used when the app runs
 * in Demo Mode (no Supabase credentials configured). No real people or real
 * business ratings are represented here.
 */

// ---------------------------------------------------------------------------
// Deterministic PRNG so the seeded graph looks the same across restarts.
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260819);
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
const daysAgoIso = (days: number, hour = 12) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

// ---------------------------------------------------------------------------
// Users — 14 fictional personas with distinct tastes (spec #85).
// ---------------------------------------------------------------------------
export type PersonaTaste = {
  categories: PlaceCategory[];
  positivity: number; // 0-1, baseline generosity when rating
};

export const SEED_USERS: (UserProfile & { taste: PersonaTaste })[] = [
  {
    id: "u1",
    username: "taewan",
    displayName: "태완",
    avatarUrl: "/avatars/u1.svg",
    bio: "성수동 카페 탐방 중 · 사진 찍는 거 좋아함",
    homeArea: "성수동",
    createdAt: daysAgoIso(400),
    taste: { categories: ["cafe", "korean", "culture"], positivity: 0.6 },
  },
  {
    id: "u2",
    username: "jin.lee",
    displayName: "진",
    avatarUrl: "/avatars/u2.svg",
    bio: "조용한 카페 아니면 안 감",
    homeArea: "연남동",
    createdAt: daysAgoIso(500),
    taste: { categories: ["cafe", "bakery", "culture"], positivity: 0.65 },
  },
  {
    id: "u3",
    username: "mina.k",
    displayName: "미나",
    avatarUrl: "/avatars/u3.svg",
    bio: "핫플 스카우터",
    homeArea: "한남동",
    createdAt: daysAgoIso(480),
    taste: { categories: ["bar", "italian", "culture"], positivity: 0.7 },
  },
  {
    id: "u4",
    username: "daniel.oh",
    displayName: "다니엘",
    avatarUrl: "/avatars/u4.svg",
    bio: "가성비 아니면 안 감",
    homeArea: "을지로",
    createdAt: daysAgoIso(460),
    taste: { categories: ["korean", "bar", "japanese"], positivity: 0.45 },
  },
  {
    id: "u5",
    username: "sohee.p",
    displayName: "소희",
    avatarUrl: "/avatars/u5.svg",
    bio: "가족이랑 갈 곳 찾는 중",
    homeArea: "잠실",
    createdAt: daysAgoIso(420),
    taste: { categories: ["korean", "japanese", "outdoors"], positivity: 0.6 },
  },
  {
    id: "u6",
    username: "hyunwoo.j",
    displayName: "현우",
    avatarUrl: "/avatars/u6.svg",
    bio: "숨은 맛집 찾아다님",
    homeArea: "을지로",
    createdAt: daysAgoIso(390),
    taste: { categories: ["korean", "bar", "japanese"], positivity: 0.55 },
  },
  {
    id: "u7",
    username: "yerin.c",
    displayName: "예린",
    avatarUrl: "/avatars/u7.svg",
    bio: "베이커리 순례 중",
    homeArea: "성수동",
    createdAt: daysAgoIso(370),
    taste: { categories: ["bakery", "cafe"], positivity: 0.68 },
  },
  {
    id: "u8",
    username: "minseo.h",
    displayName: "민서",
    avatarUrl: "/avatars/u8.svg",
    bio: "전시, 공연 좋아함",
    homeArea: "이태원",
    createdAt: daysAgoIso(350),
    taste: { categories: ["culture", "cafe", "italian"], positivity: 0.62 },
  },
  {
    id: "u9",
    username: "jiho.s",
    displayName: "지호",
    avatarUrl: "/avatars/u9.svg",
    bio: "운동 후 맛집",
    homeArea: "잠실",
    createdAt: daysAgoIso(300),
    taste: { categories: ["korean", "outdoors"], positivity: 0.5 },
  },
  {
    id: "u10",
    username: "dahye.n",
    displayName: "다혜",
    avatarUrl: "/avatars/u10.svg",
    bio: "와인바 러버",
    homeArea: "한남동",
    createdAt: daysAgoIso(280),
    taste: { categories: ["bar", "italian"], positivity: 0.58 },
  },
  {
    id: "u11",
    username: "seungwoo.b",
    displayName: "승우",
    avatarUrl: "/avatars/u11.svg",
    bio: "동아리 총무",
    homeArea: "신촌",
    createdAt: daysAgoIso(260),
    taste: { categories: ["korean", "bar"], positivity: 0.5 },
  },
  {
    id: "u12",
    username: "eunji.w",
    displayName: "은지",
    avatarUrl: "/avatars/u12.svg",
    bio: "회사 근처 맛집 스크랩러",
    homeArea: "을지로",
    createdAt: daysAgoIso(240),
    taste: { categories: ["korean", "japanese", "cafe"], positivity: 0.55 },
  },
  {
    id: "u13",
    username: "taeyang.k",
    displayName: "태양",
    avatarUrl: "/avatars/u13.svg",
    bio: "주말엔 자연으로",
    homeArea: "연남동",
    createdAt: daysAgoIso(220),
    taste: { categories: ["outdoors", "cafe"], positivity: 0.6 },
  },
  {
    id: "u14",
    username: "woojin.l",
    displayName: "우진",
    avatarUrl: "/avatars/u14.svg",
    bio: "사진 스팟 기록 중",
    homeArea: "이태원",
    createdAt: daysAgoIso(200),
    taste: { categories: ["culture", "cafe", "bar"], positivity: 0.58 },
  },
];

// ---------------------------------------------------------------------------
// Places — 30 fictional venues. Ratings/visit counts are computed from seeded
// visits & reviews below, never fabricated as "real world" data.
// ---------------------------------------------------------------------------
type PlaceSeed = Omit<Place, "images" | "isOpenNow"> & { images?: string[] };

const NEIGHBORHOODS = ["성수동", "연남동", "한남동", "을지로", "잠실", "이태원"] as const;
const coordsByArea: Record<(typeof NEIGHBORHOODS)[number], [number, number]> = {
  성수동: [37.5445, 127.0557],
  연남동: [37.5617, 126.9254],
  한남동: [37.5347, 127.0].slice() as [number, number],
  을지로: [37.5663, 126.9915],
  잠실: [37.5133, 127.1],
  이태원: [37.5347, 126.9946],
};

function jitterCoords([lat, lng]: [number, number], i: number): [number, number] {
  const dLat = (rand() - 0.5) * 0.02 + (i % 3) * 0.001;
  const dLng = (rand() - 0.5) * 0.02 + (i % 4) * 0.001;
  return [lat + dLat, lng + dLng];
}

const PLACE_DEFS: Array<{
  name: string;
  category: PlaceCategory;
  subcategory: string;
  neighborhood: (typeof NEIGHBORHOODS)[number];
  price: 1 | 2 | 3 | 4;
}> = [
  { name: "카페 오브젝트", category: "cafe", subcategory: "스페셜티 커피", neighborhood: "성수동", price: 2 },
  { name: "미도인 성수", category: "korean", subcategory: "한식 다이닝", neighborhood: "성수동", price: 3 },
  { name: "성수 브루웍스", category: "cafe", subcategory: "로스터리", neighborhood: "성수동", price: 2 },
  { name: "연희동 라멘식당", category: "japanese", subcategory: "라멘", neighborhood: "연남동", price: 2 },
  { name: "연남 소도", category: "korean", subcategory: "가정식", neighborhood: "연남동", price: 2 },
  { name: "포레스트 베이커리", category: "bakery", subcategory: "천연발효빵", neighborhood: "연남동", price: 2 },
  { name: "한남 트라토리아", category: "italian", subcategory: "이탈리안", neighborhood: "한남동", price: 3 },
  { name: "바 노트", category: "bar", subcategory: "칵테일 바", neighborhood: "한남동", price: 3 },
  { name: "한남 스탠드", category: "cafe", subcategory: "카페", neighborhood: "한남동", price: 2 },
  { name: "을지다방", category: "cafe", subcategory: "레트로 카페", neighborhood: "을지로", price: 1 },
  { name: "을지오뎅바", category: "bar", subcategory: "이자카야", neighborhood: "을지로", price: 2 },
  { name: "노가리 골목집", category: "korean", subcategory: "포차", neighborhood: "을지로", price: 1 },
  { name: "잠실 한상", category: "korean", subcategory: "한정식", neighborhood: "잠실", price: 3 },
  { name: "롯데뷰 브런치", category: "italian", subcategory: "브런치", neighborhood: "잠실", price: 3 },
  { name: "석촌호수 러너스 카페", category: "cafe", subcategory: "카페", neighborhood: "잠실", price: 2 },
  { name: "이태원 스몰플레이트", category: "italian", subcategory: "타파스", neighborhood: "이태원", price: 3 },
  { name: "이태원 루프탑 바", category: "bar", subcategory: "루프탑 바", neighborhood: "이태원", price: 4 },
  { name: "해방촌 사진관 카페", category: "cafe", subcategory: "갤러리 카페", neighborhood: "이태원", price: 2 },
  { name: "성수 산책공원", category: "outdoors", subcategory: "공원", neighborhood: "성수동", price: 1 },
  { name: "서울숲 피크닉존", category: "outdoors", subcategory: "공원", neighborhood: "성수동", price: 1 },
  { name: "대림창고 갤러리", category: "culture", subcategory: "복합문화공간", neighborhood: "성수동", price: 2 },
  { name: "연남 인디시네마", category: "culture", subcategory: "독립영화관", neighborhood: "연남동", price: 2 },
  { name: "경의선책거리 북카페", category: "cafe", subcategory: "북카페", neighborhood: "연남동", price: 2 },
  { name: "한남 소극장", category: "culture", subcategory: "소극장", neighborhood: "한남동", price: 2 },
  { name: "을지로 인쇄소 전시장", category: "culture", subcategory: "전시공간", neighborhood: "을지로", price: 1 },
  { name: "송리단길 스시야", category: "japanese", subcategory: "오마카세", neighborhood: "잠실", price: 4 },
  { name: "잠실 한강뷰 라운지", category: "bar", subcategory: "라운지 바", neighborhood: "잠실", price: 3 },
  { name: "이태원 브런치클럽", category: "korean", subcategory: "브런치", neighborhood: "이태원", price: 2 },
  { name: "우사단 델리", category: "italian", subcategory: "델리카페", neighborhood: "이태원", price: 2 },
  { name: "성수 베이글집", category: "bakery", subcategory: "베이글", neighborhood: "성수동", price: 1 },
];

export const SEED_PLACES: Place[] = PLACE_DEFS.map((def, i) => {
  const id = `p${i + 1}`;
  const [lat, lng] = jitterCoords(coordsByArea[def.neighborhood], i);
  return {
    id,
    name: def.name,
    category: def.category,
    subcategory: def.subcategory,
    address: `서울 ${def.neighborhood} ${100 + i}길 ${1 + (i % 20)}`,
    neighborhood: def.neighborhood,
    latitude: lat,
    longitude: lng,
    priceLevel: def.price,
    imageUrl: `https://picsum.photos/seed/localgraph-${id}/800/600`,
    images: [
      `https://picsum.photos/seed/localgraph-${id}-a/800/600`,
      `https://picsum.photos/seed/localgraph-${id}-b/800/600`,
    ],
    isOpenNow: rand() > 0.2,
  };
});

// ---------------------------------------------------------------------------
// Relationships & circles
// ---------------------------------------------------------------------------
// Taewan's 7 direct friends
const TAEWAN_DIRECT_FRIENDS = ["u2", "u3", "u4", "u5", "u6", "u7", "u8"];
// Friend-of-friend web among the remaining users
const SECOND_DEGREE_LINKS: [string, string][] = [
  ["u2", "u9"],
  ["u2", "u13"],
  ["u3", "u10"],
  ["u3", "u14"],
  ["u4", "u11"],
  ["u4", "u12"],
  ["u5", "u9"],
  ["u6", "u12"],
  ["u7", "u13"],
  ["u8", "u14"],
  ["u9", "u11"],
  ["u10", "u14"],
];

export const SEED_RELATIONSHIPS: Relationship[] = [
  ...TAEWAN_DIRECT_FRIENDS.map((id, i) => ({
    id: `rel-taewan-${id}`,
    requesterId: i % 2 === 0 ? "u1" : id,
    addresseeId: i % 2 === 0 ? id : "u1",
    status: "accepted" as const,
    createdAt: daysAgoIso(300 - i * 10),
  })),
  ...SECOND_DEGREE_LINKS.map(([a, b], i) => ({
    id: `rel-2nd-${i}`,
    requesterId: a,
    addresseeId: b,
    status: "accepted" as const,
    createdAt: daysAgoIso(200 - i * 5),
  })),
  {
    id: "rel-pending-1",
    requesterId: "u1",
    addresseeId: "u9",
    status: "pending",
    createdAt: daysAgoIso(2),
  },
];

export const SEED_CIRCLES: Circle[] = [
  {
    id: "c1",
    ownerId: "u1",
    name: "강원대 친구",
    description: "대학 동기들",
    memberIds: ["u1", "u2", "u5", "u9"],
    createdAt: daysAgoIso(300),
  },
  {
    id: "c2",
    ownerId: "u1",
    name: "서울 친구들",
    description: "서울살이 동지들",
    memberIds: ["u1", "u3", "u8", "u10", "u14"],
    createdAt: daysAgoIso(280),
  },
  {
    id: "c3",
    ownerId: "u4",
    name: "동아리",
    description: "사진 동아리",
    memberIds: ["u1", "u4", "u6", "u11", "u12"],
    createdAt: daysAgoIso(260),
  },
  {
    id: "c4",
    ownerId: "u7",
    name: "회사 사람들",
    description: "같은 팀",
    memberIds: ["u7", "u1", "u13"],
    createdAt: daysAgoIso(150),
  },
];

// ---------------------------------------------------------------------------
// Visits & reviews — generated from persona taste so different users produce
// meaningfully different recommendation results (spec #85 / #86).
// ---------------------------------------------------------------------------
const REVIEW_LINE_POOL = {
  positive: [
    "커피보다 분위기 때문에 다시 갈 듯.",
    "사진보다 실제 공간이 더 좋았음.",
    "조용해서 대화하기 좋았어요.",
    "가격 대비 만족스러운 곳.",
    "재료가 신선하고 서비스도 친절함.",
    "친구들이랑 가기 딱 좋은 분위기.",
    "생각보다 훨씬 괜찮아서 놀람.",
  ],
  mixed: [
    "예쁘긴 한데 30분 기다릴 정도는 아님.",
    "데이트용으로는 좋은데 가격은 좀 셈.",
    "음식은 평범한데 친구들이랑 가기 편함.",
    "근처에 있다면 갈 만하지만 일부러 찾아갈 정도는 아님.",
    "분위기는 좋은데 음식 때문에 다시 가진 않을 듯.",
    "메뉴는 무난한데 자리가 좀 좁아요.",
    "괜찮긴 한데 웨이팅이 아쉬움.",
  ],
  negative: [
    "웨이팅 40분이면 다시는 안 갈 듯.",
    "가격 대비 양이 너무 적었어요.",
    "기대했던 것보다 별로였음.",
    "직원 응대가 조금 아쉬웠어요.",
  ],
};

const TAGS_BY_CATEGORY: Record<PlaceCategory, ReviewTag[]> = {
  cafe: ["solo", "quiet_talk", "photo", "friends"],
  korean: ["friends", "family", "gathering"],
  japanese: ["date", "work", "special_day"],
  italian: ["date", "special_day", "friends"],
  bar: ["friends", "gathering", "date"],
  bakery: ["solo", "friends", "photo"],
  culture: ["date", "solo", "photo"],
  outdoors: ["family", "friends", "photo"],
};

function ratingFor(personaPositivity: number, categoryMatch: boolean) {
  const base = 2.5 + personaPositivity * 2.5 + (categoryMatch ? 0.6 : -0.3);
  const noise = (rand() - 0.5) * 1.2;
  const raw = Math.min(5, Math.max(1, base + noise));
  return Math.round(raw * 2) / 2; // half-star increments
}

function revisitFromRating(rating: number): RevisitIntention {
  if (rating >= 4) return "definitely";
  if (rating >= 3) return "maybe";
  if (rating >= 2) return "probably_not";
  return "no";
}

function lineFor(rating: number): string {
  if (rating >= 4) return pick(REVIEW_LINE_POOL.positive);
  if (rating >= 3) return pick(REVIEW_LINE_POOL.mixed);
  return pick(REVIEW_LINE_POOL.negative);
}

const VISIBILITY_ROTATION: Visibility[] = ["public", "friends", "friends", "network_anonymous", "private"];

let visitCounter = 0;
let reviewCounter = 0;
export const SEED_VISITS: Visit[] = [];
export const SEED_REVIEWS: Review[] = [];

for (const user of SEED_USERS) {
  // Each persona visits 4-6 places leaning toward their favorite categories.
  const visitCount = 4 + Math.floor(rand() * 3);
  const favored = SEED_PLACES.filter((p) => user.taste.categories.includes(p.category));
  const others = SEED_PLACES.filter((p) => !user.taste.categories.includes(p.category));
  const chosen = new Set<string>();
  for (let i = 0; i < visitCount; i++) {
    const useFavored = rand() < 0.75 && favored.length > 0;
    const pool = useFavored ? favored : others;
    const place = pick(pool);
    if (chosen.has(place.id)) continue;
    chosen.add(place.id);

    visitCounter += 1;
    const visitId = `v${visitCounter}`;
    const daysAgo = Math.floor(rand() * 45) + 1;
    const visit: Visit = {
      id: visitId,
      userId: user.id,
      placeId: place.id,
      visitedAt: daysAgoIso(daysAgo, 10 + Math.floor(rand() * 10)),
      visibility: pick(["friends", "friends", "public", "network_anonymous"] as Visibility[]),
      photoUrl: rand() > 0.6 ? place.imageUrl : null,
      companionIds: [],
    };
    SEED_VISITS.push(visit);

    // ~70% of visits get a review
    if (rand() < 0.7) {
      const categoryMatch = user.taste.categories.includes(place.category);
      const rating = ratingFor(user.taste.positivity, categoryMatch);
      reviewCounter += 1;
      const reviewId = `r${reviewCounter}`;
      const tagPool = TAGS_BY_CATEGORY[place.category];
      const tags = [pick(tagPool), pick(tagPool)].filter((t, i, arr) => arr.indexOf(t) === i);
      const review: Review = {
        id: reviewId,
        userId: user.id,
        placeId: place.id,
        visitId: visit.id,
        rating,
        reviewText: lineFor(rating),
        revisitIntention: revisitFromRating(rating),
        priceRating: 1 + Math.floor(rand() * 4),
        noiseRating: 1 + Math.floor(rand() * 4),
        waitRating: 1 + Math.floor(rand() * 4),
        tags,
        visibility: pick(VISIBILITY_ROTATION),
        createdAt: visit.visitedAt,
        updatedAt: visit.visitedAt,
      };
      SEED_REVIEWS.push(review);
    }
  }
}

// Guarantee a couple of specific "magic moment" scenarios regardless of RNG outcome.

// 1) A place with exactly one friend visitor + an anonymous review -> should
//    fall back to a generic identity (k-anonymity edge case, spec #17/#107).
const kAnonPlace = SEED_PLACES[3]; // 연희동 라멘식당
SEED_VISITS.push({
  id: "v-kanon-1",
  userId: "u2",
  placeId: kAnonPlace.id,
  visitedAt: daysAgoIso(6),
  visibility: "friends",
  photoUrl: null,
  companionIds: [],
});
SEED_REVIEWS.push({
  id: "r-kanon-1",
  userId: "u2",
  placeId: kAnonPlace.id,
  visitId: "v-kanon-1",
  rating: 3,
  reviewText: "국물은 진한데 자리가 너무 좁아서 아쉬웠어요.",
  revisitIntention: "maybe",
  priceRating: 3,
  noiseRating: 4,
  waitRating: 3,
  tags: ["solo", "work"],
  visibility: "network_anonymous",
  createdAt: daysAgoIso(6),
  updatedAt: daysAgoIso(6),
});

// 2) The canonical "magic moment" place — 미도인 성수 — with 4 friend visits,
//    a strong trusted rating, and a candid anonymous review (spec #80).
const magicPlace = SEED_PLACES.find((p) => p.name === "미도인 성수")!;
const magicVisitors = ["u2", "u3", "u5", "u7"];
magicVisitors.forEach((uid, i) => {
  const vId = `v-magic-${i}`;
  SEED_VISITS.push({
    id: vId,
    userId: uid,
    placeId: magicPlace.id,
    visitedAt: daysAgoIso(3 + i * 2),
    visibility: "friends",
    photoUrl: i === 0 ? magicPlace.imageUrl : null,
    companionIds: [],
  });
  reviewCounter += 1;
  SEED_REVIEWS.push({
    id: `r-magic-${i}`,
    userId: uid,
    placeId: magicPlace.id,
    visitId: vId,
    rating: i === 3 ? 3.5 : 4.5,
    reviewText:
      i === 3
        ? "분위기는 좋은데 음식 때문에 다시 가진 않을 듯."
        : ["데이트보다는 친구들이랑 오기 좋음.", "웨이팅 있지만 그만한 가치 있음.", "재료 좋고 플레이팅도 예쁨."][i],
    revisitIntention: i === 3 ? "maybe" : "definitely",
    priceRating: 3,
    noiseRating: 2,
    waitRating: 4,
    tags: ["friends", "photo"],
    visibility: i === 3 ? "network_anonymous" : "friends",
    createdAt: daysAgoIso(3 + i * 2),
    updatedAt: daysAgoIso(3 + i * 2),
  });
});

// ---------------------------------------------------------------------------
// Saved places / collections
// ---------------------------------------------------------------------------
export const SEED_COLLECTIONS: Collection[] = [
  { id: "col1", userId: "u1", name: "가보고 싶은 곳", createdAt: daysAgoIso(100) },
  { id: "col2", userId: "u1", name: "데이트", createdAt: daysAgoIso(90) },
  { id: "col3", userId: "u1", name: "친구랑", createdAt: daysAgoIso(80) },
];

export const SEED_SAVED_PLACES: SavedPlace[] = [
  { id: "sp1", userId: "u1", placeId: magicPlace.id, collectionId: "col1", createdAt: daysAgoIso(20) },
  { id: "sp2", userId: "u1", placeId: SEED_PLACES[6].id, collectionId: "col2", createdAt: daysAgoIso(18) },
  { id: "sp3", userId: "u1", placeId: SEED_PLACES[0].id, collectionId: null, createdAt: daysAgoIso(15) },
  { id: "sp4", userId: "u1", placeId: SEED_PLACES[16].id, collectionId: "col2", createdAt: daysAgoIso(12) },
  { id: "sp5", userId: "u1", placeId: SEED_PLACES[20].id, collectionId: "col3", createdAt: daysAgoIso(9) },
  { id: "sp6", userId: "u1", placeId: SEED_PLACES[22].id, collectionId: "col1", createdAt: daysAgoIso(5) },
];

// ---------------------------------------------------------------------------
// Notifications for the primary demo user (u1)
// ---------------------------------------------------------------------------
export const SEED_NOTIFICATIONS: AppNotification[] = [
  {
    id: "notif1",
    userId: "u1",
    type: "friend_request_accepted",
    actorId: "u9",
    entityType: "user",
    entityId: "u9",
    readAt: null,
    createdAt: daysAgoIso(0, 9),
    message: "지호님이 회원님의 친구 요청을 수락했습니다.",
  },
  {
    id: "notif2",
    userId: "u1",
    type: "saved_place_visited_by_friend",
    actorId: "u3",
    entityType: "place",
    entityId: magicPlace.id,
    readAt: null,
    createdAt: daysAgoIso(1, 14),
    message: "미나님이 회원님이 저장한 장소를 방문했습니다.",
  },
  {
    id: "notif3",
    userId: "u1",
    type: "network_trend",
    actorId: null,
    entityType: "place",
    entityId: SEED_PLACES[0].id,
    readAt: null,
    createdAt: daysAgoIso(2, 11),
    message: "친구 3명이 이번 주 성수의 같은 장소를 방문했어요.",
  },
  {
    id: "notif4",
    userId: "u1",
    type: "review_reaction",
    actorId: null,
    entityType: "review",
    entityId: "r-magic-3",
    readAt: daysAgoIso(3),
    createdAt: daysAgoIso(4, 16),
    message: "회원님의 익명 리뷰에 도움이 됐어요가 표시되었습니다.",
  },
  {
    id: "notif5",
    userId: "u1",
    type: "saved_place_visited_by_friend",
    actorId: "u7",
    entityType: "place",
    entityId: SEED_PLACES[16].id,
    readAt: daysAgoIso(6),
    createdAt: daysAgoIso(7, 10),
    message: "예린님이 회원님이 저장한 장소를 방문했습니다.",
  },
  {
    id: "notif6",
    userId: "u1",
    type: "network_trend",
    actorId: null,
    entityType: "place",
    entityId: SEED_PLACES[20].id,
    readAt: daysAgoIso(8),
    createdAt: daysAgoIso(9, 13),
    message: "학교 지인들 사이에서 최근 자주 저장되고 있어요.",
  },
];

export const SEED_PRIVACY_SETTINGS: Record<string, PrivacySettings> = Object.fromEntries(
  SEED_USERS.map((u) => [
    u.id,
    {
      userId: u.id,
      defaultVisitVisibility: "friends",
      defaultReviewVisibility: "friends",
      showVisitHistory: true,
      showToFriendsOfFriends: true,
      allowRecommendationUsage: true,
    } satisfies PrivacySettings,
  ])
);

export const DEMO_CURRENT_USER_ID = "u1";
