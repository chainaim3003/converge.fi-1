/**
 * Converge.fi V4 Dashboard — E2E Narrative Flow (White Glossy Edition)
 *
 * Layout: Two-column side-by-side
 *   Left  (flex-1) — Step cards, scrollable
 *   Right (340px)  — Live metrics panel, sticky
 *   ⇄ Swap button in persistent bar
 *
 * Workflow logic: UNCHANGED. No mocks. No fallbacks. CRE never skipped.
 * Visual layer:   White glossy surfaces, surgical colour use, premium hierarchy.
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  fetchDemoHealth,
  fetchChainStatus,
  fetchChainTransactions,
  adminBurn,
  adminMint,
  adminCRErun,
} from "./lib/api";
import type {
  DemoHealthResponse,
  ChainStatusResponse,
  ChainTxResponse,
  BurnResponse,
  MintResponse,
  CRERunResponse,
  MaturityEntry,
} from "./lib/api";
import {
  fmtPct,
  formatUSD,
  riskLevel,
  backingLevel,
  liquidityLevel,
  eligibilityLevel,
  diversityLevel,
} from "./lib/formatters";
import { LoadingSpinner } from "./components/shared/LoadingSpinner";

// ─── Types ────────────────────────────────────────────────────────────────────

type StepStatus = "pending" | "running" | "done" | "error" | "blocked";
interface StepState { status: StepStatus; log: string[]; data: Record<string, unknown>; }
interface TickerEntry { id: number; time: string; icon: string; text: string; }

const INITIAL_STEPS: StepState[] = Array.from({ length: 7 }, () => ({
  status: "pending" as StepStatus, log: [], data: {},
}));

const STEP_META = [
  { title: "Chain Setup",                          subtitle: "Verify network · contracts · LINK · last transactions",                autoRun: true  },
  { title: "Burn cvUSD",                           subtitle: "Burn all deployer tokens — reset to zero supply",                      autoRun: false },
  { title: "Phase A — Healthy → CRE → Mint 100K",  subtitle: "ACTUS healthy reserves · CRE broadcasts on-chain · mint $100K cvUSD", autoRun: false },
  { title: "Admin: CRE Stress (Phase B)",           subtitle: "CRE pushes Phase B — cash drained · corp bond added · gates close",   autoRun: false },
  { title: "Phase B — Mint Blocked",               subtitle: "On-chain enforcement — mint reverts with MintBlockedError",            autoRun: false },
  { title: "Admin: CRE Restore (Phase C)",          subtitle: "CRE pushes Phase C — corp bond liquidated · gates reopen",            autoRun: false },
  { title: "Phase C — Mint 100K (Allowed)",         subtitle: "Final mint — all 4 gates green · supply reaches 200K cvUSD",          autoRun: false },
];

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  const [steps, setSteps]               = useState<StepState[]>(INITIAL_STEPS);
  const [currentStep, setCurrentStep]   = useState(0);
  const [chainStatus, setChainStatus]   = useState<ChainStatusResponse | null>(null);
  const [transactions, setTransactions] = useState<ChainTxResponse | null>(null);
  const [refreshing, setRefreshing]     = useState(false);
  const [ticker, setTicker]             = useState<TickerEntry[]>([]);
  const tickerIdRef                     = useRef(0);

  const [metricsOnLeft, setMetricsOnLeft] = useState<boolean>(() => {
    try { return localStorage.getItem("metricsOnLeft") === "true"; } catch { return false; }
  });
  const toggleLayout = () => setMetricsOnLeft(prev => {
    const next = !prev;
    try { localStorage.setItem("metricsOnLeft", String(next)); } catch {}
    return next;
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const patchStep = useCallback((index: number, patch: Partial<StepState>) =>
    setSteps(prev => { const n = [...prev]; n[index] = { ...n[index], ...patch }; return n; }), []);

  const appendLog = useCallback((index: number, line: string) =>
    setSteps(prev => { const n = [...prev]; n[index] = { ...n[index], log: [...n[index].log, line] }; return n; }), []);

  const setStepData = useCallback((index: number, key: string, value: unknown) =>
    setSteps(prev => { const n = [...prev]; n[index] = { ...n[index], data: { ...n[index].data, [key]: value } }; return n; }), []);

  const addTicker = useCallback((icon: string, text: string) => {
    const id = ++tickerIdRef.current;
    const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setTicker(prev => [{ id, time, icon, text }, ...prev].slice(0, 10));
  }, []);

  const refreshChain = useCallback(async () => {
    setRefreshing(true);
    try { const s = await fetchChainStatus(); setChainStatus(s); }
    catch (e: any) { console.error("Chain refresh:", e.message); }
    finally { setRefreshing(false); }
  }, []);

  // ─── Step runners — workflow logic UNCHANGED ─────────────────────────────────

  const runStep0 = useCallback(async () => {
    patchStep(0, { status: "running", log: [], data: {} });
    try {
      appendLog(0, "Connecting to Ethereum Sepolia...");
      const [status, txns] = await Promise.all([fetchChainStatus(), fetchChainTransactions()]);
      setChainStatus(status); setTransactions(txns);
      appendLog(0, `✓ Block #${status.blockNumber} — ${status.network}`);
      appendLog(0, `✓ totalSupply: ${status.totalSupply.toLocaleString()} cvUSD`);
      appendLog(0, `✓ deployerBalance: ${status.deployerBalance.toLocaleString()} cvUSD`);

      appendLog(0, `✓ Mint gate: ${status.mintAllowed ? "OPEN" : "CLOSED"} — ${status.mintReason}`);
      appendLog(0, `✓ Loaded ${txns.transactions.length} recent transactions`);
      addTicker("🔗", `Chain connected · Block #${status.blockNumber} · Gate ${status.mintAllowed ? "OPEN" : "CLOSED"}`);
      patchStep(0, { status: "done", data: { chainStatus: status, txns } });
      setCurrentStep(1);
    } catch (e: any) { appendLog(0, `✗ Error: ${e.message}`); patchStep(0, { status: "error" }); addTicker("✗", `Chain setup failed: ${e.message}`); }
  }, [patchStep, appendLog, addTicker]);

  const runStep1 = useCallback(async () => {
    patchStep(1, { status: "running", log: [], data: {} });
    try {
      appendLog(1, "Calling stablecoin.burn(deployerBalance) via deployer wallet...");
      const result: BurnResponse = await adminBurn();
      if (result.txHash) {
        appendLog(1, `✓ Burned ${result.burnedAmount.toLocaleString()} cvUSD`);
        appendLog(1, `✓ Tx: ${result.txHash}`);
        appendLog(1, `✓ Block: ${result.blockNumber}`);
        appendLog(1, `✓ New total supply: ${result.newSupply.toLocaleString()} cvUSD`);
        addTicker("🔥", `Burned ${result.burnedAmount.toLocaleString()} cvUSD · supply → 0`);
      } else {
        appendLog(1, `ℹ ${result.message ?? "Balance was already 0"}`);
        addTicker("ℹ", "Balance already 0 — no burn needed");
      }
      await refreshChain();
      patchStep(1, { status: "done", data: { burn: result } }); setCurrentStep(2);
    } catch (e: any) { appendLog(1, `✗ Error: ${e.message}`); patchStep(1, { status: "error" }); addTicker("✗", `Burn failed: ${e.message}`); }
  }, [patchStep, appendLog, refreshChain, addTicker]);

  const runStep2 = useCallback(async () => {
    patchStep(2, { status: "running", log: [], data: {} });
    try {
      appendLog(2, "Fetching ACTUS simulation for Phase A...");
      const actus = await fetchDemoHealth("A");
      appendLog(2, `✓ ACTUS: ${actus.contractCount} contracts · ${actus.totalACTUSEvents} events`);
      appendLog(2, `✓ Backing: ${actus.health.backingPct}% · Liquidity: ${actus.health.liquidityPct}% · Risk: ${actus.health.riskScore}`);
      appendLog(2, `✓ Mint gate (ACTUS): ${actus.health.mintGate}`);
      setStepData(2, "actus", actus);
      appendLog(2, ""); appendLog(2, "Spawning: cre workflow simulate workflows/risk-monitoring --target demo-A --broadcast");
      appendLog(2, "Waiting for CRE to call ACTUS, encode report, broadcast to Sepolia...");
      const cre: CRERunResponse = await adminCRErun("demo-A");
      if (!cre.success) throw new Error(`CRE exited with code ${cre.exitCode}: ${cre.output}`);
      appendLog(2, "✓ CRE workflow completed");
      cre.output.split("\n").filter(Boolean).slice(-6).forEach(l => appendLog(2, `  ${l}`));
      setStepData(2, "cre", cre);
      addTicker("📡", "CRE demo-A complete · Phase A broadcast to Sepolia");
      await refreshChain();
      const fresh = await fetchChainStatus();
      appendLog(2, ""); appendLog(2, `  Mint gate on-chain: ${fresh.mintAllowed ? "OPEN" : "CLOSED"} — ${fresh.mintReason}`);
      appendLog(2, ""); appendLog(2, "Calling stablecoin.mint(deployer, 100000 cvUSD)...");
      const mintResult: MintResponse = await adminMint(100000);
      if (!mintResult.success) throw new Error(`Mint failed: ${mintResult.reason ?? mintResult.error}`);
      appendLog(2, `✓ Minted 100,000 cvUSD`);
      appendLog(2, `✓ Tx: ${mintResult.txHash}`);
      appendLog(2, `✓ Block: ${mintResult.blockNumber}`);
      appendLog(2, `✓ Total supply: ${mintResult.newSupply?.toLocaleString()} cvUSD`);
      addTicker("🪙", `Minted 100K cvUSD · supply → ${mintResult.newSupply?.toLocaleString()}`);
      await refreshChain();
      setStepData(2, "mint", mintResult);
      patchStep(2, { status: "done" }); setCurrentStep(3);
    } catch (e: any) { appendLog(2, `✗ Error: ${e.message}`); patchStep(2, { status: "error" }); addTicker("✗", `Phase A failed: ${e.message}`); }
  }, [patchStep, appendLog, setStepData, refreshChain, addTicker]);

  const runStep3 = useCallback(async () => {
    patchStep(3, { status: "running", log: [], data: {} });
    try {
      appendLog(3, "Spawning: cre workflow simulate workflows/risk-monitoring --target demo-B --broadcast");
      appendLog(3, "Phase B override: 3 banks drained to $0, corp bond added (not GENIUS-eligible)...");
      appendLog(3, "Waiting for CRE to broadcast Phase B stress data to Sepolia...");
      const cre: CRERunResponse = await adminCRErun("demo-B");
      if (!cre.success) throw new Error(`CRE exited with code ${cre.exitCode}: ${cre.output}`);
      appendLog(3, "✓ CRE workflow completed");
      cre.output.split("\n").filter(Boolean).slice(-6).forEach(l => appendLog(3, `  ${l}`));
      setStepData(3, "cre", cre);
      appendLog(3, ""); appendLog(3, "Fetching Phase B ACTUS health metrics...");
      const actus = await fetchDemoHealth("B");
      appendLog(3, `✓ Backing: ${actus.health.backingPct}% (${actus.health.backingPass ? "PASS" : "FAIL"})`);
      appendLog(3, `✓ Liquidity: ${actus.health.liquidityPct}% (${actus.health.liquidityPass ? "PASS" : "FAIL"})`);
      appendLog(3, `✓ Risk Score: ${actus.health.riskScore} (${actus.health.riskPass ? "PASS" : "FAIL"})`);
      appendLog(3, `✓ Eligibility: ${actus.health.assetEligibilityPct}% (${actus.health.eligibilityPass ? "PASS" : "FAIL"})`);
      appendLog(3, `✓ Mint gate (ACTUS): ${actus.health.mintGate}`);
      setStepData(3, "actus", actus);
      addTicker("⚠", `CRE demo-B · Gate → CLOSED · Liquidity ${actus.health.liquidityPct}% · Risk ${actus.health.riskScore}`);
      await refreshChain();
      patchStep(3, { status: "done" }); setCurrentStep(4);
    } catch (e: any) { appendLog(3, `✗ Error: ${e.message}`); patchStep(3, { status: "error" }); addTicker("✗", `Phase B stress failed: ${e.message}`); }
  }, [patchStep, appendLog, setStepData, refreshChain, addTicker]);

  const runStep4 = useCallback(async () => {
    patchStep(4, { status: "running", log: [], data: {} });
    try {
      appendLog(4, "Fetching current on-chain mint gate status...");
      const status = await fetchChainStatus();
      appendLog(4, `  On-chain gate: ${status.mintAllowed ? "OPEN" : "CLOSED"}`);
      appendLog(4, `  Reason: ${status.mintReason}`);
      setStepData(4, "preStatus", status);
      appendLog(4, ""); appendLog(4, "Calling stablecoin.mint(deployer, 100000 cvUSD)...");
      appendLog(4, "Expecting revert with MintBlockedError...");
      const mintResult: MintResponse = await adminMint(100000);
      if (mintResult.success) {
        appendLog(4, `⚠ Unexpected: mint succeeded! Tx: ${mintResult.txHash}`);
        patchStep(4, { status: "done", data: { mintResult, unexpectedSuccess: true } });
        addTicker("⚠", "Unexpected: mint succeeded during Phase B");
      } else if (mintResult.blocked) {
        appendLog(4, `✓ Contract reverted as expected`);
        appendLog(4, `✓ MintBlockedError reason: "${mintResult.reason}"`);
        setStepData(4, "mintResult", mintResult);
        addTicker("🛑", `Mint BLOCKED · ${mintResult.reason}`);
        patchStep(4, { status: "blocked" });
      } else { throw new Error(mintResult.error ?? "Mint failed with unexpected error"); }
      setCurrentStep(5);
    } catch (e: any) { appendLog(4, `✗ Error: ${e.message}`); patchStep(4, { status: "error" }); addTicker("✗", `Phase B mint attempt error: ${e.message}`); }
  }, [patchStep, appendLog, setStepData, addTicker]);

  const runStep5 = useCallback(async () => {
    patchStep(5, { status: "running", log: [], data: {} });
    try {
      appendLog(5, "Spawning: cre workflow simulate workflows/risk-monitoring --target demo-C --broadcast");
      appendLog(5, "Phase C override: corp bond liquidated at 5% loss, emergency cash injected...");
      appendLog(5, "Waiting for CRE to broadcast Phase C restore data to Sepolia...");
      const cre: CRERunResponse = await adminCRErun("demo-C");
      if (!cre.success) throw new Error(`CRE exited with code ${cre.exitCode}: ${cre.output}`);
      appendLog(5, "✓ CRE workflow completed");
      cre.output.split("\n").filter(Boolean).slice(-6).forEach(l => appendLog(5, `  ${l}`));
      setStepData(5, "cre", cre);
      appendLog(5, ""); appendLog(5, "Fetching Phase C ACTUS health metrics...");
      const actus = await fetchDemoHealth("C");
      appendLog(5, `✓ Backing: ${actus.health.backingPct}% (${actus.health.backingPass ? "PASS" : "FAIL"})`);
      appendLog(5, `✓ Liquidity: ${actus.health.liquidityPct}% (${actus.health.liquidityPass ? "PASS" : "FAIL"})`);
      appendLog(5, `✓ Risk Score: ${actus.health.riskScore} (${actus.health.riskPass ? "PASS" : "FAIL"})`);
      appendLog(5, `✓ Eligibility: ${actus.health.assetEligibilityPct}% (${actus.health.eligibilityPass ? "PASS" : "FAIL"})`);
      appendLog(5, `✓ Mint gate (ACTUS): ${actus.health.mintGate}`);
      setStepData(5, "actus", actus);
      addTicker("📡", `CRE demo-C · Gate → OPEN · Liquidity ${actus.health.liquidityPct}% restored`);
      await refreshChain();
      patchStep(5, { status: "done" }); setCurrentStep(6);
    } catch (e: any) { appendLog(5, `✗ Error: ${e.message}`); patchStep(5, { status: "error" }); addTicker("✗", `Phase C restore failed: ${e.message}`); }
  }, [patchStep, appendLog, setStepData, refreshChain, addTicker]);

  const runStep6 = useCallback(async () => {
    patchStep(6, { status: "running", log: [], data: {} });
    try {
      appendLog(6, "Fetching current on-chain mint gate status...");
      const status = await fetchChainStatus();
      appendLog(6, `  On-chain gate: ${status.mintAllowed ? "OPEN" : "CLOSED"} — ${status.mintReason}`);
      appendLog(6, ""); appendLog(6, "Calling stablecoin.mint(deployer, 100000 cvUSD)...");
      const mintResult: MintResponse = await adminMint(100000);
      if (!mintResult.success) throw new Error(mintResult.blocked ? `Mint blocked: ${mintResult.reason}` : (mintResult.error ?? "Mint failed"));
      appendLog(6, `✓ Minted 100,000 cvUSD`);
      appendLog(6, `✓ Tx: ${mintResult.txHash}`);
      appendLog(6, `✓ Block: ${mintResult.blockNumber}`);
      appendLog(6, `✓ Deployer balance: ${mintResult.newBalance?.toLocaleString()} cvUSD`);
      appendLog(6, `✓ Total supply: ${mintResult.newSupply?.toLocaleString()} cvUSD`);
      addTicker("✅", `Final mint 100K cvUSD · total supply → ${mintResult.newSupply?.toLocaleString()} cvUSD`);
      await refreshChain();
      setStepData(6, "mint", mintResult);
      patchStep(6, { status: "done" });
    } catch (e: any) { appendLog(6, `✗ Error: ${e.message}`); patchStep(6, { status: "error" }); addTicker("✗", `Phase C mint failed: ${e.message}`); }
  }, [patchStep, appendLog, setStepData, refreshChain, addTicker]);

  const STEP_RUNNERS = [runStep0, runStep1, runStep2, runStep3, runStep4, runStep5, runStep6];

  const step0Fired = useRef(false);
  useEffect(() => {
    if (step0Fired.current) return;
    step0Fired.current = true;
    runStep0();
  }, []); // eslint-disable-line

  const chainReady = steps[0].status === "done";

  // ─── Columns ─────────────────────────────────────────────────────────────────

  const StepsColumn = (
    <div className="flex-1 min-w-0 space-y-2">
      {STEP_META.map((meta, i) => (
        <React.Fragment key={i}>
          <StepCard
            index={i} meta={meta} state={steps[i]}
            isActive={currentStep === i} isEnabled={i <= currentStep}
            onRun={STEP_RUNNERS[i]}
            chainStatus={chainStatus}
            transactions={i === 0 ? transactions : null}
          />
          {i < 6 && (
            <div className={`step-connector h-4 ${steps[i].status === "done" ? "step-connector-done" : ""}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );

  const MetricsColumn = (
    <div className="flex-shrink-0" style={{
      width: "340px",
      position: "sticky",
      top: "92px",
      alignSelf: "flex-start",
      maxHeight: "calc(100vh - 108px)",
      overflowY: "auto",
    }}>
      <MetricsPanel chainStatus={chainStatus} refreshing={refreshing} ticker={ticker} chainReady={chainReady} />
    </div>
  );

  return (
    <div className="page-bg" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* ═══ HEADER ═══ */}
      <header className="gloss-header sticky top-0 z-50 px-6 py-3">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="logo-mark w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Two arcs converging — represents risk signals merging into a single on-chain decision */}
                <path d="M4 4 C4 4 8 7 11 11 C8 15 4 18 4 18" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.6"/>
                <path d="M9 4 C9 4 13 7 16 11 C13 15 9 18 9 18" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.85"/>
                <circle cx="17" cy="11" r="2" fill="white" />
              </svg>
            </div>
            <div>
              <div className="font-bold text-sm text-gray-900 tracking-tight">Converge.fi</div>
              <div className="text-xs text-gray-400">
                Autonomous Reserve Risk Monitor · V4 · Ethereum Sepolia
              </div>
            </div>
          </div>

          <div className="text-xs px-3 py-1 rounded-full font-medium"
            style={{ background: "#ede9fe", color: "#4f46e5", border: "1px solid rgba(79,70,229,0.18)" }}>
            Chainlink CRE
          </div>
        </div>
      </header>

      {/* ═══ PERSISTENT BAR ═══ */}
      {chainStatus && (
        <PersistentBar
          status={chainStatus} refreshing={refreshing}
          metricsOnLeft={metricsOnLeft} onSwap={toggleLayout}
        />
      )}

      {/* ═══ TWO-COLUMN BODY ═══ */}
      <div className="max-w-screen-xl mx-auto px-4 py-6 flex gap-5 items-start">
        {metricsOnLeft ? <>{MetricsColumn}{StepsColumn}</> : <>{StepsColumn}{MetricsColumn}</>}
      </div>
    </div>
  );
}

