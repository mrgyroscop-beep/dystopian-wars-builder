import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { createHttpHealthGateway } from "../infrastructure/health/http-health-gateway";
import { createAppRouter } from "./router";
import "./styles.css";

const router = createAppRouter({
  healthGateway: createHttpHealthGateway(),
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
