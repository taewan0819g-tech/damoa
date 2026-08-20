"use client";

import { useState, useTransition } from "react";
import { Check, MapPinCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createVisit } from "@/app/actions/visits";

/** Quick "다녀왔어요" mark from the place page — defaults to friends-only
 * visibility, the same default new users start with in privacy settings. */
export function VisitButton({ placeId, alreadyVisited }: { placeId: string; alreadyVisited: boolean }) {
  const [visited, setVisited] = useState(alreadyVisited);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (visited || isPending) return;
    setVisited(true);
    startTransition(async () => {
      try {
        await createVisit({ placeId, visitedAt: new Date().toISOString(), visibility: "friends" });
      } catch {
        setVisited(false);
      }
    });
  }

  return (
    <Button type="button" variant={visited ? "secondary" : "outline"} onClick={handleClick} disabled={visited || isPending}>
      {visited ? <Check className="h-4 w-4" /> : <MapPinCheck className="h-4 w-4" />}
      {visited ? "다녀왔어요" : "다녀왔어요 남기기"}
    </Button>
  );
}
