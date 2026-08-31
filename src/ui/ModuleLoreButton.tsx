import { useState } from "react";
import { createPortal } from "react-dom";

import { moduleLoreFor } from "../app/moduleLore";
import { CameraIcon } from "./CameraIcon";
import { ModuleLoreDialog } from "./ProfileDialog";

export function ModuleLoreButton({
  faction,
  name,
}: {
  readonly faction: string;
  readonly name: string;
}) {
  const [open, setOpen] = useState(false);
  const module = moduleLoreFor(faction, name);
  if (!module) return null;

  return (
    <>
      <button
        aria-label={`Показать изображение и лор ${name}`}
        aria-haspopup="dialog"
        className="option-inspect option-camera"
        onClick={() => setOpen(true)}
        title="Изображение и лор из ORBAT"
        type="button"
      >
        <CameraIcon />
      </button>
      {open
        ? createPortal(
            <ModuleLoreDialog module={module} name={name} onClose={() => setOpen(false)} />,
            document.body,
          )
        : null}
    </>
  );
}
