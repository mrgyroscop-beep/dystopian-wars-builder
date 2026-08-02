import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ShipEditorGroupReadModel,
  ShipEditorReadModel,
  ShipEditorReadyReadModel,
} from "../application/rosters/ship-editor";
import { ShipEditorShell } from "./ShipEditorShell";

afterEach(cleanup);

describe("ShipEditorShell", () => {
  it("renders Preview, supports full roving tab focus and exposes Back", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onBack = vi.fn();
    render(
      <ShipEditorShell
        busy={false}
        model={editorModel(null)}
        onAdd={onAdd}
        onBack={onBack}
        onCommand={vi.fn()}
      />,
    );

    expect(screen.getByText("Только чтение")).toBeInTheDocument();
    expect(screen.getAllByRole("group")).toHaveLength(6);
    expect(screen.getByRole("radio", { name: /Magma Cast Generator/u })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Добавить в состав" }));
    expect(onAdd).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: /Назад/u }));
    expect(onBack).toHaveBeenCalledOnce();

    const profile = screen.getByRole("tab", { name: "Профиль" });
    await user.click(profile);
    expect(screen.getByRole("heading", { name: "Профиль корабля" })).toBeInTheDocument();
    expect(screen.getByText("Базовый профиль")).toBeInTheDocument();
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Настройка" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Правила" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Настройка" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Правила" })).toHaveFocus();
  });

  it("uses opaque group/placement keys, emits atomic commands and focuses a problem target", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    render(
      <ShipEditorShell
        busy={false}
        model={editorModel("akita")}
        onAdd={vi.fn()}
        onBack={vi.fn()}
        onCommand={onCommand}
      />,
    );

    const radios = screen.getAllByRole("radio");
    expect(new Set(radios.map((radio) => radio.getAttribute("name"))).size).toBe(4);
    await user.click(screen.getByRole("radio", { name: /Heavy Battery/u }));
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "replace-exclusive",
        groupId: "opaque-slot-psa",
        optionId: "opaque-placement-heavy",
      }),
      expect.any(String),
    );
    await user.click(screen.getByRole("button", { name: /PSA: требуется выбор/u }));
    expect(document.getElementById("ship-editor-group-unit-0")).toHaveFocus();
    expect(document.body.innerHTML).not.toMatch(/opaque-slot|DEMO-/u);
    expect(document.body.textContent).not.toMatch(/opaque-slot|DEMO-/u);
  });

  it("renders fixed and variable Model quantity and opens fleet-level Doctrine controls", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const variable = {
      ...editorModel("akita"),
      modelQuantity: {
        instanceId: "model-instance",
        value: 1,
        minimum: 1,
        maximum: 3,
        fixed: false,
      },
    } satisfies ShipEditorReadyReadModel;
    render(
      <ShipEditorShell
        busy={false}
        model={variable}
        onAdd={vi.fn()}
        onBack={vi.fn()}
        onCommand={onCommand}
      />,
    );

    const quantity = screen.getByRole("spinbutton", { name: "Количество" });
    fireEvent.change(quantity, { target: { value: "2" } });
    expect(onCommand).toHaveBeenLastCalledWith(
      { type: "set-model-quantity", instanceId: "model-instance", quantity: 2 },
      expect.any(String),
    );
    await user.click(screen.getByRole("button", { name: "Настроить доктрину" }));
    expect(screen.getByRole("group", { name: /Доктрина флота/u })).toBeInTheDocument();
  });

  it("renders an honest unsupported-data state", () => {
    const model: ShipEditorReadModel = {
      dataState: "unsupported-data",
      title: "Настройка недоступна",
      detail: "В каталоге нет поддерживаемых Slots.",
    };
    render(
      <ShipEditorShell
        busy={false}
        model={model}
        onAdd={vi.fn()}
        onBack={vi.fn()}
        onCommand={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("нет поддерживаемых Slots");
    expect(screen.getByRole("heading", { name: "Настройка недоступна" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("returns from a rule to the preserved Rules tab and focus origin", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    render(
      <ShipEditorShell
        busy={false}
        model={editorModel(null)}
        onAdd={vi.fn()}
        onBack={vi.fn()}
        onCommand={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "Правила" }));
    const origin = screen.getByRole("button", { name: "Открыть правило Torrent" });
    await user.click(origin);
    expect(screen.getByRole("heading", { name: "Torrent" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: /К правилам/u }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Открыть правило Torrent" })).toHaveFocus(),
    );
    expect(screen.getByRole("tab", { name: "Правила" })).toHaveAttribute("aria-selected", "true");
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  });
});

function editorModel(instanceId: string | null): ShipEditorReadyReadModel {
  return {
    dataState: "ready",
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
    groups: groups(),
    fleetGroups: [
      group("opaque-slot-doctrine", "Доктрина флота", 0, 1, [
        option("opaque-placement-doctrine", "Kagutsuchi Doctrine", "Doctrine"),
      ]),
    ],
    modelQuantity: {
      instanceId: instanceId ? "model-instance" : null,
      value: 1,
      minimum: 1,
      maximum: 1,
      fixed: true,
    },
    problems: [
      {
        id: "required-psa",
        title: "PSA: требуется выбор",
        detail: "Выберите ровно одну систему.",
        targetGroupId: "opaque-slot-psa",
        targetGroupLabel: "PSA",
      },
    ],
    profileRules: {
      variant: instanceId ? "effective" : "base",
      sourceCatalogVersion: "test-catalog",
      versionState: "current",
      sections: [
        { id: "model", label: "Model", rows: [] },
        { id: "properties", label: "Properties", rows: [] },
        { id: "systems", label: "Systems", rows: [] },
      ],
      weapons: [],
      rules: [
        {
          id: "rule-torrent",
          label: "Torrent",
          description: {
            plainText: "Описание Torrent.",
            blocks: [
              { type: "paragraph", children: [{ type: "text", value: "Описание Torrent." }] },
            ],
            contentUnavailable: false,
            diagnostics: [],
          },
          available: true,
          diagnostic: null,
        },
      ],
      diagnostics: [],
    },
    breakdown: [
      { label: "Базовая стоимость", value: "350" },
      { label: "Выбранные опции", value: "0" },
    ],
  };
}

function groups(): ShipEditorGroupReadModel[] {
  return [
    group("opaque-slot-psa", "PSA", 1, 1, [
      option("opaque-placement-magma", "Magma Cast Generator", "Generator"),
      option("opaque-placement-heavy", "Heavy Battery", "Weapon"),
    ]),
    group("opaque-slot-fps-1", "FPS 1", 1, 1, [option("p-fury", "Fury", "Generator")]),
    group("opaque-slot-fps-2", "FPS 2", 1, 1, [option("p-flak", "Flak", "Weapon")]),
    group("opaque-slot-fps-3", "FPS 3", 1, 1, [option("p-mine", "Mine", "Weapon")]),
    group("opaque-slot-attachments", "Attachments", 0, 1, [
      option("p-repair", "Repair Crane", "Attachment"),
    ]),
    group("opaque-slot-escorts", "Escorts", 0, 4, [option("p-tanuki", "Tanuki Escort", "Escort")]),
  ];
}

function group(
  id: string,
  label: string,
  minimum: number,
  maximum: number,
  options: ShipEditorGroupReadModel["options"],
): ShipEditorGroupReadModel {
  return {
    id,
    label,
    help: `${minimum}–${maximum}`,
    scope: label === "Доктрина флота" ? "fleet" : "unit",
    control: minimum === 1 && maximum === 1 ? "exclusive" : "quantity",
    minimum,
    maximum,
    options,
  };
}

function option(id: string, label: string, kind: string) {
  return {
    id,
    label,
    kind,
    costLabel: "Бесплатно",
    selectedQuantity: 0,
    availability: "available" as const,
    reason: null,
  };
}
