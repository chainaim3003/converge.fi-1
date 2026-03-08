/**
 * Converge.fi V4 Dashboard
 *
 * Data: GET /api/demo/health-check?phase=A|B|C  (single endpoint drives entire UI)
 * Health: GET /api/health  (ACTUS connectivity)
 *
 * No mocks. No hardcoding. No fallbacks. No unnecessary layers.
 *
 * Layout:
 *   Header (logo + ACTUS status)
 *   Phase Selector (A / B / C)
 *   Hero: Mint Gate status (OPEN / CLOSED)
 *   Row 1: 4 Hard Gates (backing, liquidity, riskScore, eligibility)
 *   Row 2: 8 Metrics grid
 *   Row 3: Maturity Ladder (actual contract data from ACTUS)
 *   Row 4: ACTUS Forward Simulation contracts
 *   Footer: ACTUS server + metadata
 */

import React, { useState, useCallback, useEffect } from "react";
import { fetchDemoHealth, fetchHealth } from "./lib/api";
import type { DemoHealthResponse, HealthResponse, ForwardContract, MaturityEntry } from "./lib/api";
import {
  fmtPct, formatUSD, formatUSDShort,
  riskLevel, backingLevel, liquidityLevel, eligibilityLevel, diversityLevel,
  formatDate
} from "./lib/formatters";

// ─── Shared Components (kept from existing codebase) ───
import { Card } from "./components/shared/Card";
import { MetricBadge } from "./components/shared/MetricBadge";
import { LoadingSpinner } from "./components/shared/LoadingSpinner";

// ─── Phase Definitions ───
const PHASES = [
  { id: "A", label: "Phase A", subtitle: "Healthy Reserve", colorClass: "emerald" },
  { id: "B", label: "Phase B", subtitle: "Stressed / Blocked", colorClass: "red" },
  { id: "C", label: "Phase C", subtitle: "Restored", colorClass: "amber" },
] as const;

