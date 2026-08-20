/**
 * Central app configuration. Change the product name/brand here — nothing else
 * in the codebase should hard-code the literal name.
 */
export const APP_NAME = "LocalGraph";
export const APP_TAGLINE = "친구들이 요즘 어디 가는지 볼까요?";
export const APP_SUBTAGLINE = "광고보다 가까운 사람들의 선택을 먼저 보여드려요.";

export const DEFAULT_LOCALE = "ko-KR";
export const DEFAULT_AREA = "성수동";

/** Toggle via NEXT_PUBLIC_DEMO_MODE. Defaults to true when Supabase is not configured. */
export const IS_SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export const DEMO_MODE =
  process.env.NEXT_PUBLIC_DEMO_MODE === "false" ? false : !IS_SUPABASE_CONFIGURED || process.env.NEXT_PUBLIC_DEMO_MODE === "true";

/** The account the app signs you in as automatically in Demo Mode. */
export const DEMO_PRIMARY_USERNAME = "taewan";

export const K_ANONYMITY_THRESHOLD = 4;

export const REVIEW_TEXT_MAX_LENGTH = 240;

export const MAP_DEFAULT_CENTER: [number, number] = [37.5445, 127.0557]; // 성수동
export const MAP_DEFAULT_ZOOM = 14;

export const NAV_ITEMS = [
  { key: "home", href: "/home", label: "홈" },
  { key: "map", href: "/map", label: "지도" },
  { key: "add", href: "/add", label: "추가" },
  { key: "saved", href: "/saved", label: "저장" },
  { key: "profile", href: "/profile/me", label: "프로필" },
] as const;
