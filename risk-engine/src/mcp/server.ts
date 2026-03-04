/**
 * MCP Server for Converge.fi risk-engine.
 *
 * Exposes risk-engine capabilities to Claude Desktop via Model Context Protocol.
 * Transport: stdio (standard input/output)
 *
 * Tools:
 *   - listSimulations: List available ACTUS simulation files
 *   - runSimulation: Execute a simulation and return events
 *   - describeSimulation: Get metadata and step listing for a simulation
 *   - getMetrics: Compute CRE report metrics from a simulation run
 */

import { listSimulationsTool } from "./tools/listSimulations";
import { runSimulationTool } from "./tools/runSimulation";
import { describeSimulationTool } from "./tools/describeSimulation";
import { getMetricsTool } from "./tools/getMetrics";

interface MCPRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: any;
  error?: { code: number; message: string };
}

const TOOLS = [
  {
    name: "listSimulations",
    description: "List all available ACTUS simulation files with metadata (domain, step count).",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "runSimulation",
    description:
      "Execute an ACTUS simulation by ID against the running Docker services. Returns event stream.",
    inputSchema: {
      type: "object",
      properties: {
        simulationId: {
          type: "string",
          description: "Simulation file ID (e.g. 'StableCoin-BackingRatio-RedemptionPressure-30d')",
        },
      },
      required: ["simulationId"],
    },
  },
  {
    name: "describeSimulation",
    description: "Get metadata and step listing for a simulation without executing it.",
    inputSchema: {
      type: "object",
      properties: {
        simulationId: { type: "string", description: "Simulation file ID" },
      },
      required: ["simulationId"],
    },
  },
  {
    name: "getMetrics",
    description:
      "Run a simulation and compute CRE report metrics (backingRatioBps, liquidityRatioBps, riskScore).",
    inputSchema: {
      type: "object",
      properties: {
        simulationId: { type: "string", description: "Simulation file ID" },
        scenarioId: {
          type: "string",
          description: "Scenario identifier (default: sc_depeg_stress_scn01)",
        },
      },
      required: ["simulationId"],
    },
  },
];

async function handleRequest(request: MCPRequest): Promise<MCPResponse> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: {
              name: "converge-fi-risk-engine",
              version: "1.0.0",
            },
            capabilities: { tools: {} },
          },
        };

      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: TOOLS } };

      case "tools/call":
        const toolName = params?.name;
        const args = params?.arguments || {};
        let result: any;

        switch (toolName) {
          case "listSimulations":
            result = listSimulationsTool();
            break;
          case "runSimulation":
            result = await runSimulationTool(args.simulationId);
            break;
          case "describeSimulation":
            result = describeSimulationTool(args.simulationId);
            break;
          case "getMetrics":
            result = await getMetricsTool(args.simulationId, args.scenarioId);
            break;
          default:
            return {
              jsonrpc: "2.0",
              id,
              error: { code: -32601, message: `Unknown tool: ${toolName}` },
            };
        }

        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
        };

      default:
        return {
          jsonrpc: "2.0",
          id,
          result: {},
        };
    }
  } catch (error: any) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: error.message },
    };
  }
}

// stdio transport — read JSON-RPC from stdin, write to stdout
async function main() {
  process.stderr.write("Converge.fi MCP Server starting (stdio transport)...\n");

  let buffer = "";

  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", async (chunk: string) => {
    buffer += chunk;

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const request = JSON.parse(line) as MCPRequest;
        const response = await handleRequest(request);
        process.stdout.write(JSON.stringify(response) + "\n");
      } catch (e: any) {
        process.stderr.write(`Parse error: ${e.message}\n`);
      }
    }
  });

  process.stdin.on("end", () => {
    process.stderr.write("MCP Server stdin closed.\n");
    process.exit(0);
  });
}

main().catch((e) => {
  process.stderr.write(`MCP Server error: ${e.message}\n`);
  process.exit(1);
});
