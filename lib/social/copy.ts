import type { SafeAuthor } from "@/types/domain";

/**
 * Centralizes the "N명이 다녀왔어요" style sentences so every card renders
 * the zero/one/many cases consistently (spec #101/#106) instead of each
 * component hand-rolling its own string.
 */
export function visitorSentence(visitors: SafeAuthor[], totalCount: number, verb = "다녀왔어요"): string {
  if (totalCount === 0) return "아직 친구의 방문 기록이 없어요.";
  if (totalCount === 1) return `${visitors[0]?.displayName ?? "친구"}님이 ${verb}.`;
  const first = visitors[0]?.displayName ?? "친구";
  return `${first} 외 ${totalCount - 1}명이 ${verb}.`;
}

export function feedHeadline(names: string[], totalCount: number, verb = "최근 방문"): string {
  if (totalCount <= 1) return `${names[0] ?? "친구"}님이 ${verb}`;
  return `${names[0] ?? "친구"} 외 ${totalCount - 1}명이 ${verb}`;
}
