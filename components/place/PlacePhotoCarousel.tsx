import { PlaceImage } from "@/components/place/PlaceImage";

export function PlacePhotoCarousel({ images, name }: { images: string[]; name: string }) {
  const photos = images.length > 0 ? images : [];
  if (photos.length <= 1) {
    return (
      <div className="relative aspect-[4/3] w-full bg-surface-muted">
        <PlaceImage src={photos[0] ?? ""} alt={name} sizes="(max-width: 768px) 100vw, 672px" />
      </div>
    );
  }
  return (
    <div className="flex snap-x snap-mandatory overflow-x-auto scrollbar-none">
      {photos.map((src, i) => (
        <div key={src + i} className="relative aspect-[4/3] w-full shrink-0 snap-center bg-surface-muted">
          <PlaceImage src={src} alt={`${name} 사진 ${i + 1}`} sizes="(max-width: 768px) 100vw, 672px" />
        </div>
      ))}
    </div>
  );
}
