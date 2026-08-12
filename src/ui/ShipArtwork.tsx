import { shipImageFor } from "../app/shipImages";

export function ShipArtwork({
  faction,
  name,
}: {
  readonly faction: string;
  readonly name: string;
}) {
  const image = shipImageFor(faction, name);
  return (
    <span className={`ship-artwork${image ? " ship-artwork--available" : ""}`}>
      {image ? (
        <img alt="" aria-hidden="true" decoding="async" loading="lazy" src={image} />
      ) : (
        <svg aria-hidden="true" className="ship-artwork__silhouette" viewBox="0 0 240 92">
          <path d="M16 60h30l12-16h35l9-15h33l11 15h29l14 16h35l-14 17H35L16 60Z" />
          <path d="M68 44h22V31h14v13h-7l-8 12H58l10-12Zm74 0h19l10 12h-38l9-12Z" />
          <path d="M112 28V12h7v16h-7Zm-8-12h23v5h-23v-5Z" />
        </svg>
      )}
    </span>
  );
}
