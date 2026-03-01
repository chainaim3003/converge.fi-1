/**
 * risk-engine simulation test — verifies ACTUSClient, metrics computation,
 * and CRE report formatting work correctly with mock data.
 *
 * NOTE: These tests use mock event data. Integration tests against
 * live ACTUS Docker require the containers to be running.
 */

import { computeMetrics, formatCREReport } from "../src/metrics/computeMetrics";
import { processEvents, computeDailySummaries, extractTrajectoryPoints } from "../src/utils/ACTUSDataProcessor";
import { ACTUSEvent } from "../src/types";

// Mock event data based on verified simulation output (CLAUDE.md section 5.3)
const mockEvents: ACTUSEvent[] = [
  // IED — contract initialization
  {
    type: "IED",
    time: "2026-03-01T00:00:00",
    payoff: 0,
    nominalValue: 100000000,
    nominalRate: 0,
    nominalAccrued: 0,
    currency: "USD",
  },
  // PP events — Days 1-6: zero redemptions
  ...Array.from({ length: 6 }, (_, i) => ({
    type: "PP" as const,
    time: `2026-03-0${i + 1}T12:00:00`,
    payoff: 0,
    nominalValue: 100000000,
    nominalRate: 0,
    nominalAccrued: 0,
    currency: "USD",
  })),
  // Day 7: BackingRatio triggers — $500K redeemed
  {
    type: "PP",
    time: "2026-03-07T12:00:00",
    payoff: -500000,
    nominalValue: 99500000,
    nominalRate: 0,
    nominalAccrued: 0,
    currency: "USD",
  },
  // Day 8: $500K redeemed
  {
    type: "PP",
    time: "2026-03-08T12:00:00",
    payoff: -500000,
    nominalValue: 99000000,
    nominalRate: 0,
    nominalAccrued: 0,
    currency: "USD",
  },
  // Day 9: RedemptionPressure triggers — $2.25M redeemed
  {
    type: "PP",
    time: "2026-03-09T12:00:00",
    payoff: -2250000,
    nominalValue: 96750000,
    nominalRate: 0,
    nominalAccrued: 0,
    currency: "USD",
  },
  // Day 10: Both models compound — $13.25M redeemed
  {
    type: "PP",
    time: "2026-03-10T12:00:00",
    payoff: -13250000,
    nominalValue: 83500000,
    nominalRate: 0,
    nominalAccrued: 0,
    currency: "USD",
  },
  // Day 15: peak stress — $10.7M redeemed
  {
    type: "PP",
    time: "2026-03-15T12:00:00",
    payoff: -10700000,
    nominalValue: 27000000,
    nominalRate: 0,
    nominalAccrued: 0,
    currency: "USD",
  },
  // Day 31: MD event — final principal
  {
    type: "MD",
    time: "2026-03-31T00:00:00",
    payoff: 0,
    nominalValue: 8738241.41,
    nominalRate: 0,
    nominalAccrued: 0,
    currency: "USD",
  },
];

describe("computeMetrics", () => {
  it("should compute valid metrics from mock events", () => {
    const metrics = computeMetrics(mockEvents);

    expect(metrics.backingRatioBps).toBeGreaterThanOrEqual(0);
    expect(metrics.backingRatioBps).toBeLessThanOrEqual(30000);
    expect(metrics.liquidityRatioBps).toBeGreaterThanOrEqual(0);
    expect(metrics.liquidityRatioBps).toBeLessThanOrEqual(10000);
    expect(metrics.riskScore).toBeGreaterThanOrEqual(0);
    expect(metrics.riskScore).toBeLessThanOrEqual(100);
    expect(metrics.ppEventCount).toBeGreaterThan(0);
    expect(metrics.redemptionTotal).toBeGreaterThan(0);
  });

  it("should detect redemption events", () => {
    const metrics = computeMetrics(mockEvents);
    // We have PP events with non-zero payoffs starting at Day 7
    expect(metrics.ppEventCount).toBe(5); // 5 PP events with non-zero payoff
    expect(metrics.redemptionTotal).toBe(500000 + 500000 + 2250000 + 13250000 + 10700000);
  });

  it("should capture final nominal value from last event", () => {
    const metrics = computeMetrics(mockEvents);
    expect(metrics.finalNominalValue).toBeCloseTo(8738241.41, 0);
  });

  it("should handle empty events", () => {
    const metrics = computeMetrics([]);
    expect(metrics.ppEventCount).toBe(0);
    expect(metrics.redemptionTotal).toBe(0);
    expect(metrics.riskScore).toBe(0);
  });
});

