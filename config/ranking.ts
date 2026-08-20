/**
 * Recommendation & ranking configuration.
 * See lib/recommendations/recommendationService.ts for how these are consumed.
 * Keeping every tunable weight here (rather than scattered through components)
 * means the scoring model can be re-tuned without touching UI code.
 */

export const RECOMMENDATION_WEIGHTS = {
  socialProximity: 0.35,
  recency: 0.25,
  tasteSimilarity: 0.2,
  networkQuality: 0.15,
  novelty: 0.05,
} as const;

export const SOCIAL_PROXIMITY_WEIGHTS = {
  directFriend: 1.0,
  friendOfFriend: 0.65,
  sharedCircle: 0.55,
  generalNetwork: 0.25,
  none: 0,
} as const;

/** Recency = exp(-daysSince / RECENCY_HALF_LIFE_DAYS) */
export const RECENCY_HALF_LIFE_DAYS = 21;

/** Bayesian shrinkage prior for network-quality confidence adjustment. */
export const NETWORK_QUALITY_PRIOR = {
  /** Assumed "average" rating for a place with no data, on a 0-5 scale. */
  priorMean: 3.4,
  /** How many "phantom" reviews the prior is worth — higher = more conservative. */
  priorWeight: 5,
};

export const K_ANONYMITY_THRESHOLD = 4;
