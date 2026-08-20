import { getSessionUserId } from "@/lib/auth/session";
import { getPlaceRepository } from "@/lib/repositories/factory";
import { PlaceSearchPicker } from "@/components/add/PlaceSearchPicker";

export default async function AddPage() {
  await getSessionUserId();
  const places = await getPlaceRepository().list();
  const suggestions = places.slice(0, 8);

  return (
    <div className="space-y-4 px-4 py-4">
      <div>
        <h1 className="text-lg font-bold text-foreground">어디 다녀오셨어요?</h1>
        <p className="mt-1 text-sm text-foreground-muted">장소를 검색하면 방문 기록이나 후기를 남길 수 있어요.</p>
      </div>
      <PlaceSearchPicker suggestions={suggestions} />
    </div>
  );
}