describe("formatCREReport", () => {
  it("should format metrics as CRE report with timestamp", () => {
    const metrics = computeMetrics(mockEvents);
    const report = formatCREReport(metrics, "sc_depeg_stress_scn01");

    expect(report.backingRatioBps).toBe(metrics.backingRatioBps);
    expect(report.liquidityRatioBps).toBe(metrics.liquidityRatioBps);
    expect(report.riskScore).toBe(metrics.riskScore);
    expect(report.maturityGapDays).toBe(0);
    expect(report.timestamp).toBeGreaterThan(0);
    expect(report.scenarioId).toBe("sc_depeg_stress_scn01");
  });
});

describe("ACTUSDataProcessor", () => {
  it("should process events and assign day indices", () => {
    const processed = processEvents(mockEvents);
    expect(processed.length).toBe(mockEvents.length);
    expect(processed[0].dayIndex).toBe(0);
  });

  it("should compute daily summaries", () => {
    const summaries = computeDailySummaries(mockEvents);
    expect(summaries.length).toBeGreaterThan(0);
    // First summary should be day 0
    expect(summaries[0].day).toBe(0);
  });

  it("should extract trajectory points", () => {
    const points = extractTrajectoryPoints(mockEvents);
    // Should find IED, first redemption, and MD at minimum
    const labels = points.map((p) => p.label);
    expect(labels).toContain("Contract initialized");
    expect(labels).toContain("First redemption triggered");
    expect(labels).toContain("Maturity reached");
  });

  it("should handle empty events", () => {
    expect(processEvents([])).toEqual([]);
    expect(computeDailySummaries([])).toEqual([]);
    expect(extractTrajectoryPoints([])).toEqual([]);
  });
});

// Simple test runner (no jest dependency — uses basic assertions)
function expect(value: any) {
  return {
    toBe(expected: any) {
      if (value !== expected) throw new Error(`Expected ${expected}, got ${value}`);
    },
    toEqual(expected: any) {
      if (JSON.stringify(value) !== JSON.stringify(expected))
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
    },
    toBeGreaterThan(expected: number) {
      if (value <= expected) throw new Error(`Expected ${value} > ${expected}`);
    },
    toBeGreaterThanOrEqual(expected: number) {
      if (value < expected) throw new Error(`Expected ${value} >= ${expected}`);
    },
    toBeLessThanOrEqual(expected: number) {
      if (value > expected) throw new Error(`Expected ${value} <= ${expected}`);
    },
    toBeCloseTo(expected: number, precision: number) {
      const diff = Math.abs(value - expected);
      const threshold = Math.pow(10, -precision) / 2;
      if (diff > threshold) throw new Error(`Expected ${value} close to ${expected}`);
    },
    toContain(expected: any) {
      if (!value.includes(expected)) throw new Error(`Expected array to contain ${expected}`);
    },
  };
}

function describe(name: string, fn: () => void) {
  console.log(`\n  ${name}`);
  fn();
}

function it(name: string, fn: () => void) {
  try {
    fn();
    console.log(`    ✅ ${name}`);
  } catch (e: any) {
    console.log(`    ❌ ${name}: ${e.message}`);
  }
}

// Run all tests
console.log("\n🧪 risk-engine simulation tests\n");
describe("computeMetrics", () => {
  it("should compute valid metrics from mock events", () => {
    const metrics = computeMetrics(mockEvents);
    expect(metrics.backingRatioBps).toBeGreaterThanOrEqual(0);
    expect(metrics.riskScore).toBeLessThanOrEqual(100);
    expect(metrics.ppEventCount).toBeGreaterThan(0);
  });
});
