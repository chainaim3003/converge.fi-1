/**
 * POST /api/verify         — Portfolio-based verification via StableCoinVerifier
 * GET  /api/thresholds/:j  — Jurisdiction threshold presets
 */

import { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { StableCoinVerifier } from "../verifier/StableCoinVerifier";
import type { VerificationParams, PortfolioConfig } from "../types";

const router = Router();
const DEFAULT_ACTUS_URL = "http://localhost:8083/eventsBatch";

/**
 * POST /api/verify — Runs portfolio-based StableCoin verification.
 *
 * Body: {
 *   portfolio: { id?, totalNotional?, description?, contracts: [...] },
 *   thresholds: { backingRatio, liquidityRatio, concentrationLimit, assetQuality },
 *   actusUrl?: string,
 *   jurisdiction?: string
 * }
 */
router.post("/verify", async (req: Request, res: Response) => {
  try {
    const { portfolio, thresholds, actusUrl } = req.body;

    if (!portfolio || !thresholds) {
      res.status(400).json({ success: false, error: "Missing required fields: portfolio, thresholds" });
      return;
    }

    const portfolioConfig: PortfolioConfig = {
      portfolioMetadata: {
        portfolioId: portfolio.id || "PORTFOLIO_001",
        totalNotional: portfolio.totalNotional || 0,
        currency: "USD",
        description: portfolio.description || "",
      },
      contracts: portfolio.contracts || [],
    };

    // Write portfolio to temp file for verifier
    const tempPath = path.join(os.tmpdir(), `verify-portfolio-${Date.now()}.json`);
    fs.writeFileSync(tempPath, JSON.stringify(portfolioConfig, null, 2));

    const params: VerificationParams = {
      backingRatioThreshold: thresholds.backingRatio || 100,
      liquidityRatioThreshold: thresholds.liquidityRatio || 20,
      concentrationLimit: thresholds.concentrationLimit || 40,
      qualityThreshold: thresholds.assetQuality || 80,
      actusUrl: actusUrl || DEFAULT_ACTUS_URL,
      portfolioPath: tempPath,
    };

    console.log(`\n🎯 Verification Request`);
    console.log(`Portfolio: ${portfolioConfig.portfolioMetadata.portfolioId}`);
    console.log(`Contracts: ${portfolioConfig.contracts.length}`);

    const verifier = new StableCoinVerifier();
    const result = await verifier.verify(params);

    // Clean up temp file
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }

    res.json({
      success: result.success,
      compliant: result.compliant,
      riskMetrics: result.riskMetrics,
      summary: result.summary,
      timestamp: result.timestamp,
      jurisdiction: req.body.jurisdiction || "custom",
    });
  } catch (error: any) {
    console.error("Verification error:", error);
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
});

/**
 * GET /api/thresholds/:jurisdiction — Preset thresholds by jurisdiction.
 */
router.get("/thresholds/:jurisdiction", (req: Request, res: Response) => {
  const jurisdiction = req.params.jurisdiction.toLowerCase();

  const presets: Record<string, any> = {
    "eu-mica": { backingRatio: 100, liquidityRatio: 30, concentrationLimit: 60, assetQuality: 85 },
    "us-genius": { backingRatio: 100, liquidityRatio: 20, concentrationLimit: 40, assetQuality: 80 },
    "custom": { backingRatio: 100, liquidityRatio: 20, concentrationLimit: 40, assetQuality: 80 },
  };

  res.json(presets[jurisdiction] || presets["custom"]);
});

export default router;
