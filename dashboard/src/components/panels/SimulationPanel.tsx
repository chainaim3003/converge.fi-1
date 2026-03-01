/**
 * SimulationPanel — Dropdown to select sim, Run button, last run timestamp.
 *
 * Data source: GET /api/simulations (list), POST /api/run-simulation (run)
 * From CLAUDE.md section 9.2: "Dropdown to select sim, Run button, last run timestamp"
 */

import React from "react";
import { Card } from "../shared/Card";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { SimulationInfo } from "../../lib/api";
import { formatDate, formatTime } from "../../lib/formatters";

interface SimulationPanelProps {
  simulations: SimulationInfo[];
  selectedId: string;
  onSelectId: (id: string) => void;
  onRun: () => Promise<void>;
  onRefreshMetrics: () => Promise<void>;
  loading: boolean;
  lastRunAt: string | null;
  error: string | null;
}

export function SimulationPanel({
  simulations,
  selectedId,
  onSelectId,
  onRun,
  onRefreshMetrics,
  loading,
  lastRunAt,
  error,
}: SimulationPanelProps) {
  const handleRun = async () => {
    await onRun();
    // After simulation runs, refresh CRE report metrics
    await onRefreshMetrics();
  };

  // Group simulations by domain for the dropdown
  const stablecoinSims = simulations.filter((s) => s.domain === "StableCoin");
  const otherSims = simulations.filter((s) => s.domain !== "StableCoin");

  return (
    <Card title="Simulation Controls">
      <div className="flex flex-wrap items-end gap-4">
        {/* Simulation selector */}
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs text-gray-400 mb-1">Select Simulation</label>
          <select
            value={selectedId}
            onChange={(e) => onSelectId(e.target.value)}
            disabled={loading}
            className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-converge-500 disabled:opacity-50"
          >
            {simulations.length === 0 && (
              <option value="">No simulations available</option>
            )}
            {stablecoinSims.length > 0 && (
              <optgroup label="StableCoin">
                {stablecoinSims.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.stepCount} steps)
                  </option>
                ))}
              </optgroup>
            )}
            {otherSims.length > 0 && (
              <optgroup label="Other">
                {otherSims.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.stepCount} steps)
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={loading || !selectedId}
          className="bg-converge-600 hover:bg-converge-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2 rounded-md transition-colors flex items-center gap-2"
        >
          {loading ? (
            <LoadingSpinner size="sm" label="Running..." />
          ) : (
            <>
              <span>▶</span>
              Run Simulation
            </>
          )}
        </button>

        {/* Last run timestamp */}
        {lastRunAt && (
          <div className="text-xs text-gray-500">
            Last run: {formatDate(lastRunAt)} {formatTime(lastRunAt)}
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="mt-3 text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded-md px-3 py-2">
          {error}
        </div>
      )}
    </Card>
  );
}
