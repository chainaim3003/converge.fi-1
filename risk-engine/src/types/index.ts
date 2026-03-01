/**
 * Converge.fi Risk Engine — TypeScript Interfaces
 *
 * Based on ACTUS simulation output structure (verified 63-event simulation)
 * and CRE report encoding format from CLAUDE.md section 6.3.
 */

// ─── ACTUS Event Types ───

/** ACTUS event types relevant to stablecoin simulations */
export type ACTUSEventType =
  | "IED"  // Initial Exchange Date — contract creation
  | "PP"   // Principal Prepayment — behavioral model redemptions
  | "IP"   // Interest Payment
  | "MD"   // Maturity Date — contract end
  | "MRD"  // Model Risk Data — behavioral model risk metric output
  | "AD"   // Analysis Date
  | "SC"   // Status Change
  | "RR";  // Rate Reset

/** Single ACTUS simulation event */
export interface ACTUSEvent {
  type: ACTUSEventType;
  time: string;           // ISO 8601 date string
  payoff: number;         // cash flow amount (negative = outflow)
  nominalValue: number;   // remaining principal after this event
  nominalRate: number;    // interest rate
  nominalAccrued: number; // accrued interest
  currency: string;
}

/** ACTUS contract terms (subset relevant to stablecoin sims) */
export interface ACTUSContractTerms {
  contractType: string;   // "PAM" for Principal at Maturity
  contractID: string;
  statusDate: string;
  contractRole: string;   // "RPA" = Real Position Asset
  notionalPrincipal: number;
  maturityDate: string;
  nominalInterestRate: number;
  currency: string;
}

/** Full simulation result from ACTUS /rf2/scenarioSimulation */
export interface ACTUSSimulationResult {
  status: string;
  contractId: string;
  contractType: string;
  events: ACTUSEvent[];
}

// ─── Postman Collection Types ───

/** Postman Collection v2.1.0 request item */
export interface PostmanRequestItem {
  name: string;
  request: {
    method: string;
    header: Array<{ key: string; value: string }>;
    body?: {
      mode: string;
      raw: string;  // CRITICAL: This is a STRING — must JSON.parse() before sending
    };
    url: {
      raw: string;
      host: string[];
      port: string;
      path: string[];
    };
  };
}

/** Postman Collection v2.1.0 format (how simulation JSONs are structured) */
export interface PostmanCollection {
  info: {
    name: string;
    description?: string;
    schema: string;
  };
  item: PostmanRequestItem[];
}

// ─── Simulation Metadata ───

/** Simulation file metadata (from /api/simulations listing) */
export interface SimulationInfo {
  id: string;
  name: string;
  filename: string;
  domain: string;       // "StableCoin", "HybridTreasury", "DeFi", etc.
  stepCount: number;
  description?: string;
}

/** Simulation run result from /api/run-simulation */
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

/** Individual step execution result */
export interface StepResult {
  stepIndex: number;
  name: string;
  method: string;
  url: string;
  status: number;
  success: boolean;
  responsePreview?: string;
}

// ─── CRE Report Types ───

/** CRE-formatted risk report (matches on-chain encoding in section 6.3) */
export interface CREReport {
  backingRatioBps: number;      // 10200 = 102.00%
  liquidityRatioBps: number;    // 1500  = 15.00%
  riskScore: number;            // 0-100
  maturityGapDays: number;      // days until next T-bill maturity covers need
  timestamp: number;            // unix timestamp
  scenarioId: string;           // scenario identifier
}

/** Extended CRE report with simulation metadata */
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

// ─── Computed Metrics (intermediate) ───

/** Metrics computed from ACTUS events before CRE formatting */
export interface ComputedMetrics {
  backingRatioBps: number;
  liquidityRatioBps: number;
  riskScore: number;
  maturityGapDays: number;

  // Detail fields for dashboard display
  totalReserves: number;
  totalSupply: number;
  cashReserves: number;
  redemptionTotal: number;
  peakDayRedemption: number;
  finalNominalValue: number;
  ppEventCount: number;
}

// ─── Reference Index Types (ACTUS risk data service) ───

export interface ReferenceIndex {
  marketObjectCode: string;
  data: Array<{
    timestamp: string;
    value: number;
  }>;
}

// ─── Portfolio Configuration ───

export interface PortfolioConfig {
  id: string;
  name: string;
  description: string;
  simulations: string[];  // simulation file IDs to include
}

// ─── Verification Types ───

/** StableCoin verification step result */
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
