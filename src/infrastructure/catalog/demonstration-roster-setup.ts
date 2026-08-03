import type { RosterSetupGateway } from "../../application/rosters/create-roster";

const demonstrationCatalog = {
  contractVersion: 1,
  contentVersion: "demonstration-1",
  mode: "demonstration",
  notice:
    "Демонстрационные данные: публикация актуального игрового каталога ожидает отдельного разрешения правообладателя.",
  factions: [
    {
      id: "demo-empire",
      label: "Empire",
      battlefleets: [
        {
          id: "demo-empire-patrol",
          factionId: "demo-empire",
          label: "Harbour Patrol",
          summary:
            "Учебный Battlefleet с флагманом и линейным элементом для проверки сценария создания.",
          requiredElements: [
            { id: "demo-flagship", label: "Flagship Element", minimum: 1 },
            { id: "demo-line", label: "Line Element", minimum: 1 },
          ],
        },
        {
          id: "demo-empire-line-squadron",
          factionId: "demo-empire",
          label: "Line Squadron",
          summary: "Линейная учебная эскадра без обязательного флагманского элемента.",
          requiredElements: [{ id: "demo-line", label: "Line Element", minimum: 1 }],
        },
      ],
    },
    {
      id: "demo-crown",
      label: "Crown",
      battlefleets: [
        {
          id: "demo-crown-vanguard",
          factionId: "demo-crown",
          label: "Vanguard Exercise",
          summary: "Манёвренная учебная группа с обязательным командным и патрульным элементами.",
          requiredElements: [
            { id: "demo-command", label: "Command Element", minimum: 1 },
            { id: "demo-patrol", label: "Patrol Element", minimum: 1 },
          ],
        },
      ],
    },
  ],
} as const;

export function createDemonstrationRosterSetupGateway(): RosterSetupGateway {
  return {
    contractVersion: 1,
    load: () => Promise.resolve(demonstrationCatalog),
  };
}
