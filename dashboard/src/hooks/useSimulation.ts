/**
 * useSimulation — Hook for running ACTUS simulations via risk-engine.
 *
 * Manages: simulation list, selected simulation, run state, results.
 * Data source: GET /api/simulations, POST /api/run-simulation
 */

import { useState, useEffect, useCallback } from "react";
import {
  fetchSimulations,
  runSimulation as apiRunSimulation,
  SimulationInfo,
  SimulationRunResult,
} from "../lib/api";

export interface UseSimulationReturn {
  /** Available simulation files */
  simulations: SimulationInfo[];
  /** Currently selected simulation ID */
  selectedId: string;
  /** Set selected simulation */
  setSelectedId: (id: string) => void;
  /** Last simulation run result */
  result: SimulationRunResult | null;
  /** Whether a simulation is currently running */
  loading: boolean;
  /** Error message if last operation failed */
  error: string | null;
  /** Run the selected simulation */
  run: () => Promise<void>;
  /** Timestamp of last successful run */
  lastRunAt: string | null;
}

export function useSimulation(): UseSimulationReturn {
  const [simulations, setSimulations] = useState<SimulationInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [result, setResult] = useState<SimulationRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  // Load simulation list on mount
  useEffect(() => {
    fetchSimulations()
      .then((data) => {
        setSimulations(data.simulations);
        // Auto-select first StableCoin simulation if available
        const stablecoinSim = data.simulations.find((s) => s.domain === "StableCoin");
        if (stablecoinSim) {
          setSelectedId(stablecoinSim.id);
        } else if (data.simulations.length > 0) {
          setSelectedId(data.simulations[0].id);
        }
      })
      .catch((err) => {
        setError(`Failed to load simulations: ${err.message}`);
      });
  }, []);

  const run = useCallback(async () => {
    if (!selectedId) {
      setError("No simulation selected");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await apiRunSimulation(selectedId);
      setResult(res);
      setLastRunAt(res.executedAt);
    } catch (err: any) {
      setError(err.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  return {
    simulations,
    selectedId,
    setSelectedId,
    result,
    loading,
    error,
    run,
    lastRunAt,
  };
}
