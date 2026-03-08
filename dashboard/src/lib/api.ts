/**
 * API client for converge.fi risk-engine (port 3001).
 * V4: Uses /api/demo/health-check?phase=A|B|C — single endpoint drives entire UI.
 * No mocks, no hardcoding, no fallbacks.
 */

const BASE = "/api";

// ─── Demo Health Check (V4 primary endpoint) ───

export async function fetchDemoHealth(phase: string): Promise<DemoHealthResponse> {
  const res = await fetch(`${BASE}/demo/health-check?phase=${encodeURIComponent(phase)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Demo health check failed: ${res.status}`);
  }
  return res.json();
}

// ─── ACTUS Connectivity ───

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

// ─── Types (match risk-engine V4 response shapes exactly) ───

export interface DemoHealthResponse {
  phase: string;
  overrideActive: boolean;
  overrideDescription: string | null;
  actusServer: string;
  contractCount: number;
  totalACTUSEvents: number;
  health: HealthMetrics;
  forwardSimulation: ForwardContract[];
  thresholds: Thresholds;
  timestamp: string;
}

export interface HealthMetrics {
  tokenSupply: number;
  totalReserves: number;
  cashReserves: number;
  tbillReserves: number;
  ineligibleReserves: number;
  backingPct: number;
  liquidityPct: number;
  riskScore: number;
  wamDays: number;
  tbillPct: number;
  assetEligibilityPct: number;
  custodianDiversityScore: number;
  backingPass: boolean;
  liquidityPass: boolean;
  riskPass: boolean;
  eligibilityPass: boolean;
  healthy: boolean;
  mintGate: "OPEN" | "CLOSED";
  maturityLadder: MaturityEntry[];
}

export interface MaturityEntry {
  contractID: string;
  category: string;
  principal: number;
  maturityDate: string;
  daysToMaturity: number;
  availableNow: boolean;
  isGeniusEligible: boolean;
  custodian: string | null;
  actusEvents: number;
  actusStatus: string;
}

export interface ForwardContract {
  contractID: string;
  status: string;
  eventCount: number;
  ied: { time: string; payoff: number } | null;
  md: { time: string; payoff: number } | null;
}

export interface Thresholds {
  backingPct: number;
  liquidityPct: number;
  riskScore: number;
  assetEligibilityPct: number;
}

export interface HealthResponse {
  status: string;
  services: Record<string, { status: string; latencyMs: number }>;
  config: { actusRiskHost: string; actusSimHost: string };
  timestamp: string;
}
