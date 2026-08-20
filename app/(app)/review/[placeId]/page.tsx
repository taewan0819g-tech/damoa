import { notFound } from "next/navigation";
import { getPlaceRepository } from "@/lib/repositories/factory";
import { ReviewFlow } from "@/components/review/ReviewFlow";

export default async function ReviewPage({ params }: { params: Promise<{ placeId: string }> }) {
  const { placeId } = await params;
  const place = await getPlaceRepository().getById(placeId);
  if (!place) notFound();

  return (
    <div className="px-4 py-4">
      <ReviewFlow place={place} />
    </div>
  );
}
