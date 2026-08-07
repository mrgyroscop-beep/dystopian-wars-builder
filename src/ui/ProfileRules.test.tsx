import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ShipProfileRulesReadModel } from "../application/rosters/profile-rules";
import { WeaponProfileDialog } from "./ProfileDialog";
import { GlossaryProvider } from "./GlossaryContext";
import { ProfilePanel, RuleSheet, RulesPanel, SafeStructuredText } from "./ProfileRules";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem("dwb-rule-language");
  vi.restoreAllMocks();
});

describe("profile and rules components", () => {
  it("renders only the safe AST allowlist and fails hostile structures closed", () => {
    render(
      <SafeStructuredText
        value={{
          plainText: "do not use fallback <script>alert(1)</script>",
          blocks: [
            {
              type: "paragraph",
              children: [
                {
                  type: "reference",
                  value: "hostile",
                  reference: { state: "resolved", target: "javascript:alert(1)" },
                },
              ],
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Описание недоступно")).toBeInTheDocument();
    expect(document.querySelector("script, style, a, [style]")).toBeNull();
    expect(document.body.innerHTML).not.toContain("javascript:");
  });

  it("opens duplicate labels by stable ID and keeps unavailable rules explicit", async () => {
    const user = userEvent.setup();
    const onOpenRule = vi.fn();
    render(<RulesPanel model={model()} onOpenRule={onOpenRule} />);
    const duplicateButtons = screen.getAllByRole("button", { name: "Открыть правило Torrent" });
    await user.click(duplicateButtons[1]!);
    expect(onOpenRule).toHaveBeenCalledWith("rule-torrent-b", duplicateButtons[1]);

    cleanup();
    render(
      <RuleSheet model={model()} onBack={vi.fn()} onOpenRule={vi.fn()} ruleId="rule-torrent-b" />,
    );
    expect(screen.getByText("Описание недоступно")).toBeInTheDocument();
    expect(screen.getByText("Источник: каталог catalog-42")).toBeInTheDocument();
  });

  it("traps glossary focus, closes on Escape and returns focus", async () => {
    const user = userEvent.setup();
    render(<RulesPanel model={model()} onOpenRule={vi.fn()} />);
    const source = screen.getByRole("button", { name: "Глоссарий" });
    await user.click(source);
    expect(screen.getByRole("dialog", { name: "Глоссарий" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Закрыть глоссарий" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Глоссарий" })).not.toBeInTheDocument();
    expect(source).toHaveFocus();
  });

  it("renders repeated configured weapons as unique table rows and cards without key warnings", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ProfilePanel model={modelWithRepeatedWeapons()} />);

    const rows = screen.getAllByRole("row", { name: /Heavy Battery/u });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("PSA");
    expect(rows[1]).toHaveTextContent("FPS 1");
    const cards = document.querySelectorAll(".weapon-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("PSA");
    expect(cards[1]).toHaveTextContent("FPS 1");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("opens weapon profiles from configured systems", async () => {
    const user = userEvent.setup();
    const onInspectWeapon = vi.fn();
    const profile = {
      id: "weapon-scything-tail",
      weapon: "Scything Tail",
      arc: "FPSA",
      close: "—",
      standard: "—",
      extreme: "—",
      qualities: "Assault, Piercing (1)",
      provenance: null,
    };
    const source = model();
    render(
      <ProfilePanel
        model={{
          ...source,
          sections: source.sections.map((section) =>
            section.id === "systems"
              ? {
                  ...section,
                  rows: [
                    {
                      id: "system-scything-tail",
                      label: "Scything Tail",
                      value: {
                        plainText: "Установлено",
                        blocks: [
                          {
                            type: "paragraph" as const,
                            children: [{ type: "text" as const, value: "Установлено" }],
                          },
                        ],
                        contentUnavailable: false,
                        diagnostics: [],
                      },
                      provenance: null,
                    },
                  ],
                }
              : section,
          ),
          weapons: [profile],
        }}
        onInspectWeapon={onInspectWeapon}
      />,
    );

    const trigger = screen.getAllByRole("button", {
      name: "Показать свойства Scything Tail",
    })[0]!;
    await user.click(trigger);
    expect(onInspectWeapon).toHaveBeenCalledWith(profile);
  });

  it("opens a weapon quality description and returns focus to its link", async () => {
    const user = userEvent.setup();
    const torrentRule = model().rules[0]!;
    render(
      <WeaponProfileDialog
        onClose={vi.fn()}
        profile={{
          id: "weapon-mortar",
          weapon: "Heavy Corrosive Mortar",
          arc: "FPS",
          close: "—",
          standard: "4",
          extreme: "6",
          qualities: "All-Around, Torrent (1)",
          qualityRules: [torrentRule],
          provenance: null,
        }}
      />,
    );

    const trigger = screen.getAllByRole("button", {
      name: "Показать описание Torrent (1)",
    })[0]!;
    await user.click(trigger);

    expect(screen.getByRole("dialog", { name: "Torrent (1)" })).toHaveTextContent(
      "Первое правило.",
    );
    expect(screen.getByRole("button", { name: "Закрыть описание правила" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Torrent (1)" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("switches a linked trait between Russian and English", async () => {
    const user = userEvent.setup();
    const source = model();
    render(
      <GlossaryProvider
        gateway={{
          contractVersion: 1,
          list: () =>
            Promise.resolve([
              {
                id: "R1",
                title: "Torrent",
                text: "Original rule.",
                factions: [],
                page: 32,
                translation: {
                  id: "R1",
                  language: "ru",
                  sourceTitle: "Torrent",
                  title: "Шквал",
                  text: "Русский текст правила.",
                },
              },
            ]),
        }}
      >
        <RuleSheet model={source} onBack={vi.fn()} onOpenRule={vi.fn()} ruleId="rule-torrent-a" />
      </GlossaryProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Шквал" })).toBeVisible();
    expect(screen.getByText("Русский текст правила.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByRole("heading", { name: "Torrent" })).toBeVisible();
    expect(screen.getByText("Первое правило.")).toBeVisible();
  });
});

function modelWithRepeatedWeapons(): ShipProfileRulesReadModel {
  const base = model();
  return {
    ...base,
    weapons: [
      {
        id: "weapon-heavy:occurrence:psa-instance",
        weapon: "Heavy Battery",
        arc: "F",
        close: "3",
        standard: "2",
        extreme: "1",
        qualities: "Torrent",
        provenance: "PSA",
      },
      {
        id: "weapon-heavy:occurrence:fps-instance",
        weapon: "Heavy Battery",
        arc: "F",
        close: "3",
        standard: "2",
        extreme: "1",
        qualities: "Torrent",
        provenance: "FPS 1",
      },
    ],
  };
}

function model(): ShipProfileRulesReadModel {
  return {
    variant: "effective",
    sourceCatalogVersion: "catalog-42",
    versionState: "current",
    sections: [
      { id: "model", label: "Model", rows: [] },
      { id: "properties", label: "Properties", rows: [] },
      { id: "systems", label: "Systems", rows: [] },
    ],
    weapons: [],
    rules: [
      {
        id: "rule-torrent-a",
        label: "Torrent",
        description: {
          plainText: "Первое правило.",
          blocks: [{ type: "paragraph", children: [{ type: "text", value: "Первое правило." }] }],
          contentUnavailable: false,
          diagnostics: [],
        },
        available: true,
        diagnostic: null,
      },
      {
        id: "rule-torrent-b",
        label: "Torrent",
        description: null,
        available: false,
        diagnostic: "Ссылка на правило не разрешена.",
      },
    ],
    diagnostics: [],
  };
}
