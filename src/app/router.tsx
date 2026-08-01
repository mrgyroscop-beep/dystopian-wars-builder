import { createBrowserRouter, type RouteObject } from "react-router-dom";

import { AppShell } from "./shell/AppShell";
import { RouteErrorBoundary } from "../routes/RouteErrorBoundary";
import { NewRosterRoute } from "../routes/NewRosterRoute";
import { NotFoundRoute } from "../routes/NotFoundRoute";
import { RosterLibraryRoute } from "../routes/RosterLibraryRoute";
import { RosterWorkspaceRoute } from "../routes/RosterWorkspaceRoute";
import { SettingsRoute } from "../routes/SettingsRoute";

export const appRoutes: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <RosterLibraryRoute /> },
      { path: "rosters/new", element: <NewRosterRoute /> },
      { path: "rosters/:rosterId", element: <RosterWorkspaceRoute /> },
      { path: "settings", element: <SettingsRoute /> },
      { path: "*", element: <NotFoundRoute /> },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);
