/**
 * Converge.fi Risk Engine — Merged TypeScript Interfaces
 *
 * Combines:
 *   - CRE report types (on-chain encoding format from CLAUDE.md section 6.3)
 *   - ACTUS simulation event types (verified 63-event simulation)
 *   - Portfolio verification types (Backend StableRisk)
 *   - Postman collection types (simulation file format)
 *   - v2 extended metrics: concentrationHHI, assetQualityScore
 */

// ═══════════════════════════════════════════════════════════════
// ACTUS EVENT TYPES (used by computeMetrics.ts, MCP tools, CRE report)
// ═══════════════════════════════════════════════════════════════

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

/** Single ACTUS simulation event (from scenarioSimulation response) */
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

// ═══════════════════════════════════════════════════════════════
// CONTRACT GROUP (multi-contract simulation support)
// Used by cre-report.ts → computeMetrics for concentrationHHI / assetQualityScore
// ═══════════════════════════════════════════════════════════════

/**
 * A single contract's events from a multi-contract ACTUS simulation response.
 * ACTUS /rf2/scenarioSimulation returns [{contractId, contractType, events}]
 */
export interface ContractGroup {
  contractId: string;
  contractType: string;
  events: ACTUSEvent[];
}

// ═══════════════════════════════════════════════════════════════
// ACTUS CONTRACT TYPES (used by ACTUSClient.ts, metrics.ts, verifier)
// ═══════════════════════════════════════════════════════════════

/** ACTUS contract for portfolio-based verification (eventsBatch API) */
export interface ACTUSContract {
  contractType: string;
  contractID: string;
  contractRole: string;   // 'RPA' for assets, 'RPL' for liabilities
  contractDealDate?: string;
  initialExchangeDate?: string;
  statusDate: string;
  notionalPrincipal: string;
  currency: string;

  // StableCoin-specific attributes
  reserveType?: 'cash' | 'treasury' | 'corporate' | 'other';
  liquidityScore?: number;
  creditRating?: number;
  maturityDays?: number;

  [key: string]: any;
}

export interface ACTUSRequestData {
  contracts: ACTUSContract[];
  riskFactors: any[];
}

