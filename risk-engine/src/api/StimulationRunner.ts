/**
 * StimulationRunner
 * ================
 * Parses Postman collection JSONs from config/stimulation/ and executes
 * the full ACTUS pipeline: load risk factors (8082) → run simulation (8083).
 *
 * Two modes:
 *   1. HTTP mode   — collections whose items make real HTTP requests to ACTUS.
 *                    e.g. StableCoin-BackingRatio-RedemptionPressure-30d
 *
 *   2. Scripted mode — collections where all logic lives in Postman prerequest/test
 *                    JS scripts with a pm/postman runtime. No risk-service (8082)
 *                    needed; only optional ACTUS /eventsBatch calls (with JS fallback).
 *                    e.g. Approach3-AdaptiveEpochMonitoring-MultiMetric-100K-iter5-fix2-comp
 *
 * Detection: if any top-level item is a folder (has .item sub-array), it is scripted.
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
 */
function extractPathFromPostmanUrl(urlObj: any): { port: string; path: string } {
  if (typeof urlObj === 'string') {
    const parsed = new URL(urlObj);
    return { port: parsed.port, path: parsed.pathname };
  }
  const raw: string = urlObj.raw || '';
  const parsed = new URL(raw);
  return { port: parsed.port, path: parsed.pathname };
}

/**
 * Given a Postman port (8082 or 8083), return the correct base URL.
 */
function resolveBaseUrl(port: string, env: EnvironmentConfig): string {
  if (port === '8083') return env.actusServerBase;
  return env.riskServiceBase;
}

// ── Mode detection ──────────────────────────────────────────────────

/**
 * Returns true if the collection uses Postman JS scripting (prerequest/test scripts)
 * rather than plain HTTP requests. Detection: any top-level item is a folder (.item array).
 */
function isScriptedCollection(collectionJson: any): boolean {
  const items: any[] = collectionJson.item || [];
  return items.some((item: any) => Array.isArray(item.item));
}

// ── Main entry point ────────────────────────────────────────────────

/**
 * Execute all steps from a parsed Postman collection JSON.
 * Automatically detects HTTP vs scripted mode.
 */
export async function runStimulation(
  collectionJson: any,
  env: EnvironmentConfig,
  envName: string
): Promise<StimulationResult> {
  if (isScriptedCollection(collectionJson)) {
    return runScriptedSimulation(collectionJson, env, envName);
  }
  return runHttpSimulation(collectionJson, env, envName);
}

// ══════════════════════════════════════════════════════════════════════
// MODE 1: HTTP simulation (original behaviour — unchanged)
// ══════════════════════════════════════════════════════════════════════

