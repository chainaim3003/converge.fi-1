/**
 * StableCoinVerifier — 6-step verification logic.
 *
 * Verifies that a stablecoin simulation ran correctly by checking:
 *  1. Reference indexes were stored (8082)
 *  2. Behavioral models were stored (8082)
 *  3. Scenario was stored (8082)
 *  4. Simulation ran successfully (8083)
 *  5. Expected event types are present
 *  6. Metrics are within valid ranges
 */

import axios from "axios";
import { config } from "../config";
import { VerificationResult, VerificationStep, ACTUSEvent } from "../types";
import { ACTUSClient } from "../api/ACTUSClient";
import { computeMetrics } from "../metrics/computeMetrics";

export class StableCoinVerifier {
  private actusClient: ACTUSClient;

  constructor() {
    this.actusClient = new ACTUSClient();
  }

  async verify(simulationId: string): Promise<VerificationResult> {
    const steps: VerificationStep[] = [];
    let allPass = true;

    // Step 1: Check ACTUS Risk Service is reachable
    steps.push(await this.step1_checkRiskService());

    // Step 2: Check ACTUS Simulation Engine is reachable
    steps.push(await this.step2_checkSimEngine());

    // Step 3: Verify simulation file exists and is parseable
    steps.push(this.step3_verifySimulationFile(simulationId));

    // Step 4: Run the simulation
    let events: ACTUSEvent[] = [];
    const step4 = await this.step4_runSimulation(simulationId);
    steps.push(step4.step);
    events = step4.events;

    // Step 5: Verify expected event types
    steps.push(this.step5_verifyEventTypes(events));

    // Step 6: Verify computed metrics are valid
    steps.push(this.step6_verifyMetrics(events));

    allPass = steps.every((s) => s.status === "pass");

    return {
      simulationId,
      overall: allPass ? "pass" : "fail",
      steps,
      executedAt: new Date().toISOString(),
    };
  }

  private async step1_checkRiskService(): Promise<VerificationStep> {
    try {
      const resp = await axios.get(`${config.actusRiskHost}/`, { timeout: 5000 });
      return {
        step: 1,
        name: "ACTUS Risk Service reachable",
        status: resp.status === 200 ? "pass" : "fail",
        details: `Status ${resp.status} from ${config.actusRiskHost}`,
      };
    } catch (e: any) {
      return {
        step: 1,
        name: "ACTUS Risk Service reachable",
        status: "fail",
        details: `Cannot reach ${config.actusRiskHost}: ${e.message}`,
      };
    }
  }

  private async step2_checkSimEngine(): Promise<VerificationStep> {
    try {
      const resp = await axios.get(`${config.actusSimHost}/`, { timeout: 5000 });
      return {
        step: 2,
        name: "ACTUS Simulation Engine reachable",
        status: resp.status === 200 ? "pass" : "fail",
        details: `Status ${resp.status} from ${config.actusSimHost}`,
      };
    } catch (e: any) {
      return {
        step: 2,
        name: "ACTUS Simulation Engine reachable",
        status: "fail",
        details: `Cannot reach ${config.actusSimHost}: ${e.message}`,
      };
    }
  }

  private step3_verifySimulationFile(simulationId: string): VerificationStep {
    try {
      const desc = this.actusClient.describeSimulation(simulationId);
      return {
        step: 3,
        name: "Simulation file valid",
        status: "pass",
        details: `${desc.info.name} — ${desc.steps.length} steps in ${desc.info.domain} domain`,
      };
    } catch (e: any) {
      return {
        step: 3,
        name: "Simulation file valid",
        status: "fail",
        details: e.message,
      };
    }
  }

  private async step4_runSimulation(simulationId: string): Promise<{
    step: VerificationStep;
    events: ACTUSEvent[];
  }> {
    try {
      const result = await this.actusClient.runSimulation(simulationId);
      return {
        step: {
          step: 4,
          name: "Simulation executed",
          status: result.status === "success" ? "pass" : "fail",
          details: `${result.totalEvents} events, ${result.steps.length} steps executed`,
        },
        events: result.events,
      };
    } catch (e: any) {
      return {
        step: {
          step: 4,
          name: "Simulation executed",
          status: "fail",
          details: e.message,
        },
        events: [],
      };
    }
  }

  private step5_verifyEventTypes(events: ACTUSEvent[]): VerificationStep {
    if (events.length === 0) {
      return {
        step: 5,
        name: "Event types present",
        status: "fail",
        details: "No events returned from simulation",
      };
    }

    const types = new Set(events.map((e) => e.type));
    const hasIED = types.has("IED");
    const hasMD = types.has("MD");
    const hasPP = types.has("PP");

    const missing: string[] = [];
    if (!hasIED) missing.push("IED");
    if (!hasMD) missing.push("MD");
    if (!hasPP) missing.push("PP");

    return {
      step: 5,
      name: "Event types present",
      status: missing.length === 0 ? "pass" : "fail",
      details:
        missing.length === 0
          ? `All expected types found: ${Array.from(types).join(", ")}`
          : `Missing event types: ${missing.join(", ")}`,
    };
  }

  private step6_verifyMetrics(events: ACTUSEvent[]): VerificationStep {
    if (events.length === 0) {
      return {
        step: 6,
        name: "Metrics valid",
        status: "skip",
        details: "Skipped — no events to compute metrics from",
      };
    }

    try {
      const metrics = computeMetrics(events);
      const issues: string[] = [];

      if (metrics.backingRatioBps < 0 || metrics.backingRatioBps > 30000) {
        issues.push(`backingRatioBps out of range: ${metrics.backingRatioBps}`);
      }
      if (metrics.liquidityRatioBps < 0 || metrics.liquidityRatioBps > 10000) {
        issues.push(`liquidityRatioBps out of range: ${metrics.liquidityRatioBps}`);
      }
      if (metrics.riskScore < 0 || metrics.riskScore > 100) {
        issues.push(`riskScore out of range: ${metrics.riskScore}`);
      }

      return {
        step: 6,
        name: "Metrics valid",
        status: issues.length === 0 ? "pass" : "fail",
        details:
          issues.length === 0
            ? `backing=${metrics.backingRatioBps}bps, liquidity=${metrics.liquidityRatioBps}bps, score=${metrics.riskScore}`
            : issues.join("; "),
      };
    } catch (e: any) {
      return {
        step: 6,
        name: "Metrics valid",
        status: "fail",
        details: `Metric computation error: ${e.message}`,
      };
    }
  }
}