// ─── Persistent Bar ───────────────────────────────────────────────────────────

function PersistentBar({ status, refreshing, metricsOnLeft, onSwap }: {
  status: ChainStatusResponse; refreshing: boolean; metricsOnLeft: boolean; onSwap: () => void;
}) {
  return (
    <div className="gloss-bar px-6 py-2 sticky z-40" style={{ top: "56px" }}>
      <div className="max-w-screen-xl mx-auto flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <span className="section-label">Balances</span>

        <BalancePill label="Total Supply" value={`${status.totalSupply.toLocaleString()} cvUSD`} />
        <BalancePill label="Deployer" value={`${status.deployerBalance.toLocaleString()} cvUSD`} />

        {refreshing && <LoadingSpinner size="sm" />}

        <span className="ml-auto text-gray-400" style={{ fontSize: "11px" }}>
          Block #{status.blockNumber}
        </span>

        <button onClick={onSwap}
          className="btn-swap flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium">
          <span>⇄</span><span>Swap</span>
        </button>
      </div>
    </div>
  );
}

function BalancePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg"
      style={{ background: "rgba(79,70,229,0.06)", border: "1px solid rgba(79,70,229,0.12)" }}>
      <span className="text-gray-400" style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <span className="font-bold text-gray-900" style={{ fontSize: "12px" }}>{value}</span>
    </div>
  );
}

