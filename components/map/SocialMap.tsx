"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker } from "react-leaflet";
import { activeMapProvider } from "@/lib/map/config";
import { MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM } from "@/config/constants";
import type { MapPinData } from "@/types/domain";

const SIGNAL_COLOR: Record<MapPinData["signalStrength"], string> = {
  strong: "#d9622b",
  medium: "#e8a15c",
  weak: "#b8b0a4",
};

function pinIcon(pin: MapPinData) {
  const color = SIGNAL_COLOR[pin.signalStrength];
  const size = pin.signalStrength === "strong" ? 20 : 15;
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.35)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Renders the actual Leaflet map — always loaded via next/dynamic({ ssr:
 * false }) from MapView, since Leaflet touches `window` at import time. */
export function SocialMap({ pins, onSelect }: { pins: MapPinData[]; onSelect: (pin: MapPinData) => void }) {
  return (
    <MapContainer center={MAP_DEFAULT_CENTER} zoom={MAP_DEFAULT_ZOOM} scrollWheelZoom className="h-full w-full">
      <TileLayer url={activeMapProvider.tileUrl} attribution={activeMapProvider.attribution} />
      {pins.map((pin) => (
        <Marker
          key={pin.place.id}
          position={[pin.place.latitude, pin.place.longitude]}
          icon={pinIcon(pin)}
          eventHandlers={{ click: () => onSelect(pin) }}
        />
      ))}
    </MapContainer>
  );
}
