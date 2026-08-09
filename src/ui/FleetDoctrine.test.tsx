import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FleetDoctrineReadModel } from "../application/rosters/ship-editor";
import { FleetDoctrinePanel } from "./FleetDoctrine";
import { GlossaryProvider } from "./GlossaryContext";

describe("FleetDoctrinePanel", () => {
  beforeEach(() => window.localStorage.setItem("dwb-rule-language", "ru"));
  afterEach(cleanup);

  it("keeps unavailable doctrine descriptions inspectable and marks an English fallback", async () => {
    const user = userEvent.setup();
    renderPanel(doctrine("one-total"));

    await user.click(screen.getByRole("button", { name: /доктрина флота/iu }));
    const unavailable = screen.getByRole("radio", { name: "PADDLEWHEEL SURGE" });
    expect(unavailable).toBeDisabled();
    expect(screen.getByText(/Chinese · Surface/iu)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /показать описание доктрины PADDLEWHEEL SURGE/iu,
      }),
    );
    await waitFor(() => expect(screen.getByText(/перевод пока недоступен/iu)).toBeInTheDocument());
    expect(screen.getByText(/english source text/iu)).toBeInTheDocument();
  });

  it("shows both selected Enlightened families and uses one radio group per family", async () => {
    const user = userEvent.setup();
    renderPanel(doctrine("one-per-group", true));

    expect(screen.getByRole("button", { name: /FIRST PEER.*FIRST FORGE/iu })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /доктрина флота/iu }));
    const peer = screen.getByRole("radio", { name: "FIRST PEER" });
    const forge = screen.getByRole("radio", { name: "FIRST FORGE" });
    expect(peer).toBeChecked();
    expect(forge).toBeChecked();
    expect(peer).not.toHaveAttribute("name", forge.getAttribute("name"));
  });
});

function renderPanel(value: FleetDoctrineReadModel) {
  return render(
    <GlossaryProvider gateway={{ contractVersion: 1, list: () => Promise.resolve([]) }}>
      <FleetDoctrinePanel busy={false} doctrine={value} onCommand={vi.fn()} />
    </GlossaryProvider>,
  );
}

function doctrine(
  selectionMode: FleetDoctrineReadModel["selectionMode"],
  selected = false,
): FleetDoctrineReadModel {
  return {
    ownerInstanceId: "fleet",
    selectionMode,
    groups: [
      {
        id: "peer",
        label: "Driven By The Peer",
        help: "Peer family",
        scope: "fleet",
        control: "exclusive",
        minimum: 0,
        maximum: 1,
        options: [
          {
            id: "peer-option",
            label: "FIRST PEER",
            kind: "Option",
            costLabel: "+10 Points",
            selectedQuantity: selected ? 1 : 0,
            availability: "available",
            reason: null,
            description: "Peer doctrine.",
          },
          {
            id: "paddlewheel",
            label: "PADDLEWHEEL SURGE",
            kind: "Option",
            costLabel: "+30 Points",
            selectedQuantity: 0,
            availability: "unavailable",
            reason: "Требуется флагман с признаками: Chinese · Surface.",
            description: "English source text.",
          },
        ],
      },
      {
        id: "forge",
        label: "Constructed By The Forge",
        help: "Forge family",
        scope: "fleet",
        control: "exclusive",
        minimum: 0,
        maximum: 1,
        options: [
          {
            id: "forge-option",
            label: "FIRST FORGE",
            kind: "Option",
            costLabel: "+20 Points",
            selectedQuantity: selected ? 1 : 0,
            availability: "available",
            reason: null,
            description: "Forge doctrine.",
          },
        ],
      },
    ],
  };
}