function App() {
  const [phase, setPhase] = useState<string>("");
  const [data, setData] = useState<DemoHealthResponse | null>(null);
  const [actusHealth, setActusHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPhase = useCallback(async (p: string) => {
    setPhase(p);
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDemoHealth(p);
      setData(result);
    } catch (err: any) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Check ACTUS connectivity on mount
  useEffect(() => {
    fetchHealth()
      .then(setActusHealth)
      .catch(() => setActusHealth(null));
  }, []);

  const h = data?.health ?? null;
  const th = data?.thresholds ?? null;

  // ACTUS status dot
  const actusOk = actusHealth?.status === "healthy";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* ═══ HEADER ═══ */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-converge-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-base">C</span>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-100">
                Converge.fi
              </h1>
              <span className="text-xs text-gray-500">
                Autonomous Reserve Risk Monitor — V4
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-gray-400">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${
                actusOk ? "bg-emerald-400 animate-pulse" : "bg-red-400"
              }`} />
              <span>ACTUS {actusHealth?.config?.actusSimHost ?? "…"}</span>
            </div>
            {data && (
              <span className="text-gray-500">
                {data.contractCount} contracts · {data.totalACTUSEvents} events
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">

        {/* ═══ PHASE SELECTOR ═══ */}
        <div className="flex gap-3">
          {PHASES.map((p) => {
            const isActive = phase === p.id;
            const base = "flex-1 py-3 px-4 rounded-lg border-2 transition-all cursor-pointer text-center";

            let active: string;
            if (!isActive) {
              active = "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600";
            } else if (p.colorClass === "emerald") {
              active = "border-emerald-500 bg-emerald-900/30 text-emerald-300";
            } else if (p.colorClass === "red") {
              active = "border-red-500 bg-red-900/30 text-red-300";
            } else {
              active = "border-amber-500 bg-amber-900/30 text-amber-300";
            }

            return (
              <button
                key={p.id}
                onClick={() => loadPhase(p.id)}
                disabled={loading}
                className={`${base} ${active} disabled:opacity-50`}
              >
                <div className="font-semibold text-sm">{p.label}</div>
                <div className="text-xs opacity-70 mt-0.5">{p.subtitle}</div>
              </button>
            );
          })}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" label={`Running ACTUS simulation for Phase ${phase}…`} />
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 text-red-400 text-sm">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Prompt: no phase selected yet */}
        {!data && !loading && !error && (
          <div className="text-center py-16 text-gray-500">
            <p className="text-lg mb-2">Select a phase above to run the ACTUS simulation</p>
            <p className="text-sm">
              Phase A = healthy · Phase B = stressed (mint blocked) · Phase C = restored
            </p>
          </div>
        )}

        {/* ═══ MAIN CONTENT ═══ */}
        {h && th && !loading && (
          <>
            {/* ─── HERO: MINT GATE STATUS ─── */}
            <MintGateHero
              mintGate={h.mintGate}
              phase={data!.phase}
              overrideDescription={data!.overrideDescription}
              tokenSupply={h.tokenSupply}
              totalReserves={h.totalReserves}
            />

            {/* ─── 4 HARD GATES ─── */}
            <Card title="ACE Policy Gates (on-chain enforcement)">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <GateIndicator
                  name="Backing Ratio"
                  passed={h.backingPass}
                  value={`${h.backingPct}%`}
                  threshold={`≥ ${th.backingPct}%`}
                  regulation="GENIUS Act §4(a)(1)"
                />
                <GateIndicator
                  name="Liquidity Ratio"
                  passed={h.liquidityPass}
                  value={`${h.liquidityPct}%`}
                  threshold={`≥ ${th.liquidityPct}%`}
                  regulation="MiCA Art.54"
                />
                <GateIndicator
                  name="Risk Score"
                  passed={h.riskPass}
                  value={`${h.riskScore}/100`}
                  threshold={`≤ ${th.riskScore}`}
                  regulation="Composite"
                />
                <GateIndicator
                  name="Asset Eligibility"
                  passed={h.eligibilityPass}
                  value={`${h.assetEligibilityPct}%`}
                  threshold={`≥ ${th.assetEligibilityPct}%`}
                  regulation="GENIUS Act §4(a)(1)(A)"
                />
              </div>
            </Card>

            {/* ─── 8 METRICS GRID ─── */}
            <Card title="Reserve Health Metrics">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricBadge
                  label="Backing"
                  value={fmtPct(h.backingPct)}
                  level={backingLevel(h.backingPct)}
                  subtitle={`${formatUSD(h.totalReserves)} / ${formatUSD(h.tokenSupply)}`}
                />
                <MetricBadge
                  label="Liquidity"
                  value={fmtPct(h.liquidityPct)}
                  level={liquidityLevel(h.liquidityPct)}
                  subtitle={`${formatUSD(h.cashReserves)} cash`}
                />
                <MetricBadge
                  label="Risk Score"
                  value={`${h.riskScore}`}
                  level={riskLevel(h.riskScore)}
                  subtitle={h.riskScore <= 70 ? "Within threshold" : "ABOVE threshold (70)"}
                />
                <MetricBadge
                  label="Maturity (WAM)"
                  value={`${h.wamDays}d`}
                  level={h.wamDays <= 30 ? "safe" : h.wamDays <= 90 ? "warning" : "danger"}
                  subtitle="Weighted avg maturity"
                />
                <MetricBadge
                  label="Eligibility"
                  value={fmtPct(h.assetEligibilityPct)}
                  level={eligibilityLevel(h.assetEligibilityPct)}
                  subtitle="GENIUS-permitted assets"
                />
                <MetricBadge
                  label="Custodian Diversity"
                  value={`${h.custodianDiversityScore}`}
                  level={diversityLevel(h.custodianDiversityScore)}
                  subtitle="HHI-based (SVB lesson)"
                />
                <MetricBadge
                  label="T-Bill Concentration"
                  value={fmtPct(h.tbillPct)}
                  level={h.tbillPct <= 50 ? "safe" : "warning"}
                  subtitle={`${formatUSD(h.tbillReserves)} in T-bills`}
                />
                <MetricBadge
                  label="Ineligible Assets"
                  value={formatUSD(h.ineligibleReserves)}
                  level={h.ineligibleReserves === 0 ? "safe" : "danger"}
                  subtitle={h.ineligibleReserves === 0 ? "None — compliant" : "NON-GENIUS assets!"}
                />
              </div>
            </Card>

            {/* ─── MATURITY LADDER ─── */}
            <MaturityLadder entries={h.maturityLadder} />

            {/* ─── ACTUS FORWARD SIMULATION ─── */}
            <ForwardSimulation contracts={data!.forwardSimulation} />

            {/* ─── FOOTER ─── */}
            <div className="text-xs text-gray-600 text-center py-2">
              ACTUS: {data!.actusServer} · Computed: {data!.timestamp} ·
              ChainAim Technologies · Chainlink CRE + ACE
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function MintGateHero({
  mintGate, phase, overrideDescription, tokenSupply, totalReserves
}: {
  mintGate: "OPEN" | "CLOSED";
  phase: string;
  overrideDescription: string | null;
  tokenSupply: number;
  totalReserves: number;
}) {
  const open = mintGate === "OPEN";
  return (
    <div className={`rounded-xl border-2 p-6 text-center transition-all ${
      open ? "border-emerald-500 bg-emerald-900/20" : "border-red-500 bg-red-900/20"
    }`}>
      <div className={`text-4xl font-black tracking-tight ${
        open ? "text-emerald-400" : "text-red-400"
      }`}>
        {open ? "✅ MINTING ALLOWED" : "🛑 MINTING BLOCKED"}
      </div>
      <div className="text-sm text-gray-400 mt-2">
        Phase {phase}
        {overrideDescription && ` — ${overrideDescription}`}
        {" · "}Supply: {formatUSD(tokenSupply)} · Reserves: {formatUSD(totalReserves)}
      </div>
    </div>
  );
}

function GateIndicator({
  name, passed, value, threshold, regulation
}: {
  name: string;
  passed: boolean;
  value: string;
  threshold: string;
  regulation: string;
}) {
  return (
    <div className={`rounded-lg border p-3 transition-all ${
      passed
        ? "border-emerald-700/50 bg-emerald-900/20"
        : "border-red-700/50 bg-red-900/20"
    }`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400 uppercase tracking-wide">{name}</span>
        <span className={`text-lg font-bold ${passed ? "text-emerald-400" : "text-red-400"}`}>
          {passed ? "✓" : "✗"}
        </span>
      </div>
      <div className={`text-xl font-bold ${passed ? "text-emerald-300" : "text-red-300"}`}>
        {value}
      </div>
      <div className="text-xs text-gray-500 mt-1">
        Threshold: {threshold}
      </div>
      <div className="text-xs text-gray-600 mt-0.5 italic">
        {regulation}
      </div>
    </div>
  );
}

function MaturityLadder({ entries }: { entries: MaturityEntry[] }) {
  const visible = entries.filter((e) => e.principal > 0);
  if (visible.length === 0) return null;

  const sorted = [...visible].sort((a, b) => a.daysToMaturity - b.daysToMaturity);

  return (
    <Card title="Reserve Composition — Maturity Ladder">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 text-xs uppercase tracking-wide border-b border-gray-800">
              <th className="text-left py-2 px-3">Contract ID</th>
              <th className="text-left py-2 px-3">Category</th>
              <th className="text-right py-2 px-3">Principal</th>
              <th className="text-left py-2 px-3">Custodian</th>
              <th className="text-right py-2 px-3">Maturity</th>
              <th className="text-center py-2 px-3">Liquid</th>
              <th className="text-center py-2 px-3">GENIUS</th>
              <th className="text-right py-2 px-3">ACTUS</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => (
              <tr
                key={e.contractID}
                className="border-b border-gray-800/50 hover:bg-gray-900/50"
              >
                <td className="py-2 px-3 font-mono text-xs text-gray-300">
                  {e.contractID}
                </td>
                <td className="py-2 px-3">
                  <CategoryBadge category={e.category} />
                </td>
                <td className="py-2 px-3 text-right font-mono text-gray-200">
                  {formatUSD(e.principal)}
                </td>
                <td className="py-2 px-3 text-xs text-gray-400">
                  {e.custodian || "—"}
                </td>
                <td className="py-2 px-3 text-right text-gray-300">
                  {e.availableNow ? "now" : `${e.daysToMaturity}d`}
                </td>
                <td className="py-2 px-3 text-center">
                  <PassFail ok={e.availableNow} />
                </td>
                <td className="py-2 px-3 text-center">
                  <PassFail ok={e.isGeniusEligible} />
                </td>
                <td className="py-2 px-3 text-right text-xs text-gray-500">
                  {e.actusEvents} ({e.actusStatus})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ForwardSimulation({ contracts }: { contracts: ForwardContract[] }) {
  if (!contracts || contracts.length === 0) return null;

  return (
    <Card title="ACTUS Forward Simulation">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {contracts.map((fc) => (
          <div key={fc.contractID} className="bg-gray-800/50 rounded-lg p-3 text-xs">
            <div className="font-mono text-gray-300 mb-1">{fc.contractID}</div>
            <div className="text-gray-500">
              Status:{" "}
              <span className={fc.status === "Success" ? "text-emerald-400" : "text-red-400"}>
                {fc.status}
              </span>
              {" · "}{fc.eventCount} events
            </div>
            {fc.ied && (
              <div className="text-gray-500 mt-1">
                IED: {formatDate(fc.ied.time)} · payoff: {formatUSD(fc.ied.payoff)}
              </div>
            )}
            {fc.md && (
              <div className="text-gray-500">
                MD: {formatDate(fc.md.time)} · payoff: {formatUSD(fc.md.payoff)}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Tiny helpers ───

function CategoryBadge({ category }: { category: string }) {
  const styles =
    category === "cash"   ? "bg-emerald-900/40 text-emerald-400" :
    category === "tbill"  ? "bg-blue-900/40 text-blue-400" :
    category === "repo"   ? "bg-cyan-900/40 text-cyan-400" :
    category === "mmf"    ? "bg-indigo-900/40 text-indigo-400" :
                            "bg-red-900/40 text-red-400";
  return <span className={`text-xs px-2 py-0.5 rounded ${styles}`}>{category}</span>;
}

function PassFail({ ok }: { ok: boolean }) {
  return ok
    ? <span className="text-emerald-400">✓</span>
    : <span className="text-red-400">✗</span>;
}

export default App;
