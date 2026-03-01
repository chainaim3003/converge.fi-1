/**
 * useRiskData — Hook for on-chain risk state and CRE report metrics.
 *
 * Manages: current risk metrics, mint status, health check.
 * Data source: POST /api/v1/cre-report, GET /api/health
 */

import { useState, useEffect, useCallback } from "react";
import { fetchCREReport, fetchHealth, CREReport, HealthResponse } from "../lib/api";

export interface RiskData {
  /** Latest CRE report metrics */
  report: CREReport | null;
  /** Simulation metadata from last CRE report */
  simulationMeta: {
    id: string;
    name: string;
    totalEvents: number;
    ppEvents: number;
    peakRedemption: number;
    finalNominalValue: number;
  } | null;
  /** ACTUS service health */
  health: HealthResponse | null;
  /** Whether data is being fetched */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** When metrics were last computed */
  computedAt: string | null;
  /** Refresh metrics */
  refresh: () => Promise<void>;
  /** Refresh health */
  refreshHealth: () => Promise<void>;
}

export function useRiskData(): RiskData {
  const [report, setReport] = useState<CREReport | null>(null);
  const [simulationMeta, setSimulationMeta] = useState<RiskData["simulationMeta"]>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [computedAt, setComputedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCREReport();
      setReport(data.report);
      setSimulationMeta(data.simulation);
      setComputedAt(data.computedAt);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const data = await fetchHealth();
      setHealth(data);
    } catch (err: any) {
      // Health check failure is non-critical for display
      setHealth(null);
    }
  }, []);

  // Initial load
  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  return {
    report,
    simulationMeta,
    health,
    loading,
    error,
    computedAt,
    refresh,
    refreshHealth,
  };
}
