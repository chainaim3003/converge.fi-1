/**
 * API client for converge.fi risk-engine (port 3001).
 * V4: Real endpoints — no mocks, no fallbacks.
 *
 * Existing: fetchDemoHealth, fetchHealth
 * New:      fetchChainStatus, fetchChainTransactions,
 *           adminBurn, adminMint, adminCRErun
 */

const BASE = "/api";

// ─── Helper ──────────────────────────────────────────────────────────────────

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(err.error || `${path} failed: ${res.status}`);
  }
  return res.json();
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(err.error || `${path} failed: ${res.status}`);
  }
  return res.json();
}

// ─── Demo Health Check (existing — unchanged) ─────────────────────────────────

export async function fetchDemoHealth(phase: string): Promise<DemoHealthResponse> {
  return get<DemoHealthResponse>(`/demo/health-check?phase=${encodeURIComponent(phase)}`);
}

// ─── ACTUS Connectivity (existing — unchanged) ────────────────────────────────

export async function fetchHealth(): Promise<HealthResponse> {
  return get<HealthResponse>("/health");
}

// ─── Chain Status ─────────────────────────────────────────────────────────────

export async function fetchChainStatus(): Promise<ChainStatusResponse> {
  return get<ChainStatusResponse>("/chain/status");
}

// ─── Chain Transactions ───────────────────────────────────────────────────────

export async function fetchChainTransactions(): Promise<ChainTxResponse> {
  return get<ChainTxResponse>("/chain/transactions");
}

// ─── Admin: Burn ──────────────────────────────────────────────────────────────

export async function adminBurn(): Promise<BurnResponse> {
  return post<BurnResponse>("/admin/burn", {});
}

// ─── Admin: Mint ──────────────────────────────────────────────────────────────

export async function adminMint(amount: number): Promise<MintResponse> {
  return post<MintResponse>("/admin/mint", { amount });
}

// ─── Admin: CRE Run ───────────────────────────────────────────────────────────

export async function adminCRErun(target: "demo-A" | "demo-B" | "demo-C"): Promise<CRERunResponse> {
  return post<CRERunResponse>("/admin/cre-run", { target });
}

// ═════════════════════════════════════════════════════════════════════════════
// TYPES
// ═════════════════════════════════════════════════════════════════════════════

// ─── Existing types (unchanged) ───────────────────────────────────────────────

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

// ─── New types ────────────────────────────────────────────────────────────────

export interface ChainStatusResponse {
  totalSupply: number;
  deployerBalance: number;
  mintAllowed: boolean;
  mintReason: string;
  onChainBacking: number;
  onChainLiquidity: number;
  onChainRiskScore: number;
  staleAge: number;
  linkBalance: number;
  blockNumber: number;
  stablecoinAddress: string;
  policyAddress: string;
  consumerAddress: string;
  deployerAddress: string;
  network: string;
  chainId: number;
}

export interface ChainTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  functionName: string;
  timeStamp: string;
  isError: string;
  gasUsed: string;
  confirmations: string;
}

export interface ChainTxResponse {
  transactions: ChainTx[];
  count: number;
}

export interface BurnResponse {
  success: boolean;
  txHash: string | null;
  burnedAmount: number;
  newSupply: number;
  message?: string;
  blockNumber?: number;
}

export interface MintResponse {
  success: boolean;
  // When mint succeeds:
  txHash?: string;
  mintedAmount?: number;
  newBalance?: number;
  newSupply?: number;
  blockNumber?: number;
  // When mint is blocked:
  blocked?: boolean;
  reason?: string;
  // When mint errors (non-blocked):
  error?: string;
}

export interface CRERunResponse {
  success: boolean;
  exitCode: number;
  output: string;
  target?: string;
  error?: string;
}