// ─── Metrics Panel ────────────────────────────────────────────────────────────

function MetricsPanel({ chainStatus, refreshing, ticker, chainReady }: {
  chainStatus: ChainStatusResponse | null;
  refreshing: boolean;
  ticker: TickerEntry[];
  chainReady: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <span className="section-label">Metrics Update</span>
        {refreshing && <LoadingSpinner size="sm" />}
      </div>

      {!chainStatus ? (
        <div className="gloss-card p-8 text-center">
          <LoadingSpinner size="sm" />
          <div className="text-xs text-gray-400 mt-2">Connecting to chain...</div>
        </div>
      ) : (
        <>
          {/* Mint Gate Hero */}
          <div className={chainStatus.mintAllowed ? "mint-hero-open" : "mint-hero-closed"}>
            <div className="p-5 text-center">
              <div className="flex items-center justify-center gap-2 mb-1.5">
                <div className="relative">
                  <div className={`w-2.5 h-2.5 rounded-full ${chainStatus.mintAllowed ? "bg-emerald-500" : "bg-red-500"}`} />
                  <div className={`sonar-ring absolute inset-0 rounded-full ${chainStatus.mintAllowed ? "sonar-green" : "sonar-red"}`} />
                </div>
                <span className="section-label">{chainStatus.mintAllowed ? "Mint Gate" : "Mint Gate"}</span>
              </div>
              <div className={`text-3xl font-black tracking-tight ${chainStatus.mintAllowed ? "text-emerald-700" : "text-red-700"}`}>
                {chainStatus.mintAllowed ? "OPEN" : "CLOSED"}
              </div>
              <div className="text-xs text-gray-500 mt-1">{chainStatus.mintReason}</div>
            </div>
          </div>

          {/* Policy Gates */}
          <div className="gloss-card p-4">
            <div className="section-label mb-3">Policy Gates</div>
            {!chainReady ? (
              <div className="py-6 text-center">
                <div className="text-2xl mb-2">🔒</div>
                <div className="text-xs text-gray-400">Gates populate after<br />chain setup completes</div>
              </div>
            ) : (
              <div className="space-y-2">
                {[
                  { name: "Backing",    value: `${chainStatus.onChainBacking}%`,   passed: chainStatus.onChainBacking >= 100,   threshold: "≥ 100%", reg: "GENIUS §4" },
                  { name: "Liquidity",  value: `${chainStatus.onChainLiquidity}%`, passed: chainStatus.onChainLiquidity >= 30,  threshold: "≥ 30%",  reg: "MiCA 54"  },
                  { name: "Risk Score", value: `${chainStatus.onChainRiskScore}`,  passed: chainStatus.onChainRiskScore <= 70,  threshold: "≤ 70",   reg: "Composite" },
                  { name: "Eligibility",value: "—",                                passed: chainStatus.mintAllowed,             threshold: "≥ 100%", reg: "GENIUS §4(a)" },
                ].map((g, i) => (
                  <div key={g.name} className={`gate-row ${g.passed ? "gate-pass" : "gate-fail"}`}
                    style={{ animationDelay: `${i * 60}ms` }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-600">{g.name}</span>
                      <span className={`text-sm font-bold ${g.passed ? "text-emerald-700" : "text-red-700"}`}>
                        {g.value}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-xs text-gray-400">{g.threshold}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-400 italic">{g.reg}</span>
                        <span className={`text-xs font-bold ${g.passed ? "text-emerald-600" : "text-red-600"}`}>
                          {g.passed ? "PASS" : "FAIL"}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>



          {/* Activity Ticker */}
          <div className="gloss-card p-4">
            <div className="section-label mb-3">Activity</div>
            {ticker.length === 0 ? (
              <div className="py-5 text-center text-xs text-gray-400">No events yet...</div>
            ) : (
              <div className="space-y-2">
                {ticker.map((e, idx) => (
                  <div key={e.id} className="ticker-item" style={{ opacity: Math.max(0.35, 1 - idx * 0.09) }}>
                    <div className="flex items-start gap-2">
                      <span className="text-base leading-none flex-shrink-0">{e.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-700 leading-snug truncate">{e.text}</div>
                        <div className="text-xs text-gray-400 font-mono mt-0.5" style={{ fontSize: "10px" }}>{e.time}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BalRow({ label, value, warn, mono }: { label: string; value: string; warn?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-gray-400">{label}</span>
      <span className={`font-medium ${mono ? "font-mono" : ""} ${warn ? "text-amber-600" : "text-gray-800"}`}>
        {value}
      </span>
    </div>
  );
}

// ─── Step Card ────────────────────────────────────────────────────────────────

function StepCard({ index, meta, state, isActive, isEnabled, onRun, chainStatus, transactions }: {
  index: number; meta: (typeof STEP_META)[0]; state: StepState;
  isActive: boolean; isEnabled: boolean; onRun: () => void;
  chainStatus: ChainStatusResponse | null; transactions: ChainTxResponse | null;
}) {
  const isRunning = state.status === "running";
  const isDone    = state.status === "done";
  const isError   = state.status === "error";
  const isBlocked = state.status === "blocked";
  const isPending = state.status === "pending";

  const cardClass = [
    "gloss-card relative overflow-hidden",
    isDone    ? "gloss-card-done"    : "",
    isBlocked ? "gloss-card-blocked" : "",
    isRunning ? "gloss-card-running" : "",
    isError   ? "gloss-card-error"   : "",
    isRunning ? "running-accent"     : "",
  ].join(" ");

  const numClass =
    isDone    ? "step-num step-num-done"    :
    isBlocked ? "step-num step-num-blocked" :
    isError   ? "step-num step-num-error"   :
    isRunning ? "step-num step-num-running" :
    isActive && isEnabled ? "step-num step-num-active" :
    "step-num step-num-pending";

  const badge =
    isDone    ? <span className="badge badge-green">✓ Done</span>      :
    isBlocked ? <span className="badge badge-red">🛑 Blocked</span>    :
    isError   ? <span className="badge badge-red">✗ Error</span>       :
    isRunning ? <span className="badge badge-indigo">⟳ Running</span>  :
    <span className="badge badge-gray">Pending</span>;

  const showButton = !meta.autoRun && isEnabled && (isPending || isError);

  return (
    <div className={cardClass}>
      {isDone    && <div className="sweep-line sweep-line-green" />}
      {isBlocked && <div className="sweep-line sweep-line-red" />}

      {/* Card header row */}
      <div className="px-5 py-4 flex items-center gap-4">
        <div className={numClass}>
          {isDone ? "✓" : isBlocked ? "!" : index}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">{meta.title}</span>
            {badge}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{meta.subtitle}</p>
        </div>
        {showButton && (
          <button onClick={onRun} disabled={isRunning}
            className="btn-execute flex-shrink-0 px-4 py-1.5 text-xs font-semibold rounded-lg">
            Execute
          </button>
        )}
        {isRunning && <LoadingSpinner size="sm" />}
      </div>

      {/* Terminal log */}
      {state.log.length > 0 && (
        <div className="terminal-window" style={{ borderTop: "1px solid rgba(0,0,0,0.07)" }}>
          <div className="terminal-topbar">
            <div className="term-dot" style={{ background: "#ff5f57" }} />
            <div className="term-dot" style={{ background: "#febc2e" }} />
            <div className="term-dot" style={{ background: "#28c840" }} />
            <span className="ml-2 text-xs font-mono text-gray-500">
              converge.fi · step {index}
            </span>
          </div>
          <TerminalLog lines={state.log} />
        </div>
      )}

      {/* Result panel */}
      {(isDone || isBlocked) && Object.keys(state.data).length > 0 && (
        <div className="p-4 space-y-3 fade-up" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
          <StepResult index={index} state={state} chainStatus={chainStatus} transactions={transactions} />
        </div>
      )}
    </div>
  );
}

// ─── Terminal Log ─────────────────────────────────────────────────────────────

function TerminalLog({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [lines]);

  return (
    <div ref={ref}
      className="relative px-5 py-3 max-h-52 overflow-y-auto font-mono text-xs leading-relaxed"
      style={{ background: "#0d1117" }}>
      <div className="crt-scan" />
      {lines.map((line, i) => (
        <div key={i}
          className={`log-line ${
            line.startsWith("✓") ? "t-green"  :
            line.startsWith("✗") ? "t-red"    :
            line.startsWith("⚠") ? "t-amber"  :
            line.startsWith("ℹ") ? "t-blue"   : "t-dim"
          }`}
          style={{ animationDelay: `${Math.min(i * 18, 180)}ms` }}>
          {line || "\u00a0"}
        </div>
      ))}
    </div>
  );
}

// ─── Step Result dispatcher ───────────────────────────────────────────────────

function StepResult({ index, state, chainStatus, transactions }: {
  index: number; state: StepState;
  chainStatus: ChainStatusResponse | null; transactions: ChainTxResponse | null;
}) {
  if (index === 0) return <Step0Result chainStatus={chainStatus} transactions={transactions} />;

  if (index === 1) {
    const burn = state.data.burn as BurnResponse | undefined;
    return burn ? <TxCard label="Burn Complete" txHash={burn.txHash} lines={[
      `Burned: ${burn.burnedAmount.toLocaleString()} cvUSD`,
      `New total supply: ${burn.newSupply.toLocaleString()} cvUSD`,
    ]} color="green" /> : null;
  }

  if (index === 2) {
    const actus = state.data.actus as DemoHealthResponse | undefined;
    const cre   = state.data.cre   as CRERunResponse    | undefined;
    const mint  = state.data.mint  as MintResponse      | undefined;
    return (
      <div className="space-y-3">
        {actus && <ActusPanel data={actus} />}
        {cre   && <CRETerminal result={cre} />}
        {mint  && mint.success && <TxCard label="Mint Confirmed" txHash={mint.txHash ?? null} lines={[
          `Minted: 100,000 cvUSD`,
          `Total supply: ${mint.newSupply?.toLocaleString()} cvUSD`,
        ]} color="green" />}
      </div>
    );
  }

  if (index === 3) {
    const cre   = state.data.cre   as CRERunResponse    | undefined;
    const actus = state.data.actus as DemoHealthResponse | undefined;
    return (
      <div className="space-y-3">
        {cre   && <CRETerminal result={cre} />}
        {actus && <ActusPanel data={actus} />}
      </div>
    );
  }

  if (index === 4) {
    const mintResult = state.data.mintResult as MintResponse | undefined;
    return mintResult ? <MintBlockedCard reason={mintResult.reason ?? "Unknown"} /> : null;
  }

  if (index === 5) {
    const cre   = state.data.cre   as CRERunResponse    | undefined;
    const actus = state.data.actus as DemoHealthResponse | undefined;
    return (
      <div className="space-y-3">
        {cre   && <CRETerminal result={cre} />}
        {actus && <ActusPanel data={actus} />}
      </div>
    );
  }

  if (index === 6) {
    const mint = state.data.mint as MintResponse | undefined;
    return (
      <div className="space-y-3">
        <MintAllowedCard />
        {mint && mint.success && <TxCard label="Mint Confirmed" txHash={mint.txHash ?? null} lines={[
          `Minted: 100,000 cvUSD`,
          `Deployer: ${mint.newBalance?.toLocaleString()} cvUSD`,
          `Total supply: ${mint.newSupply?.toLocaleString()} cvUSD`,
        ]} color="green" />}
      </div>
    );
  }

  return null;
}

// ─── Step 0 Result ────────────────────────────────────────────────────────────

function Step0Result({ chainStatus, transactions }: {
  chainStatus: ChainStatusResponse | null; transactions: ChainTxResponse | null;
}) {
  if (!chainStatus) return null;
  return (
    <div className="space-y-3">
      {/* Contract addresses */}
      <div className="gloss-inner p-4">
        <div className="section-label mb-3">{chainStatus.network} · ChainID {chainStatus.chainId}</div>
        <div className="space-y-2">
          {[
            ["ConvergeStablecoin (cvUSD)", chainStatus.stablecoinAddress],
            ["MultiAttributeRiskPolicy",   chainStatus.policyAddress],
            ["RiskConsumer",               chainStatus.consumerAddress],
            ["Deployer",                   chainStatus.deployerAddress],
          ].map(([label, addr]) => (
            <div key={label} className="flex items-center gap-3 text-xs">
              <span className="text-gray-400 flex-shrink-0" style={{ width: "180px" }}>{label}</span>
              <a href={`https://sepolia.etherscan.io/address/${addr}`} target="_blank" rel="noopener noreferrer"
                className="code-chip">{addr}</a>
            </div>
          ))}
        </div>
      </div>

      {/* Balances grid */}
      <div className="grid grid-cols-2 gap-2">
        <MetricTile label="Total Supply"     value={chainStatus.totalSupply.toLocaleString()} sub="cvUSD" level="safe" />
        <MetricTile label="Deployer Balance" value={chainStatus.deployerBalance.toLocaleString()} sub="cvUSD" level="safe" />
      </div>

      {/* Transactions */}
      {transactions && transactions.transactions.length > 0 && (
        <div className="gloss-inner p-4">
          <div className="section-label mb-3">Recent Transactions</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400">
                <th className="text-left py-2 pr-4 font-medium">Hash</th>
                <th className="text-left py-2 pr-4 font-medium">Function</th>
                <th className="text-left py-2 pr-4 font-medium">Time</th>
                <th className="text-center py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.transactions.slice(0, 5).map(tx => (
                <tr key={tx.hash} className="border-b border-gray-50">
                  <td className="py-2 pr-4">
                    <a href={`https://sepolia.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                      className="code-chip">{tx.hash.slice(0, 12)}…</a>
                  </td>
                  <td className="py-2 pr-4 text-gray-600">{tx.functionName.split("(")[0] || "transfer"}</td>
                  <td className="py-2 pr-4 text-gray-400">{new Date(Number(tx.timeStamp) * 1000).toLocaleString()}</td>
                  <td className="py-2 text-center">
                    <span className={tx.isError === "0" ? "text-emerald-600 font-bold" : "text-red-600 font-bold"}>
                      {tx.isError === "0" ? "✓" : "✗"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── ACTUS Panel ──────────────────────────────────────────────────────────────

function ActusPanel({ data }: { data: DemoHealthResponse }) {
  const h  = data.health;
  const th = data.thresholds;
  const open = h.mintGate === "OPEN";

  return (
    <div className="gloss-inner p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="section-label">
          ACTUS Simulation — Phase {data.phase}
          {data.overrideDescription && ` · ${data.overrideDescription}`}
        </span>
        <span className="text-xs text-gray-400">{data.contractCount} contracts · {data.totalACTUSEvents} events</span>
      </div>

      {/* Mint gate hero */}
      <div className={open ? "mint-hero-open" : "mint-hero-closed"} style={{ borderRadius: "10px" }}>
        <div className="p-4 text-center">
          <div className={`text-xl font-black tracking-tight ${open ? "text-emerald-700" : "text-red-700"}`}>
            {open ? "✅ MINTING ALLOWED" : "🛑 MINTING BLOCKED"}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Supply: {formatUSD(h.tokenSupply)} · Reserves: {formatUSD(h.totalReserves)}
          </div>
        </div>
      </div>

      {/* 4 gates */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {[
          { name: "Backing",     passed: h.backingPass,     value: `${h.backingPct}%`,           threshold: `≥ ${th.backingPct}%`,         reg: "GENIUS §4" },
          { name: "Liquidity",   passed: h.liquidityPass,   value: `${h.liquidityPct}%`,         threshold: `≥ ${th.liquidityPct}%`,       reg: "MiCA 54" },
          { name: "Risk Score",  passed: h.riskPass,        value: `${h.riskScore}/100`,         threshold: `≤ ${th.riskScore}`,           reg: "Composite" },
          { name: "Eligibility", passed: h.eligibilityPass, value: `${h.assetEligibilityPct}%`, threshold: `≥ ${th.assetEligibilityPct}%`, reg: "GENIUS §4(a)" },
        ].map((g, i) => (
          <div key={g.name}
            className={`rounded-xl border p-3 ${g.passed
              ? "bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-100"
              : "bg-gradient-to-br from-red-50 to-rose-50 border-red-100"}`}
            style={{ animationDelay: `${i * 60}ms` }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500 uppercase tracking-wide">{g.name}</span>
              <span className={`text-xs font-bold ${g.passed ? "text-emerald-600" : "text-red-600"}`}>
                {g.passed ? "✓" : "✗"}
              </span>
            </div>
            <div className={`text-lg font-black ${g.passed ? "text-emerald-700" : "text-red-700"}`}>{g.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{g.threshold}</div>
            <div className="text-xs text-gray-300 italic">{g.reg}</div>
          </div>
        ))}
      </div>

      {/* 8 metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MetricTile label="Backing"     value={fmtPct(h.backingPct)}           sub={`${formatUSD(h.totalReserves)} reserves`}                   level={backingLevel(h.backingPct)} />
        <MetricTile label="Liquidity"   value={fmtPct(h.liquidityPct)}         sub={`${formatUSD(h.cashReserves)} cash`}                        level={liquidityLevel(h.liquidityPct)} />
        <MetricTile label="Risk Score"  value={`${h.riskScore}`}               sub={h.riskScore <= 70 ? "Within limit" : "Above limit (70)"}    level={riskLevel(h.riskScore)} />
        <MetricTile label="Eligibility" value={fmtPct(h.assetEligibilityPct)} sub="GENIUS-permitted"                                             level={eligibilityLevel(h.assetEligibilityPct)} />
        <MetricTile label="WAM"         value={`${h.wamDays}d`}               sub="Weighted avg maturity"                                        level={h.wamDays <= 30 ? "safe" : h.wamDays <= 90 ? "warning" : "danger"} />
        <MetricTile label="Diversity"   value={`${h.custodianDiversityScore}`} sub="Custodian HHI"                                               level={diversityLevel(h.custodianDiversityScore)} />
        <MetricTile label="T-Bill %"    value={fmtPct(h.tbillPct)}            sub={formatUSD(h.tbillReserves)}                                   level={h.tbillPct <= 50 ? "safe" : "warning"} />
        <MetricTile label="Ineligible"  value={formatUSD(h.ineligibleReserves)} sub={h.ineligibleReserves === 0 ? "None — compliant" : "NON-GENIUS!"} level={h.ineligibleReserves === 0 ? "safe" : "danger"} />
      </div>

      <MaturityLadder entries={h.maturityLadder} />
    </div>
  );
}

// ─── Metric Tile ──────────────────────────────────────────────────────────────

function MetricTile({ label, value, sub, level }: {
  label: string; value: string; sub: string; level: "safe" | "warning" | "danger";
}) {
  const valueColor =
    level === "safe"    ? "#059669" :
    level === "warning" ? "#d97706" : "#dc2626";
  return (
    <div className="metric-tile p-3">
      <div className="section-label mb-1">{label}</div>
      <div className="text-xl font-black" style={{ color: valueColor }}>{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{sub}</div>
    </div>
  );
}

// ─── CRE Terminal ─────────────────────────────────────────────────────────────

function CRETerminal({ result }: { result: CRERunResponse }) {
  return (
    <div className="cre-box">
      <div className="cre-topbar">
        <div className="cre-dot" style={{ background: "#ff5f57" }} />
        <div className="cre-dot" style={{ background: "#febc2e" }} />
        <div className="cre-dot" style={{ background: "#28c840" }} />
        <span className="ml-2 text-xs font-mono text-gray-500">
          cre workflow simulate --target {result.target} --broadcast
        </span>
        <span className="ml-auto text-xs font-mono" style={{ color: result.success ? "#3fb950" : "#f85149" }}>
          exit {result.exitCode}
        </span>
      </div>
      <pre className="px-4 py-3 text-xs font-mono max-h-44 overflow-y-auto leading-relaxed whitespace-pre-wrap t-dim relative">
        <div className="crt-scan" />
        {result.output || "(no output)"}
      </pre>
    </div>
  );
}

// ─── Tx Card ──────────────────────────────────────────────────────────────────

function TxCard({ label, txHash, lines, color }: {
  label: string; txHash: string | null; lines: string[]; color: "green" | "red";
}) {
  return (
    <div className={color === "green" ? "tx-card-green p-4" : "tx-card-red p-4"}>
      <div className={`text-xs font-bold mb-2 ${color === "green" ? "text-emerald-700" : "text-red-700"}`}>
        {label}
      </div>
      {lines.map((l, i) => <div key={i} className="text-xs text-gray-600 mb-0.5">{l}</div>)}
      {txHash && (
        <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
          className="code-chip text-xs block break-all mt-2">{txHash}</a>
      )}
    </div>
  );
}

// ─── Mint Blocked / Allowed ───────────────────────────────────────────────────

function MintBlockedCard({ reason }: { reason: string }) {
  return (
    <div className="blocked-card p-6 text-center space-y-3">
      <div className="text-4xl font-black text-red-700">🛑 MINT BLOCKED</div>
      <div className="text-sm text-gray-600">
        Contract reverted with{" "}
        <code className="code-chip text-xs text-red-700">MintBlockedError</code>
      </div>
      <div className="inline-block px-4 py-2 rounded-xl text-sm font-semibold text-red-700"
        style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.18)" }}>
        "{reason}"
      </div>
      <div className="text-xs text-gray-400">On-chain enforcement · gas estimation revert · no tx broadcast</div>
    </div>
  );
}

function MintAllowedCard() {
  return (
    <div className="allowed-card p-6 text-center">
      <div className="text-4xl font-black text-emerald-700">✅ MINT ALLOWED</div>
      <div className="text-sm text-gray-600 mt-2">Phase C · All 4 policy gates PASS</div>
    </div>
  );
}

// ─── Maturity Ladder ─────────────────────────────────────────────────────────

function MaturityLadder({ entries }: { entries: MaturityEntry[] }) {
  const visible = entries.filter(e => e.principal > 0).sort((a, b) => a.daysToMaturity - b.daysToMaturity);
  if (visible.length === 0) return null;
  return (
    <div>
      <div className="section-label mb-2">Reserve Composition — Maturity Ladder</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 text-gray-400">
              <th className="text-left py-2 pr-3 font-medium">Contract</th>
              <th className="text-left py-2 pr-3 font-medium">Category</th>
              <th className="text-right py-2 pr-3 font-medium">Principal</th>
              <th className="text-right py-2 pr-3 font-medium">Maturity</th>
              <th className="text-center py-2 pr-3 font-medium">Liquid</th>
              <th className="text-center py-2 font-medium">GENIUS</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(e => (
              <tr key={e.contractID} className="border-b border-gray-50">
                <td className="py-2 pr-3 font-mono text-gray-700">{e.contractID}</td>
                <td className="py-2 pr-3"><CatBadge cat={e.category} /></td>
                <td className="py-2 pr-3 text-right font-mono text-gray-700">{formatUSD(e.principal)}</td>
                <td className="py-2 pr-3 text-right text-gray-500">{e.availableNow ? "now" : `${e.daysToMaturity}d`}</td>
                <td className="py-2 pr-3 text-center">
                  <span className={e.availableNow ? "text-emerald-600 font-bold" : "text-red-500"}>
                    {e.availableNow ? "✓" : "✗"}
                  </span>
                </td>
                <td className="py-2 text-center">
                  <span className={e.isGeniusEligible ? "text-emerald-600 font-bold" : "text-red-500"}>
                    {e.isGeniusEligible ? "✓" : "✗"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CatBadge({ cat }: { cat: string }) {
  const cls: Record<string, string> = {
    cash: "cat-cash", tbill: "cat-tbill", repo: "cat-repo", mmf: "cat-mmf",
  };
  return (
    <span className={`badge ${cls[cat] ?? "cat-other"}`} style={{ padding: "1px 6px", fontSize: "10px" }}>
      {cat}
    </span>
  );
}

export default App;
