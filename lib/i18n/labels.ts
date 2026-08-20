import type { PlaceCategory, ReportReason, RevisitIntention, ReviewTag, Visibility } from "@/types/domain";

/** Centralized Korean UI copy for domain enums — the rest of the app should
 * import from here instead of inlining label strings (spec #6/#78). */

export const CATEGORY_LABELS: Record<PlaceCategory, string> = {
  cafe: "카페",
  korean: "한식",
  japanese: "일식",
  italian: "이탈리안",
  bar: "술집",
  bakery: "베이커리",
  culture: "문화공간",
  outdoors: "야외",
};

export const TAG_LABELS: Record<ReviewTag, string> = {
  date: "데이트",
  friends: "친구",
  solo: "혼자",
  family: "가족",
  work: "업무",
  gathering: "모임",
  photo: "사진",
  quiet_talk: "조용한 대화",
  special_day: "특별한 날",
};

export const REVISIT_LABELS: Record<RevisitIntention, string> = {
  definitely: "다시 갈 것 같아요",
  maybe: "글쎄요",
  probably_not: "아마 안 갈 것 같아요",
  no: "다시 안 갈 것 같아요",
};

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  public: "이름 공개",
  friends: "친구에게만",
  network_anonymous: "익명으로 공유",
  private: "나만 보기",
};

export const VISIBILITY_DESCRIPTIONS: Record<Visibility, string> = {
  public: "내 이름과 함께 모두에게 보여요.",
  friends: "직접 친구들에게만 이름과 함께 보여요.",
  network_anonymous: "네트워크에는 보이지만 내 이름은 절대 표시되지 않아요.",
  private: "나만 볼 수 있어요.",
};

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  misinformation: "허위 정보",
  spam: "광고 / 스팸",
  abusive: "공격적 표현",
  personal_info: "개인정보",
  conflict_of_interest: "이해관계 미표시",
  other: "기타",
};

export function priceLevelLabel(level: number): string {
  return "₩".repeat(level);
}
