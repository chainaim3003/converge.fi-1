/**
 * StimulationRunner
 * ================
 * Parses Postman collection JSONs from config/stimulation/ and executes
 * the full ACTUS pipeline: load risk factors (8082) → run simulation (8083).
 *
 * Each Postman collection has items that are sequential API calls.
 * This runner extracts method, path, and body from each item,
 * replaces the host with the correct environment URL, and executes them.
 */

import axios from 'axios';

// ── Types ────────────────────────────────────────────────────────────

/** Result of a single step in the pipeline */
export interface StepResult {
  step: number;
  name: string;
  method: string;
  url: string;
  status: 'success' | 'failed';
  httpStatus?: number;
  response?: any;
  error?: string;
  durationMs: number;
}

/** Final result returned to the UI */
export interface StimulationResult {
  success: boolean;
  scenarioName: string;
  description: string;
  environment: string;
  riskServiceUrl: string;
  actusServerUrl: string;
  steps: StepResult[];
  simulation: any | null;
  totalDurationMs: number;
  timestamp: string;
}

/** Environment URL configuration */
export interface EnvironmentConfig {
  riskServiceBase: string;   // e.g. http://localhost:8082
  actusServerBase: string;   // e.g. http://localhost:8083
}

// ── Predefined environments ─────────────────────────────────────────

export const ENVIRONMENTS: Record<string, EnvironmentConfig> = {
  localhost: {
    riskServiceBase: 'http://localhost:8082',
    actusServerBase: 'http://localhost:8083',
  },
  aws: {
    riskServiceBase: 'http://34.203.247.32:8082',
    actusServerBase: 'http://34.203.247.32:8083',
  },
};

// ── Postman collection parsing ──────────────────────────────────────

/**
 * Extract the URL path from a Postman URL object.
 * Postman stores URLs as either a raw string or a structured object
 * with host and path arrays.
 */
function extractPathFromPostmanUrl(urlObj: any): { port: string; path: string } {
  if (typeof urlObj === 'string') {
    const parsed = new URL(urlObj);
    return { port: parsed.port, path: parsed.pathname };
  }
  // Structured Postman URL: { raw, protocol, host: ["localhost:8082"], path: ["addReferenceIndex"] }
  const raw: string = urlObj.raw || '';
  const parsed = new URL(raw);
  return { port: parsed.port, path: parsed.pathname };
}

/**
 * Given a Postman port (8082 or 8083), return the correct base URL
 * for the chosen environment.
 */
function resolveBaseUrl(port: string, env: EnvironmentConfig): string {
  if (port === '8083') return env.actusServerBase;
  return env.riskServiceBase; // default to 8082
}

// ── Main runner ─────────────────────────────────────────────────────

/**
 * Execute all steps from a parsed Postman collection JSON.
 *
 * @param collectionJson - The full parsed JSON of a Postman collection
 * @param env            - The environment config to use
 * @returns StimulationResult with all step outcomes and the final simulation
 */
export async function runStimulation(
  collectionJson: any,
  env: EnvironmentConfig,
  envName: string
): Promise<StimulationResult> {
  const startTime = Date.now();
  const items: any[] = collectionJson.item || [];
  const info = collectionJson.info || {};
  const steps: StepResult[] = [];
  let simulation: any = null;
  let allSuccess = true;

  console.log(`\n🚀 StimulationRunner: ${info.name || 'Unknown'}`);
  console.log(`   Environment: ${envName}`);
  console.log(`   Risk Service: ${env.riskServiceBase}`);
  console.log(`   ACTUS Server: ${env.actusServerBase}`);
  console.log(`   Steps: ${items.length}`);
  console.log('─'.repeat(60));

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const request = item.request;
    if (!request) {
      console.warn(`   ⚠️  Step ${i + 1}: no request object, skipping`);
      continue;
    }

    const method: string = (request.method || 'GET').toUpperCase();
    const { port, path } = extractPathFromPostmanUrl(request.url);
    const baseUrl = resolveBaseUrl(port, env);
    const fullUrl = `${baseUrl}${path}`;

    // Extract body for POST requests
    let body: any = undefined;
    if (request.body && request.body.raw) {
      try {
        body = JSON.parse(request.body.raw);
      } catch {
        body = request.body.raw;
      }
    }

    const stepStart = Date.now();
    console.log(`   Step ${i + 1}/${items.length}: ${method} ${fullUrl}`);

    try {
      const response = await axios({
        method: method.toLowerCase() as any,
        url: fullUrl,
        data: body,
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      });

      const stepResult: StepResult = {
        step: i + 1,
        name: item.name || `Step ${i + 1}`,
        method,
        url: fullUrl,
        status: 'success',
        httpStatus: response.status,
        response: response.data,
        durationMs: Date.now() - stepStart,
      };

      steps.push(stepResult);
      console.log(`   ✅ ${response.status} (${stepResult.durationMs}ms)`);

      // The last POST to 8083 is the simulation — capture it
      if (port === '8083' && method === 'POST') {
        simulation = response.data;
      }
    } catch (error: any) {
      allSuccess = false;
      const stepResult: StepResult = {
        step: i + 1,
        name: item.name || `Step ${i + 1}`,
        method,
        url: fullUrl,
        status: 'failed',
        httpStatus: error.response?.status,
        error: error.message,
        durationMs: Date.now() - stepStart,
      };

      steps.push(stepResult);
      console.error(`   ❌ FAILED: ${error.message}`);

      // If a setup step fails, stop — simulation won't work
      if (port === '8082') {
        console.error(`   🛑 Risk service step failed. Aborting remaining steps.`);
        break;
      }
    }
  }

  const totalDurationMs = Date.now() - startTime;
  console.log('─'.repeat(60));
  console.log(`   Total: ${totalDurationMs}ms | Steps: ${steps.length}/${items.length} | Success: ${allSuccess}`);
  if (simulation) {
    const eventCount = simulation?.[0]?.events?.length ?? 0;
    console.log(`   Simulation events: ${eventCount}`);
  }
  console.log('');

  return {
    success: allSuccess && simulation !== null,
    scenarioName: info.name || 'Unknown',
    description: info.description || '',
    environment: envName,
    riskServiceUrl: env.riskServiceBase,
    actusServerUrl: env.actusServerBase,
    steps,
    simulation,
    totalDurationMs,
    timestamp: new Date().toISOString(),
  };
}
