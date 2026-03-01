/**
 * Input validation utilities for risk-engine endpoints.
 */

/**
 * Validate that a simulation ID is safe (no path traversal, valid characters).
 */
export function isValidSimulationId(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  if (id.length > 200) return false;
  // Allow alphanumeric, hyphens, underscores, dots (for filenames)
  return /^[a-zA-Z0-9\-_.]+$/.test(id);
}

/**
 * Validate CRE report parameters.
 */
export function isValidCREReportRequest(body: any): {
  valid: boolean;
  error?: string;
} {
  if (!body) return { valid: false, error: "Request body is required" };

  if (body.simulationId && !isValidSimulationId(body.simulationId)) {
    return { valid: false, error: "Invalid simulation ID format" };
  }

  return { valid: true };
}

/**
 * Validate verify request parameters.
 */
export function isValidVerifyRequest(body: any): {
  valid: boolean;
  error?: string;
} {
  if (!body) return { valid: false, error: "Request body is required" };

  if (!body.simulationId) {
    return { valid: false, error: "simulationId is required" };
  }

  if (!isValidSimulationId(body.simulationId)) {
    return { valid: false, error: "Invalid simulation ID format" };
  }

  return { valid: true };
}