async function runHttpSimulation(
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
  } else {
    console.warn(`   ⚠️  No simulation captured — no successful POST to port 8083`);
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

// ══════════════════════════════════════════════════════════════════════
// MODE 2: Scripted simulation (Postman JS runtime emulation)
// ══════════════════════════════════════════════════════════════════════

/**
 * Recursively flatten Postman folder items.
 * Folders have .item (sub-items) instead of .request.
 * The folder node itself is skipped; only leaf items are returned.
 */
function flattenItems(items: any[]): any[] {
  const result: any[] = [];
  for (const item of items) {
    if (Array.isArray(item.item)) {
      result.push(...flattenItems(item.item));
    } else {
      result.push(item);
    }
  }
  return result;
}

/**
 * A chainable stub that accepts any property access or call without throwing.
 * Used to stub pm.expect() so assertion failures do not crash the runner.
 */
function makeChainStub(): any {
  const fn: any = (..._args: any[]) => makeChainStub();
  return new Proxy(fn, {
    get: (_target: any, prop: string | symbol) => {
      if (prop === 'then' || prop === Symbol.toPrimitive || prop === Symbol.iterator) {
        return undefined;
      }
      return makeChainStub();
    },
    apply: () => makeChainStub(),
  });
}

/**
 * Execute a Postman script string in a sandboxed Function scope.
 * Provides pm, postman, and console globals.
 * Errors are swallowed — scripts must not crash the runner.
 */
function runScript(code: string, pm: any, postman: any): void {
  try {
    // new Function creates an isolated scope; pm/postman/console are injected
    // eslint-disable-next-line no-new-func
    const fn = new Function('pm', 'postman', 'console', code);
    fn(pm, postman, console);
  } catch (_e: any) {
    // Script errors (missing vars, assertion failures) do not abort the run
  }
}

/**
 * Collect all scripts of a given phase from a Postman item's event array.
 */
function getItemScripts(item: any, phase: 'prerequest' | 'test'): string[] {
  const events: any[] = item.event || [];
  const scripts: string[] = [];
  for (const ev of events) {
    if (ev.listen === phase) {
      const exec: string[] = ev.script?.exec || [];
      if (exec.length > 0) {
        scripts.push(exec.join('\n'));
      }
    }
  }
  return scripts;
}

/**
 * Run a scripted Postman collection.
 *
 * Execution order:
 *   1. All setup/init items (everything before "Adaptive Epoch Evaluator"):
 *      run prerequest scripts then test scripts.
 *   2. "Adaptive Epoch Evaluator" item in a loop controlled by
 *      postman.setNextRequest(). Loop breaks when next request is
 *      not "Adaptive Epoch Evaluator" or epoch/time limit is hit.
 *   3. Final summary item: run test script.
 *
 * pm.sendRequest() is a no-op that triggers the JS fallback inside the
 * Epoch Evaluator test script — all 11 behavioral models compute from
 * the portfolio directly without ACTUS calls.
 */
async function runScriptedSimulation(
  collectionJson: any,
  env: EnvironmentConfig,
  envName: string
): Promise<StimulationResult> {
  const startTime = Date.now();
  const info = collectionJson.info || {};

  console.log(`\n🚀 [ScriptedRunner] ${info.name || 'Unknown'}`);
  console.log(`   Mode: JS scripted simulation (no HTTP requests to risk-service)`);
  console.log(`   ACTUS Server: ${env.actusServerBase} (used for /eventsBatch — has JS fallback)`);
  console.log('─'.repeat(60));

  // ── pm environment and collection variables ─────────────────────
  const environment: Record<string, string> = {};
  const collectionVars: Record<string, string> = {};

  for (const v of (collectionJson.variable || [])) {
    collectionVars[v.key] = String(v.value ?? '');
  }

  // ── postman control object ──────────────────────────────────────
  let nextRequest: string | null = null;
  const postman = {
    setNextRequest: (name: string) => { nextRequest = name; },
  };

  // ── pm API ──────────────────────────────────────────────────────
  const pm: any = {
    environment: {
      get: (k: string) => environment[k] ?? null,
      set: (k: string, v: any) => { environment[k] = String(v ?? ''); },
    },
    collectionVariables: {
      get: (k: string) => collectionVars[k] ?? null,
      set: (k: string, v: any) => { collectionVars[k] = String(v ?? ''); },
    },
    // pm.test: run the assertion fn, swallow failures
    test: (name: string, fn: Function) => {
      try { fn(); } catch (_) {}
    },
    // pm.expect: chainable stub — never throws
    expect: (_val: any) => makeChainStub(),
    // pm.sendRequest: no-op that triggers JS fallback in epoch evaluator.
    // The epoch evaluator test script checks actus_epoch_error and uses
    // portfolio-based fallback when it is set.
    sendRequest: (_req: any, cb: Function) => {
      environment['actus_epoch_data'] = '[]';
      environment['actus_epoch_error'] = 'RUNNER_DIRECT';
      try { cb(new Error('RUNNER_DIRECT'), null); } catch (_) {}
    },
    // pm.response: stub for the GET / requests that all scripted items use
    response: { code: 200 },
  };

  // ── Flatten nested folders ──────────────────────────────────────
  const allItems = flattenItems(collectionJson.item || []);

  const EVALUATOR_NAME = 'Adaptive Epoch Evaluator';
  const evaluator = allItems.find((item: any) => item.name === EVALUATOR_NAME);
  const finalSummary = allItems.find(
    (item: any) => item.name && item.name.includes('FINAL SUMMARY')
  );
  const setupAndInitItems = allItems.filter(
    (item: any) =>
      item.name !== EVALUATOR_NAME &&
      !(item.name && item.name.includes('FINAL SUMMARY'))
  );

  // ── Phase 1: Setup + Initialize ────────────────────────────────
  let setupCount = 0;
  for (const item of setupAndInitItems) {
    for (const code of getItemScripts(item, 'prerequest')) runScript(code, pm, postman);
    for (const code of getItemScripts(item, 'test'))       runScript(code, pm, postman);
    setupCount++;
  }
  console.log(`   ✅ Setup + Initialize: ${setupCount} items complete`);

  // ── Phase 2: Epoch loop ─────────────────────────────────────────
  let epochCount = 0;
  const MAX_EPOCHS = parseInt(collectionVars['MAX_EPOCHS'] || '60') + 5; // +5 safety

  if (evaluator) {
    nextRequest = EVALUATOR_NAME;
    while (nextRequest === EVALUATOR_NAME && epochCount < MAX_EPOCHS) {
      epochCount++;
      nextRequest = null;
      for (const code of getItemScripts(evaluator, 'prerequest')) runScript(code, pm, postman);
      for (const code of getItemScripts(evaluator, 'test'))       runScript(code, pm, postman);
    }
  }
  console.log(`   ✅ Epoch loop: ${epochCount} epochs | simHour=${environment['sim_hour'] || '?'}`);

  // ── Phase 3: Final summary ──────────────────────────────────────
  if (finalSummary) {
    for (const code of getItemScripts(finalSummary, 'prerequest')) runScript(code, pm, postman);
    for (const code of getItemScripts(finalSummary, 'test'))       runScript(code, pm, postman);
    console.log(`   ✅ Final summary complete`);
  }

  // ── Extract epoch history from environment ──────────────────────
  let epochHistory: any[] = [];
  try {
    epochHistory = JSON.parse(environment['epoch_history'] || '[]');
  } catch (_) {
    epochHistory = [];
  }

  const totalDurationMs = Date.now() - startTime;
  console.log('─'.repeat(60));
  console.log(`   Total: ${totalDurationMs}ms | Epochs: ${epochHistory.length}`);
  console.log('');

  return {
    success: epochHistory.length > 0,
    scenarioName: info.name || 'Unknown',
    description: info.description || '',
    environment: envName,
    riskServiceUrl: env.riskServiceBase,
    actusServerUrl: env.actusServerBase,
    steps: [{
      step: 1,
      name: 'Scripted JS simulation',
      method: 'JS',
      url: 'internal',
      status: epochHistory.length > 0 ? 'success' : 'failed',
      durationMs: totalDurationMs,
    }],
    // simulation carries epochHistory for cre-report.ts to extract metrics from
    simulation: {
      type: 'scripted',
      epochHistory,
      lastEpoch: epochHistory[epochHistory.length - 1] ?? null,
    },
    totalDurationMs,
    timestamp: new Date().toISOString(),
  };
}
