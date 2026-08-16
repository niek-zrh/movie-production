"use client";

import { useParams } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import { ReviewRoom } from "../_components/review-room";

export default function ReviewRoomPage() {
  const params = useParams<{ productionId: string; shotId: string }>();
  return (
    <ReviewRoom
      productionId={params.productionId as Id<"productions">}
      shotId={params.shotId as Id<"shots">}
    />
  );
}
