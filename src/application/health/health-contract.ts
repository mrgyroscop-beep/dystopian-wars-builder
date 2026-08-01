import { z } from "zod";

export const APP_VERSION = "0.1.0";
export const CATALOG_VERSION = "not-imported";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  environment: z.enum(["local", "preview"]),
  appVersion: z.string().min(1),
  catalogVersion: z.string().min(1),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export interface HealthGateway {
  read(signal?: AbortSignal): Promise<HealthResponse>;
}

export function getHealth(gateway: HealthGateway, signal?: AbortSignal): Promise<HealthResponse> {
  return gateway.read(signal);
}
