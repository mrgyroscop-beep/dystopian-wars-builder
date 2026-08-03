import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { createHttpHealthGateway } from "../infrastructure/health/http-health-gateway";
import { createHttpPasswordAuthGateway } from "../infrastructure/auth/http-password-auth-gateway";
import { createHttpFeedbackGateway } from "../infrastructure/feedback/http-feedback-gateway";
import {
  createDemonstrationFleetCatalogGateway,
  createDemonstrationWorkspaceRoster,
} from "../infrastructure/catalog/demonstration-fleet-catalog";
import { createDemonstrationRosterSetupGateway } from "../infrastructure/catalog/demonstration-roster-setup";
import { createPublishedCatalogClient } from "../infrastructure/catalog/published-catalog";
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
const publishedCatalog = createPublishedCatalogClient();
const demonstrationCatalog = createDemonstrationFleetCatalogGateway();
const demonstrationSetup = createDemonstrationRosterSetupGateway();
const router = createAppRouter({
  authGateway: createHttpPasswordAuthGateway(),
  feedbackGateway: createHttpFeedbackGateway(),
  healthGateway: createHttpHealthGateway(),
  rosterCreation: {
    setupGateway: publishedCatalog.setupGateway,
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
    setupGateway: {
      contractVersion: 1,
      load: (contentVersion) =>
        contentVersion === "demonstration-1"
          ? demonstrationSetup.load(contentVersion)
          : publishedCatalog.setupGateway.load(contentVersion),
    },
    catalogGateway: {
      contractVersion: 1,
      load: (contentVersion, factionId) =>
        contentVersion === "demonstration-1"
          ? demonstrationCatalog.load(contentVersion)
          : publishedCatalog.catalogGateway.load(contentVersion, factionId),
    },
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
