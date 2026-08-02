import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ShipProfileRulesReadModel } from "../application/rosters/profile-rules";
import { RuleSheet, RulesPanel, SafeStructuredText } from "./ProfileRules";

afterEach(cleanup);

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
});

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
