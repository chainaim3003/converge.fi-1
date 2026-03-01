/**
 * App.tsx — Root component for Converge.fi Dashboard.
 *
 * From CLAUDE.md section 9.1:
 *   Layout: Header + Sidebar + Main content area
 *   Left side: 7 risk monitoring panels
 *   Right side: AI Risk Chat (NOT implemented in this first cut)
 *
 * Data flow:
 *   useRiskData() → CRE report metrics from /api/v1/cre-report
 *   useSimulation() → simulation list + run results from /api/simulations, /api/run-simulation
 *   On-chain reads are simulated via risk-engine in this first cut.
 */

import React from "react";
import { AppShell } from "./components/layout/AppShell";
import { useRiskData } from "./hooks/useRiskData";
import { useSimulation } from "./hooks/useSimulation";

// Panels (left side — 7 components per CLAUDE.md section 9.2)
import { ReserveHealthPanel } from "./components/panels/ReserveHealthPanel";
import { CashflowChart } from "./components/panels/CashflowChart";
import { RiskTimelineChart } from "./components/panels/RiskTimelineChart";
import { SimulationPanel } from "./components/panels/SimulationPanel";
import { MintBlockStatus } from "./components/panels/MintBlockStatus";
import { AlertHistory } from "./components/panels/AlertHistory";
import { EventTable } from "./components/panels/EventTable";
import { MaturityLadderView } from "./components/panels/MaturityLadderView";

function App() {
  const riskData = useRiskData();
  const simulation = useSimulation();

  // Determine overall health status for the header
  const healthStatus: "healthy" | "degraded" | "offline" = riskData.health
    ? riskData.health.status === "healthy"
      ? "healthy"
      : "degraded"
    : "offline";

  const lastUpdateTimestamp = riskData.report?.timestamp ?? null;

  // Events from last simulation run
  const events = simulation.result?.events ?? [];

  return (
    <AppShell healthStatus={healthStatus} lastUpdateTimestamp={lastUpdateTimestamp}>
      {/* Main content: left panels (chat placeholder on right is deferred) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left side — Risk Monitoring Panels */}
        <div className="xl:col-span-2 space-y-6">
          {/* Row 1: Reserve Health + Mint Status */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ReserveHealthPanel report={riskData.report} loading={riskData.loading} />
            <MintBlockStatus report={riskData.report} loading={riskData.loading} />
          </div>

          {/* Row 2: Simulation Controls */}
          <SimulationPanel
            simulations={simulation.simulations}
            selectedId={simulation.selectedId}
            onSelectId={simulation.setSelectedId}
            onRun={simulation.run}
            onRefreshMetrics={riskData.refresh}
            loading={simulation.loading}
            lastRunAt={simulation.lastRunAt}
            error={simulation.error}
          />

          {/* Row 3: Charts */}
          <CashflowChart events={events} />
          <RiskTimelineChart events={events} />

          {/* Row 4: Maturity Ladder (treasury simulation data) */}
          <MaturityLadderView report={riskData.report} />

          {/* Row 5: Event Table */}
          <EventTable events={events} />

          {/* Row 6: Alert History */}
          <AlertHistory report={riskData.report} simulationMeta={riskData.simulationMeta} />
        </div>

        {/* Right side — AI Risk Chat placeholder */}
        <div className="hidden xl:block">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 h-full min-h-[400px] flex flex-col items-center justify-center">
            <div className="text-gray-600 text-center">
              <div className="text-4xl mb-3">💬</div>
              <p className="text-sm font-medium text-gray-400">AI Risk Chat</p>
              <p className="text-xs text-gray-600 mt-1">Coming soon — Stablecoin risk analyst</p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export default App;
