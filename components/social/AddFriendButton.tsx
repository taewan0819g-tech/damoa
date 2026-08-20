"use client";

import { useState, useTransition } from "react";
import { UserPlus, Check, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addFriend } from "@/app/actions/social";

export function AddFriendButton({ targetUserId, initialStatus }: { targetUserId: string; initialStatus: "none" | "pending" | "friends" }) {
  const [status, setStatus] = useState(initialStatus);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (status !== "none") return;
    setStatus("friends");
    startTransition(async () => {
      try {
        await addFriend(targetUserId);
      } catch {
        setStatus("none");
      }
    });
  }

  if (status === "friends") {
    return (
      <Button type="button" variant="secondary" disabled>
        <Check className="h-4 w-4" />
        친구
      </Button>
    );
  }
  if (status === "pending") {
    return (
      <Button type="button" variant="secondary" disabled>
        <Clock className="h-4 w-4" />
        요청됨
      </Button>
    );
  }
  return (
    <Button type="button" variant="outline" onClick={handleClick} disabled={isPending}>
      <UserPlus className="h-4 w-4" />
      친구 추가
    </Button>
  );
}
