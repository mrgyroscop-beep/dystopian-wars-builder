import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { createHttpHealthGateway } from "../infrastructure/health/http-health-gateway";
import { createHttpPasswordAuthGateway } from "../infrastructure/auth/http-password-auth-gateway";
import { createHttpRulesAssistantGateway } from "../infrastructure/assistant/http-rules-assistant-gateway";
import { createHttpFeedbackGateway } from "../infrastructure/feedback/http-feedback-gateway";
import { createHttpBattleGateway } from "../infrastructure/battle/http-battle-gateway";
import { createHttpGlossaryGateway } from "../infrastructure/glossary/http-glossary-gateway";
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
const router = createAppRouter({
  authGateway: createHttpPasswordAuthGateway(),
  battleGateway: createHttpBattleGateway(),
  assistantGateway: createHttpRulesAssistantGateway(),
  feedbackGateway: createHttpFeedbackGateway(),
  glossaryGateway: createHttpGlossaryGateway(),
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
    setupGateway: publishedCatalog.setupGateway,
    catalogGateway: publishedCatalog.catalogGateway,
    rosterRepository,
    createId,
    now,
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