export interface ACTUSResponse {
  inflow: number[][];
  outflow: number[][];
  periodsCount: number;
  contractDetails: any[];
  riskMetrics?: any;
  metadata?: {
    timeHorizon?: string;
    currency?: string;
    processingDate?: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// POSTMAN COLLECTION TYPES (simulation file format)
// ═══════════════════════════════════════════════════════════════

/** Postman Collection v2.1.0 request item */
export interface PostmanRequestItem {
  name: string;
  request: {
    method: string;
    header: Array<{ key: string; value: string }>;
    body?: {
      mode: string;
      raw: string;
    };
    url: {
      raw: string;
      host: string[];
      port: string;
      path: string[];
    };
  };
}

/** Postman Collection v2.1.0 format */
export interface PostmanCollection {
  info: {
    name: string;
    description?: string;
    schema: string;
  };
  item: PostmanRequestItem[];
}

// ═══════════════════════════════════════════════════════════════
// SIMULATION METADATA (used by MCP tools, routes)
// ═══════════════════════════════════════════════════════════════

/** Simulation file metadata */
export interface SimulationInfo {
  id: string;
  name: string;
  filename: string;
  domain: string;
  stepCount: number;
  description?: string;
}

/** Individual step execution result (Postman-based simulation) */
export interface SimulationStepResult {
  stepIndex: number;
  name: string;
  method: string;
  url: string;
  status: number;
  success: boolean;
  responsePreview?: string;
}

/** Simulation run result */
export interface SimulationRunResult {
  simulationId: string;
  simulationName: string;
  status: "success" | "error";
  events: ACTUSEvent[];
  totalEvents: number;
  contractId?: string;
  contractType?: string;
  steps: SimulationStepResult[];
  executedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// CRE REPORT TYPES (on-chain encoding for Solidity contracts)
// ═══════════════════════════════════════════════════════════════

/**
 * CRE-formatted risk report — v2 layout.
 *
 * v1 encoded 6 fields (backingRatioBps, liquidityRatioBps, riskScore, maturityGapDays, timestamp, scenarioId).
 * v2 adds concentrationHHI and assetQualityScore (8 fields total, 256 bytes ABI-encoded).
 *
 * On-chain decode order in RiskMetricsConsumer.sol:
 *   abi.decode(data, (uint16, uint16, uint8, uint8, uint40, bytes32, uint16, uint8))
 */
export interface CREReport {
  backingRatioBps: number;      // 10200 = 102.00%
  liquidityRatioBps: number;    // 1500  = 15.00%
  riskScore: number;            // 0-100
  maturityGapDays: number;      // days until next T-bill maturity
  timestamp: number;            // unix timestamp
  scenarioId: string;           // scenario identifier
  concentrationHHI: number;     // 0-10000 (HHI * 10000, 10000 = fully concentrated)
  assetQualityScore: number;    // 0-100 (100 = highest quality reserves)
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
    contractCount: number;     // v2: number of contracts in simulation
  };
  computedAt: string;
}

/** Metrics computed from ACTUS events before CRE formatting */
export interface ComputedMetrics {
  backingRatioBps: number;
  liquidityRatioBps: number;
  riskScore: number;
  maturityGapDays: number;
  concentrationHHI: number;     // v2: Herfindahl-Hirschman Index (0-10000)
  assetQualityScore: number;    // v2: weighted reserve quality score (0-100)

  totalReserves: number;
  totalSupply: number;
  cashReserves: number;
  redemptionTotal: number;
  peakDayRedemption: number;
  finalNominalValue: number;
  ppEventCount: number;
}

// ═══════════════════════════════════════════════════════════════
// CHAT TYPES (AI Risk Chat endpoint)
// ═══════════════════════════════════════════════════════════════

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  message: string;
  history?: ChatMessage[];
  context?: Partial<CREReport>;
}

export interface ChatResponse {
  response: string;
  model: string;
}

// ═══════════════════════════════════════════════════════════════
// PORTFOLIO CONFIGURATION (used by verifier, server, ACTUSClient)
// ═══════════════════════════════════════════════════════════════

export interface PortfolioMetadata {
  portfolioId: string;
  totalNotional: number;
  currency: string;
  description?: string;
}

export interface PortfolioConfig {
  portfolioMetadata: PortfolioMetadata;
  contracts: ACTUSContract[];
}

// ═══════════════════════════════════════════════════════════════
// VERIFICATION TYPES (portfolio-based compliance verification)
// ═══════════════════════════════════════════════════════════════

export interface VerificationParams {
  backingRatioThreshold: number;
  liquidityRatioThreshold: number;
  concentrationLimit: number;
  qualityThreshold: number;
  actusUrl: string;
  portfolioPath: string;
}

export interface ReserveComponents {
  cashReserves: number[];
  treasuryReserves: number[];
  corporateReserves: number[];
  otherReserves: number[];
  totalReserves: number[];
}

export interface QualityMetrics {
  liquidityScores: number[];
  creditRatings: number[];
  maturityProfiles: number[];
  assetQualityScore: number;
}

export interface RiskMetrics {
  backingRatios: number[];
  liquidityRatios: number[];
  concentrationRisks: number[];
  assetQualityScores: number[];

  averageBackingRatio: number;
  averageLiquidityRatio: number;
  maxConcentrationRisk: number;
  averageAssetQuality: number;

  backingCompliant: boolean;
  liquidityCompliant: boolean;
  concentrationCompliant: boolean;
  qualityCompliant: boolean;
  overallCompliant: boolean;
}

export interface StableCoinRiskData {
  companyID: string;
  companyName: string;
  cashInflow: number[];
  cashOutflow: number[];
  periodsCount: number;
  reserveComponents: ReserveComponents;
  outstandingTokens: number[];
  tokenValue: number;
  qualityMetrics: QualityMetrics;
  backingRatioThreshold: number;
  liquidityRatioThreshold: number;
  concentrationLimit: number;
  qualityThreshold: number;
}

export interface VerificationResult {
  success: boolean;
  compliant: boolean;
  riskMetrics: RiskMetrics;
  summary: VerificationSummary;
  timestamp: string;
}

export interface VerificationSummary {
  portfolioId: string;
  periodsAnalyzed: number;

  backing: {
    average: number;
    threshold: number;
    status: 'PASS' | 'FAIL';
  };

  liquidity: {
    average: number;
    threshold: number;
    status: 'PASS' | 'FAIL';
  };

  concentration: {
    maximum: number;
    limit: number;
    status: 'PASS' | 'FAIL';
  };

  quality: {
    score: number;
    threshold: number;
    status: 'PASS' | 'FAIL';
  };

  overallStatus: 'COMPLIANT' | 'NON-COMPLIANT';
  failureReasons: string[];
}

// ═══════════════════════════════════════════════════════════════
// REFERENCE INDEX TYPES
// ═══════════════════════════════════════════════════════════════

export interface ReferenceIndex {
  marketObjectCode: string;
  data: Array<{
    timestamp: string;
    value: number;
  }>;
}
