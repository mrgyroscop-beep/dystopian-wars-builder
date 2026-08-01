import {
  healthResponseSchema,
  type HealthGateway,
  type HealthResponse,
} from "../../application/health/health-contract";

export class HealthRequestError extends Error {
  override readonly name = "HealthRequestError";
}

export function createHttpHealthGateway(fetcher: typeof fetch = fetch): HealthGateway {
  return {
    async read(signal?: AbortSignal): Promise<HealthResponse> {
      const requestInit: RequestInit = {
        headers: { Accept: "application/json" },
      };

      if (signal) {
        requestInit.signal = signal;
      }

      const response = await fetcher("/api/health", requestInit);

      if (!response.ok) {
        throw new HealthRequestError(`Health endpoint returned ${response.status}.`);
      }

      const payload: unknown = await response.json();
      return healthResponseSchema.parse(payload);
    },
  };
}
