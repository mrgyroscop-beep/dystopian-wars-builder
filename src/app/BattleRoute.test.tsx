import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { BattleRoom } from "../application/battle/battle-contract";
import type { StoredRoster } from "../application/rosters/create-roster";
import {
  applyShipEditorCommand,
  materializeShipStructure,
  projectShipEditor,
} from "../application/rosters/ship-editor";
import { rosterInstanceId, type RosterSelectionInstance } from "../domain/roster";
import {
  createDemonstrationFleetCatalog,
  createDemonstrationFleetCatalogGateway,
  createDemonstrationWorkspaceRoster,
} from "../infrastructure/catalog/demonstration-fleet-catalog";
import { BattleRoute } from "../routes/BattleRoute";

describe("battle ship profiles", () => {
  it("shows Quick Reference faces in the key and the selected ship weapons in its profile", async () => {
    const user = userEvent.setup();
    const roster = configuredRoster();
    const room: BattleRoom = {
      key: ["hazard", "hazard", "navigation-lock"],
      you: "host",
      status: "active",
      version: 3,
      round: 1,
      activeSide: "host",
      expiresAt: "2026-08-13T00:00:00.000Z",
      host: {
        displayName: "Адмирал",
        roster: roster as unknown as BattleRoom["host"]["roster"],
        ready: true,
        shipState: {},
      },
      guest: null,
    };

    const { container } = render(
      <MemoryRouter initialEntries={["/battle?key=hazard.hazard.navigation-lock"]}>
        <BattleRoute
          authGateway={{
            contractVersion: 1,
            session: () =>
              Promise.resolve({
                id: "user-1",
                displayName: "Адмирал",
                email: "admiral@example.com",
              }),
            register: () => Promise.reject(new Error("not used")),
            login: () => Promise.reject(new Error("not used")),
            logout: () => Promise.resolve(),
            deleteAccount: () => Promise.resolve(),
          }}
          battleGateway={{
            contractVersion: 1,
            create: () => Promise.reject(new Error("not used")),
            join: () => Promise.reject(new Error("not used")),
            read: () => Promise.resolve(room),
            update: () => Promise.resolve(room),
            leave: () => Promise.resolve(),
          }}
          catalogGateway={createDemonstrationFleetCatalogGateway()}
          rosterRepository={{
            contractVersion: 1,
            save: () => Promise.resolve(),
            read: () => Promise.resolve(roster),
            list: () => Promise.resolve([roster]),
            remove: () => Promise.resolve(),
          }}
        />
      </MemoryRouter>,
    );

    expect(await screen.findAllByText("Hazard")).toHaveLength(2);
    expect(screen.getAllByText("Navigation Lock")[0]).toBeVisible();
    expect(
      container.querySelectorAll('.critical-key img[src^="/battle/critical-dice/"]'),
    ).toHaveLength(3);

    const shipName = await screen.findByText("Akita Demonstrator");
    await user.click(shipName.closest("summary")!);
    await user.click(screen.getByRole("button", { name: "Профиль и выбранные пушки" }));

    const dialog = await screen.findByRole("dialog", { name: "Akita Demonstrator" });
    expect(within(dialog).getAllByText("Heavy Battery")[0]).toBeVisible();
    expect(within(dialog).getAllByText("Torpedo Battery")[0]).toBeVisible();
    expect(within(dialog).queryByText("Sealed Experimental Array")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Rocket Battery")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("heading", { name: /Опции хардпоинтов|Hardpoint options/u }),
    ).not.toBeInTheDocument();
    const mobileProfile = within(dialog).getByRole("article", {
      name: "Мобильный профиль Akita Demonstrator",
    });
    expect(within(mobileProfile).getByText("Escorts").closest("div")).toHaveTextContent("3");
  });
});

function configuredRoster(): StoredRoster {
  const catalog = createDemonstrationFleetCatalog();
  const battlefleet = entityByLabel(catalog, "Harbour Patrol");
  const element = entityByLabel(catalog, "Flagship Element");
  const unitDefinition = entityByLabel(catalog, "Akita Demonstrator");
  const elementPlacement = Object.values(catalog.placements).find(
    (candidate) => candidate.ownerId === battlefleet.id && candidate.definitionId === element.id,
  )!;
  const unitPlacement = Object.values(catalog.placements).find(
    (candidate) => candidate.ownerId === element.id && candidate.definitionId === unitDefinition.id,
  )!;
  const root = selection("fleet", battlefleet.id, null, null, "fleet");
  const elementInstance = selection("element", element.id, elementPlacement.id, root.id, root.id);
  const unit = selection(
    "akita-instance",
    unitDefinition.id,
    unitPlacement.id,
    elementInstance.id,
    root.id,
  );
  let sequence = 0;
  const createId = () => `battle-profile-${++sequence}`;
  let snapshot = materializeShipStructure(
    {
      contractVersion: 1,
      id: "battle-profile-test",
      catalogContentVersion: catalog.contentVersion,
      rootInstanceIds: [root.id],
      instances: { [root.id]: root, [elementInstance.id]: elementInstance, [unit.id]: unit },
    },
    catalog,
    unit,
    createId,
  );

  for (const [groupLabel, weaponLabel] of [
    ["PSA", "Heavy Battery"],
    ["FPS 1", "Torpedo Battery"],
  ] as const) {
    const projected = projectShipEditor(
      snapshot,
      catalog,
      unit.id,
      unit.definitionId,
      "saved-local",
    );
    if (projected.dataState !== "ready") throw new Error(projected.detail);
    const group = projected.groups.find((candidate) => candidate.label === groupLabel)!;
    const option = group.options.find((candidate) => candidate.label === weaponLabel)!;
    snapshot = applyShipEditorCommand(
      snapshot,
      catalog,
      {
        type: "replace-exclusive",
        instanceId: unit.id,
        groupId: group.id,
        optionId: option.id,
      },
      createId,
    );
  }

  const projected = projectShipEditor(snapshot, catalog, unit.id, unit.definitionId, "saved-local");
  if (projected.dataState !== "ready") throw new Error(projected.detail);
  const escorts = projected.groups.find((candidate) => candidate.label === "Escorts")!;
  const escort = escorts.options.find((candidate) => candidate.label === "Tanuki Escort")!;
  snapshot = applyShipEditorCommand(
    snapshot,
    catalog,
    {
      type: "set-choice-quantity",
      instanceId: unit.id,
      groupId: escorts.id,
      optionId: escort.id,
      quantity: 3,
    },
    createId,
  );

  return { ...createDemonstrationWorkspaceRoster("battle-profile-test"), roster: snapshot };
}

function entityByLabel(catalog: ReturnType<typeof createDemonstrationFleetCatalog>, label: string) {
  const entity = Object.values(catalog.entities).find(
    (candidate) => candidate.label.plainText === label,
  );
  if (!entity) throw new Error(`Missing entity ${label}`);
  return entity;
}

function selection(
  id: string,
  definitionId: string,
  placementId: string | null,
  parentInstanceId: string | null,
  forceInstanceId: string,
): RosterSelectionInstance {
  return {
    contractVersion: 1,
    id: rosterInstanceId(id),
    definitionId: definitionId as RosterSelectionInstance["definitionId"],
    placementId: placementId as RosterSelectionInstance["placementId"],
    slotId: null,
    parentInstanceId: parentInstanceId as RosterSelectionInstance["parentInstanceId"],
    forceInstanceId: rosterInstanceId(forceInstanceId),
    quantity: 1,
  };
}
