/**
 * Map functionality is abstracted behind these interfaces so the initial
 * OpenStreetMap/Leaflet implementation (lib/map/config.ts +
 * components/map/*) can be swapped for Kakao/Naver Maps later without
 * touching page code. No API key is required for the default provider, so
 * the map keeps working even when NEXT_PUBLIC_MAP_TOKEN is unset.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapProvider {
  name: string;
  requiresToken: boolean;
  tileUrl: string;
  attribution: string;
}

export interface GeocodingProvider {
  reverseGeocode(point: LatLng): Promise<string | null>;
}

export interface PlaceSearchProvider {
  searchNearby(point: LatLng, radiusKm: number): Promise<{ name: string; lat: number; lng: number }[]>;
}
