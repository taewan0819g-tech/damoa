"use client";

import { Star } from "lucide-react";

/** Half-star rating input (0.5 increments, 0.5–5). Each star is split into a
 * left/right hit target so a single tap can select either half. */
export function RatingStars({ value, onChange, size = 36 }: { value: number; onChange: (value: number) => void; size?: number }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const fillWidth = value >= n ? "100%" : value >= n - 0.5 ? "50%" : "0%";
        return (
          <div key={n} className="relative" style={{ width: size, height: size }}>
            <Star className="absolute inset-0 text-border" style={{ width: size, height: size }} />
            <div className="absolute inset-0 overflow-hidden" style={{ width: fillWidth }}>
              <Star className="fill-accent text-accent" style={{ width: size, height: size }} />
            </div>
            <button
              type="button"
              aria-label={`${n - 0.5}점`}
              className="absolute inset-y-0 left-0 w-1/2"
              onClick={() => onChange(n - 0.5)}
            />
            <button type="button" aria-label={`${n}점`} className="absolute inset-y-0 right-0 w-1/2" onClick={() => onChange(n)} />
          </div>
        );
      })}
    </div>
  );
}
