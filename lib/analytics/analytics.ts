export type AnalyticsEvent =
  | "app_open"
  | "feed_place_opened"
  | "map_pin_opened"
  | "place_saved"
  | "visit_created"
  | "review_started"
  | "review_completed"
  | "review_anonymous_selected"
  | "friend_added"
  | "recommendation_opened";

/**
 * Minimal analytics abstraction (spec #82). In Demo Mode this just logs to
 * the console — swap the body for a real provider (PostHog, Amplitude, …)
 * without touching call sites.
 */
export function track(event: AnalyticsEvent, properties?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.debug(`[analytics] ${event}`, properties ?? {});
  }
}
