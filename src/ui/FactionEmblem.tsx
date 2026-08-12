import { orbatTemplateFor } from "../app/orbatTemplates";

export function FactionEmblem({
  className = "",
  faction,
}: {
  readonly className?: string;
  readonly faction: string;
}) {
  const template = orbatTemplateFor(faction);
  return (
    <span
      aria-hidden="true"
      className={`faction-emblem ${className}`.trim()}
      style={{ backgroundImage: `url(${template.imageUrl})`, borderColor: template.accent }}
    />
  );
}
