import { createBrowserRouter, type RouteObject } from "react-router-dom";

import type { HealthGateway } from "../application/health/health-contract";
import type { CreateRosterDependencies } from "../application/rosters/create-roster";
import type { RosterLibraryDependencies } from "../application/rosters/roster-library";
import type { RosterWorkspaceDependencies } from "../application/rosters/workspace";
import { AppShell } from "./shell/AppShell";
import { RouteErrorBoundary } from "../routes/RouteErrorBoundary";
import { NewRosterRoute } from "../routes/NewRosterRoute";
import { NotFoundRoute } from "../routes/NotFoundRoute";
import { RosterLibraryRoute } from "../routes/RosterLibraryRoute";
import { RosterWorkspaceRoute } from "../routes/RosterWorkspaceRoute";
import { SettingsRoute } from "../routes/SettingsRoute";

export interface AppDependencies {
  healthGateway: HealthGateway;
  rosterCreation: CreateRosterDependencies;
  rosterLibrary: RosterLibraryDependencies;
  rosterWorkspace: RosterWorkspaceDependencies;
}

export function createAppRoutes({
  healthGateway,
  rosterCreation,
  rosterLibrary,
  rosterWorkspace,
}: AppDependencies): RouteObject[] {
  return [
    {
      element: <AppShell />,
      errorElement: <RouteErrorBoundary />,
      children: [
        { index: true, element: <RosterLibraryRoute dependencies={rosterLibrary} /> },
        { path: "rosters/new", element: <NewRosterRoute {...rosterCreation} /> },
        {
          path: "rosters/:rosterId",
          element: <RosterWorkspaceRoute dependencies={rosterWorkspace} />,
        },
        { path: "settings", element: <SettingsRoute healthGateway={healthGateway} /> },
        { path: "*", element: <NotFoundRoute /> },
      ],
    },
  ];
}

export function createAppRouter(dependencies: AppDependencies) {
  return createBrowserRouter(createAppRoutes(dependencies));
}
