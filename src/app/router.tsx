import { createBrowserRouter, type RouteObject } from "react-router-dom";

import type { HealthGateway } from "../application/health/health-contract";
import { AppShell } from "./shell/AppShell";
import { RouteErrorBoundary } from "../routes/RouteErrorBoundary";
import { NewRosterRoute } from "../routes/NewRosterRoute";
import { NotFoundRoute } from "../routes/NotFoundRoute";
import { RosterLibraryRoute } from "../routes/RosterLibraryRoute";
import { RosterWorkspaceRoute } from "../routes/RosterWorkspaceRoute";
import { SettingsRoute } from "../routes/SettingsRoute";

export interface AppDependencies {
  healthGateway: HealthGateway;
}

export function createAppRoutes({ healthGateway }: AppDependencies): RouteObject[] {
  return [
    {
      element: <AppShell />,
      errorElement: <RouteErrorBoundary />,
      children: [
        { index: true, element: <RosterLibraryRoute /> },
        { path: "rosters/new", element: <NewRosterRoute /> },
        { path: "rosters/:rosterId", element: <RosterWorkspaceRoute /> },
        { path: "settings", element: <SettingsRoute healthGateway={healthGateway} /> },
        { path: "*", element: <NotFoundRoute /> },
      ],
    },
  ];
}

export function createAppRouter(dependencies: AppDependencies) {
  return createBrowserRouter(createAppRoutes(dependencies));
}
