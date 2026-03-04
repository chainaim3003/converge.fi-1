/**
 * risk-engine simulation test — verifies computeMetrics and CRE report
 * formatting work correctly with sample event data.
 *
 * Run:  npx ts-node test/simulation.test.ts
 */

import { computeMetrics, formatCREReport } from "../src/metrics/computeMetrics";
import { ACTUSEvent } from "../src/types";

// Sample event data based on verified simulation output (CLAUDE.md section 5.3)
const sampleEvents: ACTUSEvent[] = [
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
    type: "PP" as ACTUSEvent["type"],
    time: `2026-03-0${i + 1}T12:00:00`,
    payoff: 0,
    nominalValue: 100000000,
    nominalRate: 0,
    nominalAccrued: 0,
    currency: "USD",
  })),
  // Day 7: BackingRatio triggers — $500K redeemed
  {
    type: "PP" as ACTUSEvent["type"],
    time: "2026-03-07T12:00:00",
    payoff: -500000,
    nominalValue: 99500000,
    nominalRate: 0,
    nominalAccrued: 0,
    currency: "USD",
  },
  // Day 8: $500K redeemed
  {
    type: "PP" as ACTUSEvent["type"],
    time: "2026-03-08T12:00:00",
    payoff: -500000,
    nominalValue: 99000000,
    nominalRate: 0,
    nominalAccrued: 0,
    currency: "USD",
  },
  // Day 9: RedemptionPressure triggers — $2.25M redeemed
  {
    type: "PP" as ACTUSEvent["type"],
    time: "2026-03-09T12:00:00",
    payoff: -2250000,
    nominalValue: 96750000,
    nominalRate: 0,
    nominalAccrued: 0,
    currency: "USD",
  },
  // Day 10: Both models compound — $13.25M redeemed
  {
    type: "PP" as ACTUSEvent["type"],
    time: "2026-03-10T12:00:00",
    payoff: -13250000,
    nominalValue: 83500000,
    nominalRate: 0,
    nominalAccrued: 0,
    currency: "USD",
  },
  // Day 15: peak stress — $10.7M redeemed
  {
    type: "PP" as ACTUSEvent["type"],
    time: "2026-03-15T12:00:00",
    payoff: -10700000,
    nominalValue: 27000000,
    nominalRate: 0,
    nominalAccrued: 0,
    currency: "USD",
  },
  // Day 31: MD event — final principal
  {
    type: "MD" as ACTUSEvent["type"],
    time: "2026-03-31T00:00:00",
    payoff: 0,
    nominalValue: 8738241.41,
    nominalRate: 0,
    nominalAccrued: 0,
    currency: "USD",
  },
];

// ─── Simple test runner ───

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
  };
}

let passed = 0;
let failed = 0;

function describe(name: string, fn: () => void) {
  console.log(`\n  ${name}`);
  fn();
}

function it(name: string, fn: () => void) {
  try {
    fn();
    console.log(`    ✅ ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`    ❌ ${name}: ${e.message}`);
    failed++;
  }
}

// ─── Tests ───

console.log("\n🧪 risk-engine simulation tests\n");

describe("computeMetrics", () => {
  it("should compute valid metrics from sample events", () => {
    const metrics = computeMetrics(sampleEvents);
    expect(metrics.backingRatioBps).toBeGreaterThanOrEqual(0);
    expect(metrics.backingRatioBps).toBeLessThanOrEqual(30000);
    expect(metrics.liquidityRatioBps).toBeGreaterThanOrEqual(0);
    expect(metrics.liquidityRatioBps).toBeLessThanOrEqual(10000);
    expect(metrics.riskScore).toBeGreaterThanOrEqual(0);
    expect(metrics.riskScore).toBeLessThanOrEqual(100);
    expect(metrics.ppEventCount).toBeGreaterThan(0);
    expect(metrics.redemptionTotal).toBeGreaterThan(0);
  });

  it("should detect 5 PP events with non-zero payoff", () => {
    const metrics = computeMetrics(sampleEvents);
    expect(metrics.ppEventCount).toBe(5);
  });

  it("should sum total redemptions correctly", () => {
    const metrics = computeMetrics(sampleEvents);
    const expectedTotal = 500000 + 500000 + 2250000 + 13250000 + 10700000;
    expect(metrics.redemptionTotal).toBe(expectedTotal);
  });

  it("should capture final nominal value from last event", () => {
    const metrics = computeMetrics(sampleEvents);
    expect(metrics.finalNominalValue).toBeCloseTo(8738241.41, 0);
  });

  it("should handle empty events without crashing", () => {
    const metrics = computeMetrics([]);
    expect(metrics.ppEventCount).toBe(0);
    expect(metrics.redemptionTotal).toBe(0);
  });
});

describe("formatCREReport", () => {
  it("should format metrics as CRE report with valid fields", () => {
    const metrics = computeMetrics(sampleEvents);
    const report = formatCREReport(metrics, "sc_depeg_stress_scn01");

    expect(report.backingRatioBps).toBe(metrics.backingRatioBps);
    expect(report.liquidityRatioBps).toBe(metrics.liquidityRatioBps);
    expect(report.riskScore).toBe(metrics.riskScore);
    expect(report.maturityGapDays).toBe(0);
    expect(report.timestamp).toBeGreaterThan(0);
    expect(report.scenarioId).toBe("sc_depeg_stress_scn01");
  });

  it("should produce integer bps values", () => {
    const metrics = computeMetrics(sampleEvents);
    const report = formatCREReport(metrics, "test");
    expect(report.backingRatioBps).toBe(Math.round(report.backingRatioBps));
    expect(report.liquidityRatioBps).toBe(Math.round(report.liquidityRatioBps));
  });
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
