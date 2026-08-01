import type { ReactNode } from "react";

export const fixtureStates = ["loading", "empty", "error", "success"] as const;

export type FixtureState = (typeof fixtureStates)[number];

type StatePanelProps = {
  state: FixtureState;
  title: string;
  description: string;
  action?: ReactNode;
};

const symbols: Record<FixtureState, string> = {
  loading: "…",
  empty: "○",
  error: "!",
  success: "✓",
};

export function StatePanel({ state, title, description, action }: StatePanelProps) {
  const liveRole = state === "error" ? "alert" : state === "loading" ? "status" : undefined;

  return (
    <section
      aria-busy={state === "loading" ? true : undefined}
      className="state-panel"
      data-state={state}
      role={liveRole}
    >
      <span className="state-panel__symbol" aria-hidden="true">
        {symbols[state]}
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div className="button-row">{action}</div> : null}
    </section>
  );
}
