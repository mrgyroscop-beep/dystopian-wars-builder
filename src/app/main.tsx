import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { createHttpHealthGateway } from "../infrastructure/health/http-health-gateway";
import { createHttpPasswordAuthGateway } from "../infrastructure/auth/http-password-auth-gateway";
import { createHttpFeedbackGateway } from "../infrastructure/feedback/http-feedback-gateway";
import { createDemonstrationRosterSetupGateway } from "../infrastructure/catalog/demonstration-roster-setup";
import {
  createDemonstrationFleetCatalogGateway,
  createDemonstrationWorkspaceRoster,
} from "../infrastructure/catalog/demonstration-fleet-catalog";
import { createBrowserRosterRepository } from "../infrastructure/rosters/browser-roster-repository";
import { createSynchronizingRosterRepository } from "../infrastructure/rosters/synchronizing-roster-repository";
import { createAppRouter } from "./router";
import "./styles.css";

const rosterRepository = createSynchronizingRosterRepository(
  createBrowserRosterRepository(window.localStorage),
  window.localStorage,
);
const createId = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const router = createAppRouter({
  authGateway: createHttpPasswordAuthGateway(),
  feedbackGateway: createHttpFeedbackGateway(),
  healthGateway: createHttpHealthGateway(),
  rosterCreation: {
    setupGateway: createDemonstrationRosterSetupGateway(),
    rosterRepository,
    createId,
    now,
  },
  rosterLibrary: {
    rosterRepository,
    createId,
    now,
  },
  rosterWorkspace: {
    catalogGateway: createDemonstrationFleetCatalogGateway(),
    rosterRepository,
    createId,
    now,
    fallbackRoster: (id) =>
      id === "scaffold-demo" ? createDemonstrationWorkspaceRoster(id) : null,
  },
  rosterSync: rosterRepository,
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
