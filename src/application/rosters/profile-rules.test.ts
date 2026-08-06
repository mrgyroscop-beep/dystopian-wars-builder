import { describe, expect, it } from "vitest";

import { toSafePresentation } from "../../domain/catalog";
import { createDemonstrationFleetCatalog } from "../../infrastructure/catalog/demonstration-fleet-catalog";
import { projectWeaponDefinition } from "./profile-rules";

describe("weapon profile projection", () => {
  it("reads production range labels that include distance annotations", () => {
    const source = createDemonstrationFleetCatalog();
    const weapon = Object.values(source.entities).find((entity) => entity.kind === "Weapon")!;
    const productionLabels: Readonly<Record<string, string>> = {
      Close: 'Close (0"-10")',
      Standard: 'Standard (10"- 30")',
      Extreme: 'Extreme (+30")',
    };
    const expected = Object.fromEntries(
      weapon.fields.map((field) => [field.label.plainText, field.value.plainText]),
    );
    const catalog = {
      ...source,
      entities: {
        ...source.entities,
        [weapon.id]: {
          ...weapon,
          fields: weapon.fields.map((field) => ({
            ...field,
            label: toSafePresentation(
              productionLabels[field.label.plainText] ?? field.label.plainText,
            ),
          })),
        },
      },
    };

    expect(projectWeaponDefinition(catalog, catalog.entities[weapon.id]!)).toMatchObject({
      close: expected.Close,
      standard: expected.Standard,
      extreme: expected.Extreme,
    });
  });
});
