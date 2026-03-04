/**
 * StableCoin Verifier - Main Verification Logic
 * Simplified verification without ZK programs or network implementation
 */

import { ACTUSClient } from '../api/ACTUSClient.js';
import { processStableCoinData, calculateRiskMetrics } from '../utils/metrics.js';
import { validateStableCoinData, generateSummary } from '../utils/validation.js';
import type { VerificationParams, VerificationResult } from '../types/index.js';

export class StableCoinVerifier {
  /**
   * Execute StableCoin risk verification
   */
  async verify(params: VerificationParams): Promise<VerificationResult> {
    console.log('🎯 StableCoin Risk Verification');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    try {
      // Display configuration
      this.displayConfiguration(params);

      // Step 1: Load portfolio
      console.log('\n📁 Loading portfolio...');
      const contracts = await ACTUSClient.loadPortfolio(params.portfolioPath);
      
      if (contracts.length === 0) {
        throw new Error('Portfolio contains no contracts');
      }

      // Display contract breakdown
      this.displayContractBreakdown(contracts);

      // Step 2: Fetch ACTUS data
      console.log('\n🌐 Fetching ACTUS data...');
      const actusClient = new ACTUSClient(params.actusUrl);
      const actusResponse = await actusClient.fetchCashFlowData(contracts);

      // Step 3: Process StableCoin data
      const stableCoinData = processStableCoinData(
        actusResponse,
        contracts,
        params.backingRatioThreshold,
        params.liquidityRatioThreshold,
        params.concentrationLimit,
        params.qualityThreshold
      );

      // Step 4: Validate data integrity
      validateStableCoinData(stableCoinData);

      // Step 5: Calculate risk metrics
      const riskMetrics = calculateRiskMetrics(stableCoinData);

      // Step 6: Generate summary
      const summary = generateSummary(
        'STABLECOIN_PORTFOLIO',
        riskMetrics,
        stableCoinData
      );

      // Create verification result
      const result: VerificationResult = {
        success: true,
        compliant: riskMetrics.overallCompliant,
        riskMetrics,
        summary,
        timestamp: new Date().toISOString()
      };

      return result;

    } catch (error: any) {
      console.error('\n❌ Verification failed:', error.message);
      throw error;
    }
  }

  /**
   * Display verification configuration
   */
  private displayConfiguration(params: VerificationParams): void {
    console.log('📊 Configuration:');
    console.log(`   Backing Ratio Threshold: ${params.backingRatioThreshold}%`);
    console.log(`   Liquidity Ratio Threshold: ${params.liquidityRatioThreshold}%`);
    console.log(`   Concentration Limit: ${params.concentrationLimit}%`);
    console.log(`   Quality Threshold: ${params.qualityThreshold}`);
    console.log(`   ACTUS URL: ${params.actusUrl}`);
    console.log(`   Portfolio Path: ${params.portfolioPath}`);
  }

  /**
   * Display contract breakdown by type
   */
  private displayContractBreakdown(contracts: any[]): void {
    const assets = contracts.filter(c => c.contractRole === 'RPA');
    const liabilities = contracts.filter(c => c.contractRole === 'RPL');

    console.log('\n📋 Contract Breakdown:');
    console.log(`   Total Contracts: ${contracts.length}`);
    console.log(`   Assets (RPA): ${assets.length}`);
    console.log(`   Liabilities (RPL): ${liabilities.length}`);

    // Breakdown by reserve type for assets
    if (assets.length > 0) {
      const cash = assets.filter(c => c.reserveType === 'cash').length;
      const treasury = assets.filter(c => c.reserveType === 'treasury').length;
      const corporate = assets.filter(c => c.reserveType === 'corporate').length;
      const other = assets.filter(c => !c.reserveType || c.reserveType === 'other').length;

      console.log('\n   Asset Breakdown by Type:');
      console.log(`     Cash: ${cash}`);
      console.log(`     Treasury: ${treasury}`);
      console.log(`     Corporate: ${corporate}`);
      console.log(`     Other: ${other}`);
    }
  }
}
