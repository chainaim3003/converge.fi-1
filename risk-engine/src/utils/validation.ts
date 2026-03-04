/**
 * Validation Utilities — merged from risk-engine + Backend
 *
 * Contains:
 *   - Input validation: isValidSimulationId, isValidCREReportRequest, isValidVerifyRequest
 *   - Data validation: validateStableCoinData
 *   - Summary generation: generateSummary, displaySummary
 */

import type { StableCoinRiskData, RiskMetrics, VerificationSummary } from '../types/index.js';

// ═══════════════════════════════════════════════════════════════
// INPUT VALIDATION (used by routes: cre-report, simulate, verify)
// ═══════════════════════════════════════════════════════════════

/**
 * Validate that a simulation ID is safe (no path traversal, valid characters).
 */
export function isValidSimulationId(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  if (id.length > 200) return false;
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

// ═══════════════════════════════════════════════════════════════
// DATA VALIDATION (used by StableCoinVerifier.ts)
// ═══════════════════════════════════════════════════════════════

/**
 * Validate StableCoin risk data integrity
 */
export function validateStableCoinData(data: StableCoinRiskData): void {
  console.log('\n🔍 Validating data integrity...');

  if (data.periodsCount <= 0) {
    throw new Error('Periods count must be positive');
  }

  if (data.cashInflow.length !== data.periodsCount) {
    throw new Error(`Cash inflow length (${data.cashInflow.length}) does not match periods count (${data.periodsCount})`);
  }

  if (data.cashOutflow.length !== data.periodsCount) {
    throw new Error(`Cash outflow length (${data.cashOutflow.length}) does not match periods count (${data.periodsCount})`);
  }

  if (data.backingRatioThreshold <= 0) {
    throw new Error('Backing ratio threshold must be positive');
  }

  if (data.liquidityRatioThreshold < 0) {
    throw new Error('Liquidity ratio threshold cannot be negative');
  }

  if (data.concentrationLimit <= 0 || data.concentrationLimit > 100) {
    throw new Error('Concentration limit must be between 0 and 100');
  }

  if (data.qualityThreshold < 0 || data.qualityThreshold > 100) {
    throw new Error('Quality threshold must be between 0 and 100');
  }

  if (data.qualityMetrics.liquidityScores.length !== 4) {
    throw new Error('Liquidity scores must have exactly 4 elements (cash, treasury, corporate, other)');
  }

  if (data.qualityMetrics.creditRatings.length !== 4) {
    throw new Error('Credit ratings must have exactly 4 elements (cash, treasury, corporate, other)');
  }

  if (data.qualityMetrics.maturityProfiles.length !== 4) {
    throw new Error('Maturity profiles must have exactly 4 elements (cash, treasury, corporate, other)');
  }

  console.log('✅ Data validation passed');
}

// ═══════════════════════════════════════════════════════════════
// SUMMARY GENERATION (used by StableCoinVerifier.ts)
// ═══════════════════════════════════════════════════════════════

/**
 * Generate verification summary from risk metrics
 */
export function generateSummary(
  portfolioId: string,
  riskMetrics: RiskMetrics,
  data: StableCoinRiskData
): VerificationSummary {
  const failureReasons: string[] = [];

  const backingStatus: 'PASS' | 'FAIL' = riskMetrics.backingCompliant ? 'PASS' : 'FAIL';
  if (!riskMetrics.backingCompliant) {
    failureReasons.push(
      `Backing ratio (${riskMetrics.averageBackingRatio.toFixed(2)}%) below threshold (${data.backingRatioThreshold}%)`
    );
  }

  const liquidityStatus: 'PASS' | 'FAIL' = riskMetrics.liquidityCompliant ? 'PASS' : 'FAIL';
  if (!riskMetrics.liquidityCompliant) {
    failureReasons.push(
      `Liquidity ratio (${riskMetrics.averageLiquidityRatio.toFixed(2)}%) below threshold (${data.liquidityRatioThreshold}%)`
    );
  }

  const concentrationStatus: 'PASS' | 'FAIL' = riskMetrics.concentrationCompliant ? 'PASS' : 'FAIL';
  if (!riskMetrics.concentrationCompliant) {
    failureReasons.push(
      `Concentration risk (${riskMetrics.maxConcentrationRisk.toFixed(2)}%) exceeds limit (${data.concentrationLimit}%)`
    );
  }

  const qualityStatus: 'PASS' | 'FAIL' = riskMetrics.qualityCompliant ? 'PASS' : 'FAIL';
  if (!riskMetrics.qualityCompliant) {
    failureReasons.push(
      `Asset quality score (${riskMetrics.averageAssetQuality.toFixed(2)}) below threshold (${data.qualityThreshold})`
    );
  }

  const overallStatus: 'COMPLIANT' | 'NON-COMPLIANT' = riskMetrics.overallCompliant
    ? 'COMPLIANT'
    : 'NON-COMPLIANT';

  return {
    portfolioId,
    periodsAnalyzed: data.periodsCount,
    backing: { average: riskMetrics.averageBackingRatio, threshold: data.backingRatioThreshold, status: backingStatus },
    liquidity: { average: riskMetrics.averageLiquidityRatio, threshold: data.liquidityRatioThreshold, status: liquidityStatus },
    concentration: { maximum: riskMetrics.maxConcentrationRisk, limit: data.concentrationLimit, status: concentrationStatus },
    quality: { score: riskMetrics.averageAssetQuality, threshold: data.qualityThreshold, status: qualityStatus },
    overallStatus,
    failureReasons
  };
}

/**
 * Display verification summary in formatted output
 */
export function displaySummary(summary: VerificationSummary): void {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 VERIFICATION SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`Portfolio ID: ${summary.portfolioId}`);
  console.log(`Periods Analyzed: ${summary.periodsAnalyzed}\n`);

  const backingIcon = summary.backing.status === 'PASS' ? '✅' : '❌';
  console.log(`${backingIcon} Backing Ratio: ${summary.backing.average.toFixed(2)}% (threshold: ${summary.backing.threshold}%) — ${summary.backing.status}\n`);

  const liquidityIcon = summary.liquidity.status === 'PASS' ? '✅' : '❌';
  console.log(`${liquidityIcon} Liquidity Ratio: ${summary.liquidity.average.toFixed(2)}% (threshold: ${summary.liquidity.threshold}%) — ${summary.liquidity.status}\n`);

  const concentrationIcon = summary.concentration.status === 'PASS' ? '✅' : '❌';
  console.log(`${concentrationIcon} Concentration Risk: ${summary.concentration.maximum.toFixed(2)}% (limit: ${summary.concentration.limit}%) — ${summary.concentration.status}\n`);

  const qualityIcon = summary.quality.status === 'PASS' ? '✅' : '❌';
  console.log(`${qualityIcon} Asset Quality: ${summary.quality.score.toFixed(2)} (threshold: ${summary.quality.threshold}) — ${summary.quality.status}\n`);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const overallIcon = summary.overallStatus === 'COMPLIANT' ? '🎉' : '⚠️';
  console.log(`${overallIcon} OVERALL STATUS: ${summary.overallStatus}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (summary.failureReasons.length > 0) {
    console.log('❌ Failure Reasons:');
    summary.failureReasons.forEach(reason => {
      console.log(`   • ${reason}`);
    });
    console.log('');
  }
}
