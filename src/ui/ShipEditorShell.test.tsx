import { cleanup, render, screen, within } from "@testing-library/react";
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
  it("renders a compact summary with the configuration always open", async () => {
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

    expect(screen.getByRole("heading", { name: "Akita Demonstrator" })).toBeInTheDocument();
    expect(screen.getByLabelText("Сводка корабля")).toHaveTextContent("Points350VPR9");
    expect(screen.getByRole("region", { name: "Настройка корабля" })).toBeVisible();
    expect(screen.getAllByRole("group")).toHaveLength(6);
    const add = screen.getByRole("button", { name: "Добавить в состав" });
    expect(screen.getByRole("radio", { name: /Magma Cast Generator/u })).toBeDisabled();
    expect(screen.queryByRole("radio", { name: /Fury/u })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: /FPS 1/u })).getByRole("button"));
    expect(screen.queryByRole("radio", { name: /Magma Cast Generator/u })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Fury/u })).toBeDisabled();
    await user.click(add);
    expect(onAdd).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: /Назад/u }));
    expect(onBack).toHaveBeenCalledOnce();

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByText("Редактирование")).not.toBeInTheDocument();
    expect(screen.queryByText("Обязательные")).not.toBeInTheDocument();
    expect(screen.queryByText("фиксировано")).not.toBeInTheDocument();
    expect(screen.queryByText("Состав готов")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Что исправить" })).not.toBeInTheDocument();
  });

  it("keeps configuration commands and weapon inspection usable", async () => {
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

    expect(screen.getAllByRole("radio")).toHaveLength(2);
    await user.click(screen.getByRole("radio", { name: /Heavy Battery/u }));
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "replace-exclusive",
        groupId: "opaque-slot-psa",
        optionId: "opaque-placement-heavy",
      }),
      expect.any(String),
    );
    await user.click(screen.getByRole("button", { name: "Показать свойства Heavy Battery" }));
    expect(screen.getByRole("dialog", { name: "Heavy Battery" })).toBeVisible();
    expect(screen.getByRole("rowheader", { name: "Heavy Battery" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Закрыть профиль" }));
    expect(document.body.innerHTML).not.toMatch(/opaque-slot|DEMO-/u);
    expect(document.body.textContent).not.toMatch(/opaque-slot|DEMO-/u);
  });

  it("uses a clickable optional choice instead of a zero input", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const optionalGenerator = group("generators", "Generators", 0, 1, [
      {
        ...option("interphase", "Interphase Generator", "Generator"),
        description: "This generator bends light around the vessel.",
      },
      option("atomic", "Atomic Generator", "Generator"),
    ]);
    render(
      <ShipEditorShell
        busy={false}
        model={{ ...editorModel("matsumoto"), groups: [optionalGenerator] }}
        onAdd={vi.fn()}
        onBack={vi.fn()}
        onCommand={onCommand}
      />,
    );

    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    const generator = screen.getByRole("button", {
      name: /Interphase Generator/u,
      pressed: false,
    });
    expect(generator).toHaveAttribute("aria-pressed", "false");
    await user.click(generator);
    expect(onCommand).toHaveBeenCalledWith(
      {
        type: "replace-exclusive",
        instanceId: "matsumoto",
        groupId: "generators",
        optionId: "interphase",
      },
      expect.any(String),
    );

    await user.click(
      screen.getByRole("button", { name: "Показать свойства Interphase Generator" }),
    );
    expect(screen.getByRole("dialog", { name: "Interphase Generator" })).toHaveTextContent(
      "bends light",
    );
  });

  it("hires escorts with bounded stepper controls", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const escorts = group("escorts", "Escorts", 0, 4, [option("escort", "Escorts", "Escort")]);
    render(
      <ShipEditorShell
        busy={false}
        model={{ ...editorModel("matsumoto"), groups: [escorts] }}
        onAdd={vi.fn()}
        onBack={vi.fn()}
        onCommand={onCommand}
      />,
    );

    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Выбрано 0")).toBeVisible();
    expect(screen.getByRole("button", { name: "Уменьшить количество Escorts" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Увеличить количество Escorts" }));
    expect(onCommand).toHaveBeenCalledWith(
      {
        type: "set-choice-quantity",
        instanceId: "matsumoto",
        groupId: "escorts",
        optionId: "escort",
        quantity: 1,
      },
      expect.any(String),
    );
  });

  it("hides the Model tile even when its quantity is variable", () => {
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

    expect(screen.queryByRole("spinbutton", { name: "Количество" })).not.toBeInTheDocument();
    expect(screen.queryByText("Model")).not.toBeInTheDocument();
    expect(onCommand).not.toHaveBeenCalled();
    expect(screen.queryByText("Доктрина флота")).not.toBeInTheDocument();
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

  it("hides doctrine controls when the Battlefleet has no doctrine options", () => {
    render(
      <ShipEditorShell
        busy={false}
        model={{ ...editorModel("unit-instance"), fleetGroups: [] }}
        onAdd={vi.fn()}
        onBack={vi.fn()}
        onCommand={vi.fn()}
      />,
    );

    expect(screen.queryByRole("heading", { name: "Доктрина флота" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Настроить доктрину" })).not.toBeInTheDocument();
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
      option("opaque-placement-heavy", "Heavy Battery", "Weapon", true),
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

function option(id: string, label: string, kind: string, withProfile = false) {
  return {
    id,
    label,
    kind,
    costLabel: "Бесплатно",
    selectedQuantity: 0,
    availability: "available" as const,
    reason: null,
    profile: withProfile
      ? {
          id: `${id}-profile`,
          weapon: label,
          arc: "FPS",
          close: "4",
          standard: "6",
          extreme: "—",
          qualities: "All-Around",
          provenance: null,
        }
      : null,
  };
}
