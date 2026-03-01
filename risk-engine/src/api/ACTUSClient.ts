/**
 * ACTUSClient — Postman JSON parser + sequential HTTP executor.
 *
 * CRITICAL RULES (from CLAUDE.md section 7.5):
 *  - Steps MUST execute IN ORDER (each depends on previous MongoDB data)
 *  - Port 8082 (risk data) ≠ 8083 (simulation engine) — different services
 *  - Postman JSON body.raw is a STRING — must JSON.parse() before sending via code
 *  - ACTUS URLs from env vars ONLY — never hardcode
 */

import axios, { AxiosResponse } from "axios";
import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import {
  PostmanCollection,
  PostmanRequestItem,
  SimulationInfo,
  SimulationRunResult,
  StepResult,
  ACTUSEvent,
} from "../types";

export class ACTUSClient {
  private simulationsDir: string;

  constructor() {
    this.simulationsDir = config.simulationsDir;
  }

  /**
   * List all available simulation JSON files with metadata.
   */
  listSimulations(): SimulationInfo[] {
    if (!fs.existsSync(this.simulationsDir)) {
      return [];
    }

    const files = fs.readdirSync(this.simulationsDir).filter((f) => f.endsWith(".json"));
    return files.map((filename) => {
      const filePath = path.join(this.simulationsDir, filename);
      const content = JSON.parse(fs.readFileSync(filePath, "utf-8")) as PostmanCollection;
      const domain = this.inferDomain(filename);

      return {
        id: path.basename(filename, ".json"),
        name: content.info?.name || filename,
        filename,
        domain,
        stepCount: content.item?.length || 0,
        description: content.info?.description,
      };
    });
  }

  /**
   * Load and parse a simulation Postman JSON by ID.
   */
  loadSimulation(simulationId: string): PostmanCollection {
    const filePath = path.join(this.simulationsDir, `${simulationId}.json`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Simulation not found: ${simulationId}`);
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as PostmanCollection;
  }

  /**
   * Execute a simulation: run all steps IN ORDER against ACTUS Docker.
   * Returns the full result including events from the final simulation step.
   */
  async runSimulation(simulationId: string): Promise<SimulationRunResult> {
    const collection = this.loadSimulation(simulationId);
    const steps: StepResult[] = [];
    let events: ACTUSEvent[] = [];
    let contractId: string | undefined;
    let contractType: string | undefined;

    for (let i = 0; i < collection.item.length; i++) {
      const item = collection.item[i];
      const stepResult = await this.executeStep(item, i);
      steps.push(stepResult);

      if (!stepResult.success) {
        console.error(`Step ${i} (${item.name}) failed with status ${stepResult.status}`);
        // Continue executing — some GET steps may fail if data doesn't exist yet
        // but simulation step should still be attempted
      }

      // If this step returned simulation events, capture them
      if (stepResult.responsePreview) {
        try {
          const parsed = JSON.parse(stepResult.responsePreview);
          if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].events) {
            // Scenario simulation returns array of contract results
            events = parsed[0].events || [];
            contractId = parsed[0].contractId;
            contractType = parsed[0].contractType;
          } else if (parsed.events) {
            events = parsed.events;
            contractId = parsed.contractId;
            contractType = parsed.contractType;
          }
        } catch {
          // Not JSON or doesn't have events — skip
        }
      }
    }

    return {
      simulationId,
      simulationName: collection.info?.name || simulationId,
      status: steps.every((s) => s.success) ? "success" : "error",
      events,
      totalEvents: events.length,
      contractId,
      contractType,
      steps,
      executedAt: new Date().toISOString(),
    };
  }

  /**
   * Execute a single Postman request step against ACTUS Docker.
   */
  private async executeStep(item: PostmanRequestItem, index: number): Promise<StepResult> {
    const { method, url: urlObj, body } = item.request;
    const resolvedUrl = this.resolveUrl(urlObj);

    try {
      let response: AxiosResponse;

      if (method === "GET") {
        response = await axios.get(resolvedUrl, { timeout: 30000 });
      } else if (method === "POST") {
        // CRITICAL: Postman body.raw is a STRING — must JSON.parse() before sending
        let payload: any = {};
        if (body?.raw) {
          try {
            payload = JSON.parse(body.raw);
          } catch (e) {
            console.error(`Step ${index}: Failed to parse body.raw as JSON`, e);
            payload = body.raw;
          }
        }
        response = await axios.post(resolvedUrl, payload, {
          headers: { "Content-Type": "application/json" },
          timeout: 30000,
        });
      } else {
        throw new Error(`Unsupported HTTP method: ${method}`);
      }

      // Capture response for event extraction (limit size for non-sim steps)
      let responsePreview: string | undefined;
      if (response.data) {
        const dataStr = JSON.stringify(response.data);
        // Keep full response if it contains events, truncate otherwise
        if (dataStr.includes('"events"') || dataStr.length < 5000) {
          responsePreview = dataStr;
        } else {
          responsePreview = dataStr.substring(0, 2000) + "...(truncated)";
        }
      }

      return {
        stepIndex: index,
        name: item.name,
        method,
        url: resolvedUrl,
        status: response.status,
        success: response.status >= 200 && response.status < 300,
        responsePreview,
      };
    } catch (error: any) {
      return {
        stepIndex: index,
        name: item.name,
        method,
        url: resolvedUrl,
        status: error.response?.status || 0,
        success: false,
        responsePreview: error.message,
      };
    }
  }

  /**
   * Resolve a Postman URL object to a full URL string.
   * Replaces port-based routing: 8082 → actusRiskHost, 8083 → actusSimHost.
   */
  private resolveUrl(urlObj: PostmanRequestItem["request"]["url"]): string {
    const port = urlObj.port;
    const pathStr = "/" + (urlObj.path || []).join("/");

    // Route to correct ACTUS service based on port
    if (port === "8082") {
      return `${config.actusRiskHost}${pathStr}`;
    } else if (port === "8083") {
      return `${config.actusSimHost}${pathStr}`;
    }

    // Fallback: reconstruct from raw URL, replacing localhost with env hosts
    let raw = urlObj.raw;
    raw = raw.replace(/http:\/\/localhost:8082/g, config.actusRiskHost);
    raw = raw.replace(/http:\/\/localhost:8083/g, config.actusSimHost);
    return raw;
  }

  /**
   * Infer domain from filename pattern.
   */
  private inferDomain(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.includes("stablecoin") || lower.includes("stable")) return "StableCoin";
    if (lower.includes("hybrid") || lower.includes("treasury")) return "HybridTreasury";
    if (lower.includes("defi") || lower.includes("liquidation")) return "DeFi";
    if (lower.includes("supply") || lower.includes("tariff")) return "SupplyChain";
    if (lower.includes("dynamic") || lower.includes("discount")) return "DynamicDiscounting";
    return "Other";
  }

  /**
   * Describe a simulation — returns metadata and step listing without executing.
   */
  describeSimulation(simulationId: string): {
    info: SimulationInfo;
    steps: Array<{ index: number; name: string; method: string; port: string }>;
  } {
    const collection = this.loadSimulation(simulationId);
    const info = this.listSimulations().find((s) => s.id === simulationId);

    const steps = collection.item.map((item, i) => ({
      index: i,
      name: item.name,
      method: item.request.method,
      port: item.request.url.port || "unknown",
    }));

    return {
      info: info || {
        id: simulationId,
        name: collection.info?.name || simulationId,
        filename: `${simulationId}.json`,
        domain: "Unknown",
        stepCount: steps.length,
      },
      steps,
    };
  }
}
