/**
 * API client for risk-engine (port 3001).
 *
 * In dev mode, Vite proxies /api → http://localhost:3001 (see vite.config.ts).
 * All endpoints match risk-engine routes from CLAUDE.md section 7.2.
 */

const BASE = "/api";

/** GET /api/health — Pings ACTUS 8082/8083 */
export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

/** GET /api/simulations — Lists available simulation JSONs */
export async function fetchSimulations(): Promise<SimulationsResponse> {
  const res = await fetch(`${BASE}/simulations`);
  if (!res.ok) throw new Error(`Failed to list simulations: ${res.status}`);
  return res.json();
}

/** GET /api/simulations/:id — Describe a specific simulation */
export async function fetchSimulationDetail(id: string): Promise<SimulationDetail> {
  const res = await fetch(`${BASE}/simulations/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Simulation not found: ${id}`);
  return res.json();
}

/** POST /api/run-simulation — Runs simulation → returns event stream */
export async function runSimulation(simulationId: string): Promise<SimulationRunResult> {
  const res = await fetch(`${BASE}/run-simulation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ simulationId }),
  });
  if (!res.ok) throw new Error(`Simulation failed: ${res.status}`);
  return res.json();
}

/** POST /api/v1/cre-report — Runs + computes CRE-formatted metrics */
export async function fetchCREReport(
  simulationId?: string,
  scenarioId?: string
): Promise<CREReportResponse> {
  const res = await fetch(`${BASE}/v1/cre-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      simulationId: simulationId || "StableCoin-BackingRatio-RedemptionPressure-30d",
      scenarioId: scenarioId || "sc_depeg_stress_scn01",
    }),
  });
  if (!res.ok) throw new Error(`CRE report failed: ${res.status}`);
  return res.json();
}

/** POST /api/verify — StableCoin verification (6-step) */
export async function verifySimulation(simulationId: string): Promise<VerificationResult> {
  const res = await fetch(`${BASE}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ simulationId }),
  });
  if (!res.ok) throw new Error(`Verification failed: ${res.status}`);
  return res.json();
}

/** GET /api/scenarios — Lists scenarios */
export async function fetchScenarios(): Promise<ScenariosResponse> {
  const res = await fetch(`${BASE}/scenarios`);
  if (!res.ok) throw new Error(`Failed to list scenarios: ${res.status}`);
  return res.json();
}

// ─── Types (match risk-engine/src/types/index.ts) ───

export interface HealthResponse {
  status: string;
  services: Record<string, { status: string; latencyMs: number }>;
  config: { actusRiskHost: string; actusSimHost: string };
  timestamp: string;
}

export interface SimulationInfo {
  id: string;
  name: string;
  filename: string;
  domain: string;
  stepCount: number;
  description?: string;
}

export interface SimulationsResponse {
  count: number;
  simulations: SimulationInfo[];
}

export interface SimulationDetail {
  info: SimulationInfo;
  steps: Array<{ index: number; name: string; method: string; port: string }>;
}

export interface ACTUSEvent {
  type: string;
  time: string;
  payoff: number;
  nominalValue: number;
  nominalRate: number;
  nominalAccrued: number;
  currency: string;
}

export interface StepResult {
  stepIndex: number;
  name: string;
  method: string;
  url: string;
  status: number;
  success: boolean;
  responsePreview?: string;
}

export interface SimulationRunResult {
  simulationId: string;
  simulationName: string;
  status: "success" | "error";
  events: ACTUSEvent[];
  totalEvents: number;
  contractId?: string;
  contractType?: string;
  steps: StepResult[];
  executedAt: string;
}

export interface CREReport {
  backingRatioBps: number;
  liquidityRatioBps: number;
  riskScore: number;
  maturityGapDays: number;
  timestamp: number;
  scenarioId: string;
}

export interface CREReportResponse {
  report: CREReport;
  simulation: {
    id: string;
    name: string;
    totalEvents: number;
    ppEvents: number;
    peakRedemption: number;
    finalNominalValue: number;
  };
  computedAt: string;
}

export interface VerificationStep {
  step: number;
  name: string;
  status: "pass" | "fail" | "skip";
  details: string;
}

export interface VerificationResult {
  simulationId: string;
  overall: "pass" | "fail";
  steps: VerificationStep[];
  executedAt: string;
}

export interface ScenariosResponse {
  count: number;
  byDomain: Record<string, Array<{ id: string; name: string; domain: string; stepCount: number }>>;
  scenarios: Array<{ id: string; name: string; domain: string; stepCount: number }>;
}
