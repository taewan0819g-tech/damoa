"use client";

import { useState } from "react";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/** Graceful fallback if a demo/remote image fails to load (spec #64). */
export function PlaceImage({ src, alt, className, sizes }: { src: string; alt: string; className?: string; sizes?: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className={cn("flex items-center justify-center bg-surface-muted text-foreground-muted", className)}>
        <ImageOff className="h-6 w-6" />
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes ?? "(max-width: 768px) 100vw, 400px"}
      className={cn("object-cover", className)}
      onError={() => setFailed(true)}
    />
  );
}
