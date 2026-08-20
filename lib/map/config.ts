import type { MapProvider } from "./types";

export const MAP_TOKEN = process.env.NEXT_PUBLIC_MAP_TOKEN ?? null;

/**
 * Default provider: OpenStreetMap tiles via Leaflet, which need no API key.
 * If NEXT_PUBLIC_MAP_TOKEN is set for a future provider (Kakao/Naver), swap
 * this object — nothing else in the app references tile URLs directly.
 */
export const activeMapProvider: MapProvider = {
  name: "openstreetmap",
  requiresToken: false,
  tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};
