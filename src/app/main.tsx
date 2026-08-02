import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { createHttpHealthGateway } from "../infrastructure/health/http-health-gateway";
import { createDemonstrationRosterSetupGateway } from "../infrastructure/catalog/demonstration-roster-setup";
import { createBrowserRosterRepository } from "../infrastructure/rosters/browser-roster-repository";
import { createAppRouter } from "./router";
import "./styles.css";

const rosterRepository = createBrowserRosterRepository(window.localStorage);
const router = createAppRouter({
  healthGateway: createHttpHealthGateway(),
  rosterRepository,
  rosterCreation: {
    setupGateway: createDemonstrationRosterSetupGateway(),
    rosterRepository,
    createId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  },
});

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Application root element is missing.");
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
