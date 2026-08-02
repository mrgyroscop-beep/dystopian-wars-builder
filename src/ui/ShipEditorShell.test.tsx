import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AKITA_GROUPS, type ShipEditorReadModel } from "../application/rosters/ship-editor";
import { ShipEditorShell } from "./ShipEditorShell";

describe("ShipEditorShell", () => {
  it("renders a read-only Preview and honest KAN-36 tab states", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <ShipEditorShell busy={false} model={editorModel(null)} onAdd={onAdd} onCommand={vi.fn()} />,
    );

    expect(screen.getByText("Только чтение")).toBeInTheDocument();
    expect(screen.getAllByRole("group")).toHaveLength(6);
    expect(screen.getByRole("radio", { name: /Magma Cast/u })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Добавить в состав" }));
    expect(onAdd).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("tab", { name: "Профиль" }));
    expect(screen.getByText(/будет подключён в KAN-36/u)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Правила" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Правила пока недоступны");
  });

  it("uses unique radio names, emits atomic commands and focuses a problem target", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    render(
      <ShipEditorShell
        busy={false}
        model={editorModel("akita")}
        onAdd={vi.fn()}
        onCommand={onCommand}
      />,
    );

    const radios = screen.getAllByRole("radio");
    expect(new Set(radios.map((radio) => radio.getAttribute("name"))).size).toBe(4);
    await user.click(screen.getByRole("radio", { name: /Kagutsuchi Generator/u }));
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "replace-exclusive",
        groupId: "fps-1",
        optionId: "demo-akita-kagutsuchi",
      }),
      expect.any(String),
    );
    await user.click(screen.getByRole("button", { name: /PSA: требуется выбор/u }));
    expect(document.getElementById("ship-editor-group-psa")).toHaveFocus();
  });
});

function editorModel(instanceId: string | null) {
  return {
    mode: instanceId ? "instance" : "preview",
    instanceId,
    name: "Akita Demonstrator",
    basePoints: "350",
    optionPoints: "0",
    derivedPoints: "0",
    totalPoints: "350",
    victoryPoints: "9",
    mandatory: { selected: 0, required: 4 },
    validity: "invalid",
    persistence: "saved-local",
    system: "ready",
    groups: AKITA_GROUPS.map((group) => ({
      ...group,
      options: group.options.map((option) => ({
        id: option.id,
        label: option.label,
        kind: option.kind,
        costLabel: option.points ? `+${option.points} Points` : "Бесплатно",
        selectedQuantity: 0,
        availability: option.availability ?? "available",
        reason: option.reason ?? null,
      })),
    })),
    problems: [
      {
        id: "required-psa",
        title: "PSA: требуется выбор",
        detail: "Выберите ровно одну систему.",
        targetGroupId: "psa",
      },
    ],
    breakdown: [
      { label: "Базовая стоимость", value: "350" },
      { label: "Выбранные опции", value: "0" },
    ],
  } satisfies ShipEditorReadModel;
}
