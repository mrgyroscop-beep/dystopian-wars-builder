import { createBrowserRouter, Navigate, type RouteObject } from "react-router-dom";

import type { HealthGateway } from "../application/health/health-contract";
import type { BattleGateway } from "../application/battle/battle-contract";
import type { AuthGateway } from "../application/auth/auth-contract";
import type { FeedbackGateway } from "../application/feedback/feedback-contract";
import type { GlossaryGateway } from "../application/glossary/glossary-contract";
import type { RulesAssistantGateway } from "../application/assistant/rules-assistant-contract";
import type { CreateRosterDependencies } from "../application/rosters/create-roster";
import type { RosterLibraryDependencies } from "../application/rosters/roster-library";
import type { RosterSyncGateway } from "../application/rosters/roster-sync";
import type { RosterWorkspaceDependencies } from "../application/rosters/workspace";
import type { ShipLibraryDependencies } from "../application/ships/ship-library";
import { AppShell } from "./shell/AppShell";
import { FeedbackRoute } from "../routes/FeedbackRoute";
import { RouteErrorBoundary } from "../routes/RouteErrorBoundary";
import { NewRosterRoute } from "../routes/NewRosterRoute";
import { NotFoundRoute } from "../routes/NotFoundRoute";
import { RosterLibraryRoute } from "../routes/RosterLibraryRoute";
import { RosterWorkspaceRoute } from "../routes/RosterWorkspaceRoute";
import { ReferenceLibraryRoute } from "../routes/ReferenceLibraryRoute";
import { SettingsRoute } from "../routes/SettingsRoute";
import { CampaignRoute } from "../routes/CampaignRoute";
import { BattleRoute } from "../routes/BattleRoute";
import { ShipLibraryRoute } from "../routes/ShipLibraryRoute";

export interface AppDependencies {
  authGateway: AuthGateway;
  battleGateway: BattleGateway;
  assistantGateway: RulesAssistantGateway;
  feedbackGateway: FeedbackGateway;
  glossaryGateway: GlossaryGateway;
  healthGateway: HealthGateway;
  rosterCreation: CreateRosterDependencies;
  rosterLibrary: RosterLibraryDependencies;
  shipLibrary: ShipLibraryDependencies;
  rosterWorkspace: RosterWorkspaceDependencies;
  rosterSync: RosterSyncGateway;
}

export function createAppRoutes({
  authGateway,
  battleGateway,
  assistantGateway,
  feedbackGateway,
  glossaryGateway,
  healthGateway,
  rosterCreation,
  rosterLibrary,
  shipLibrary,
  rosterWorkspace,
  rosterSync,
}: AppDependencies): RouteObject[] {
  return [
    {
      element: <AppShell authGateway={authGateway} glossaryGateway={glossaryGateway} />,
      errorElement: <RouteErrorBoundary />,
      children: [
        { index: true, element: <RosterLibraryRoute dependencies={rosterLibrary} /> },
        {
          path: "battle",
          element: (
            <BattleRoute
              authGateway={authGateway}
              battleGateway={battleGateway}
              catalogGateway={rosterWorkspace.catalogGateway}
              rosterRepository={rosterLibrary.rosterRepository}
            />
          ),
        },
        { path: "campaign/:scenarioId?/:tab?", element: <CampaignRoute /> },
        { path: "rosters/new", element: <NewRosterRoute {...rosterCreation} /> },
        {
          path: "ships/:factionId?",
          element: <ShipLibraryRoute dependencies={shipLibrary} />,
        },
        {
          path: "reference",
          element: (
            <ReferenceLibraryRoute authGateway={authGateway} assistantGateway={assistantGateway} />
          ),
        },
        {
          path: "assistant",
          element: <Navigate replace to="/reference?view=assistant" />,
        },
        {
          path: "feedback",
          element: (
            <FeedbackRoute feedbackGateway={feedbackGateway} healthGateway={healthGateway} />
          ),
        },
        {
          path: "rosters/:rosterId",
          element: <RosterWorkspaceRoute dependencies={rosterWorkspace} />,
        },
        {
          path: "settings",
          element: (
            <SettingsRoute
              authGateway={authGateway}
              healthGateway={healthGateway}
              rosterSync={rosterSync}
            />
          ),
        },
        { path: "*", element: <NotFoundRoute /> },
      ],
    },
  ];
}

export function createAppRouter(dependencies: AppDependencies) {
  return createBrowserRouter(createAppRoutes(dependencies));
}
