import { useState } from "react";
import { VehicleVisual } from "./VehicleCard";

// Keying by vehicle prevents a previous vehicle's selection/error leaking into this gallery.
export default function VehicleGallery({ vehicle }) {
  return <Gallery key={vehicle.id} vehicle={vehicle} />;
}
function Gallery({ vehicle }) {
  const images = Array.isArray(vehicle.images) ? vehicle.images : [];
  const [selectedId, setSelectedId] = useState(null);
  const selected = images.find((image) => image.id === selectedId) || images[0];
  return (
    <section className="vehicle-gallery" aria-label={`Thư viện ảnh ${vehicle.name}`}>
      <VehicleVisual vehicle={vehicle} large customSrc={selected?.url} />
      {selected ? <p className="image-credit">Ảnh minh họa mẫu xe · {selected.attribution || "Chưa cung cấp thông tin nguồn ảnh"}</p> : null}
      {images.length > 1 ? <div className="gallery-thumbnails" aria-label="Chọn ảnh xe">
        {images.map((image, index) => <button key={image.id} type="button" aria-label={`Xem ảnh ${index + 1}`} aria-pressed={selected?.id === image.id} onClick={() => setSelectedId(image.id)}>
          <img src={image.url} alt={`Ảnh ${index + 1} của ${vehicle.name}`} loading="lazy" />
        </button>)}
      </div> : null}
    </section>
  );
}
