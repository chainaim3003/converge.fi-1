/**
 * Converge.fi V4 Dashboard — E2E Narrative Flow (Glassmorphism Edition)
 *
 * Layout: Two-column side-by-side
 *   Left  (62%) — Step cards, scrollable
 *   Right (38%) — Live metrics panel, sticky
 *   ⇄ Swap button in persistent bar swaps columns, preference saved to localStorage
 *
 * Workflow logic: UNCHANGED. No mocks. No fallbacks. CRE never skipped.
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

  // Layout swap — default Mode B (metrics RIGHT), persisted
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

  // ─── Step runners — workflow logic unchanged, addTicker calls added ─────────

  const runStep0 = useCallback(async () => {
    patchStep(0, { status: "running", log: [], data: {} });
    try {
      appendLog(0, "Connecting to Ethereum Sepolia...");
      const [status, txns] = await Promise.all([fetchChainStatus(), fetchChainTransactions()]);
      setChainStatus(status); setTransactions(txns);
      appendLog(0, `✓ Block #${status.blockNumber} — ${status.network}`);
      appendLog(0, `✓ totalSupply: ${status.totalSupply.toLocaleString()} cvUSD`);
      appendLog(0, `✓ deployerBalance: ${status.deployerBalance.toLocaleString()} cvUSD`);
      appendLog(0, `✓ LINK balance: ${status.linkBalance.toFixed(4)} LINK`);
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

  // Guard against React StrictMode double-invoke in dev
  const step0Fired = useRef(false);
  useEffect(() => {
    if (step0Fired.current) return;
    step0Fired.current = true;
    runStep0();
  }, []); // eslint-disable-line

  // ─── Whether chain data is ready (Step 0 done) ────────────────────────────
  const chainReady = steps[0].status === "done";

  // ─── Steps column ────────────────────────────────────────────────────────────

  const StepsColumn = (
    <div className="flex-1 min-w-0 space-y-3">
      {STEP_META.map((meta, i) => (
        <React.Fragment key={i}>
          <StepCard
            index={i}
            meta={meta}
            state={steps[i]}
            isActive={currentStep === i}
            isEnabled={i <= currentStep}
            onRun={STEP_RUNNERS[i]}
            chainStatus={chainStatus}
            transactions={i === 0 ? transactions : null}
          />
          {i < 6 && (
            <div className={`step-connector h-3 w-0.5 ml-8 ${steps[i].status === "done" ? "step-connector-done" : ""}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );

  // ─── Metrics column ───────────────────────────────────────────────────────────

  const MetricsColumn = (
    <div
      className="flex-shrink-0"
      style={{
        width: "340px",
        position: "sticky",
        top: "96px",        // header (~56px) + bar (~40px)
        alignSelf: "flex-start",
        maxHeight: "calc(100vh - 112px)",
        overflowY: "auto",
      }}
    >
      <MetricsPanel chainStatus={chainStatus} refreshing={refreshing} ticker={ticker} chainReady={chainReady} />
    </div>
  );

  return (
    <div className="min-h-screen aurora-bg text-gray-100" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* ═══ HEADER ═══ */}
      <header className="glass-header sticky top-0 z-50 px-6 py-3">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl logo-glow flex items-center justify-center flex-shrink-0">
              <span className="text-white font-black text-sm tracking-tight">C</span>
            </div>
            <div>
              <div className="font-bold text-sm text-white tracking-tight">Converge.fi</div>
              <div className="text-xs" style={{ color: "rgba(148,163,184,0.7)" }}>
                Autonomous Reserve Risk Monitor · V4 · Ethereum Sepolia
              </div>
            </div>
          </div>

          <div className="flex items-center gap-5">
            {chainStatus && (
              <div className="flex items-center gap-2 text-xs">
                <div className="relative flex-shrink-0">
                  <div className={`w-2 h-2 rounded-full relative z-10 ${chainStatus.mintAllowed ? "bg-emerald-400" : "bg-red-400"}`} />
                  <div className={`sonar-ring absolute inset-0 rounded-full ${chainStatus.mintAllowed ? "sonar-ring-green" : "sonar-ring-red"}`} />
                </div>
                <span style={{ color: "rgba(148,163,184,0.8)" }}>Mint Gate:</span>
                <strong className={chainStatus.mintAllowed ? "text-emerald-400" : "text-red-400"}>
                  {chainStatus.mintAllowed ? "OPEN" : "CLOSED"}
                </strong>
              </div>
            )}
            <div className="text-xs px-2.5 py-1 rounded-full" style={{
              background: "rgba(99,102,241,0.12)",
              border: "1px solid rgba(99,102,241,0.25)",
              color: "rgba(165,180,252,0.9)",
            }}>
              Chainlink CRE
            </div>
          </div>
        </div>
      </header>

      {/* ═══ PERSISTENT BAR ═══ */}
      {chainStatus && (
        <PersistentBar
          status={chainStatus}
          refreshing={refreshing}
          metricsOnLeft={metricsOnLeft}
          onSwap={toggleLayout}
        />
      )}

      {/* ═══ TWO-COLUMN BODY ═══ */}
      <div
        className="max-w-screen-xl mx-auto px-4 py-6 flex gap-5 items-start"
        style={{ transition: "all 0.35s ease" }}
      >
        {metricsOnLeft ? (
          <>{MetricsColumn}{StepsColumn}</>
        ) : (
          <>{StepsColumn}{MetricsColumn}</>
        )}
      </div>
    </div>
  );
}

// ─── Persistent Bar ───────────────────────────────────────────────────────────

function PersistentBar({
  status, refreshing, metricsOnLeft, onSwap,
}: {
  status: ChainStatusResponse;
  refreshing: boolean;
  metricsOnLeft: boolean;
  onSwap: () => void;
}) {
  return (
    <div className="glass-bar px-6 py-2 sticky z-40" style={{ top: "56px" }}>
      <div className="max-w-screen-xl mx-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="font-semibold tracking-widest uppercase text-indigo-400" style={{ fontSize: "10px" }}>
          Live Chain
        </span>

        <BarStat label="Supply"   value={`${status.totalSupply.toLocaleString()} cvUSD`} />
        <BarStat label="Deployer" value={`${status.deployerBalance.toLocaleString()} cvUSD`} />
        <BarStat label="LINK"     value={status.linkBalance.toFixed(2)} />

        <div className="h-3 w-px" style={{ background: "rgba(255,255,255,0.08)" }} />

        <BarStat label="Backing"   value={`${status.onChainBacking}%`}   ok={status.onChainBacking >= 100} />
        <BarStat label="Liquidity" value={`${status.onChainLiquidity}%`} ok={status.onChainLiquidity >= 30} />
        <BarStat label="Risk"      value={`${status.onChainRiskScore}`}  ok={status.onChainRiskScore <= 70} />

        <div className={`px-2.5 py-0.5 rounded-full text-xs font-semibold`} style={{
          background: status.mintAllowed ? "rgba(52,211,153,0.10)" : "rgba(248,113,113,0.10)",
          border: `1px solid ${status.mintAllowed ? "rgba(52,211,153,0.20)" : "rgba(248,113,113,0.20)"}`,
          color: status.mintAllowed ? "#34d399" : "#f87171",
        }}>
          {status.mintAllowed ? "✓ MINT OPEN" : "✗ MINT CLOSED"}
        </div>

        {refreshing && <LoadingSpinner size="sm" />}

        <span className="ml-auto" style={{ color: "rgba(100,116,139,0.7)", fontSize: "11px" }}>
          Block #{status.blockNumber}
        </span>

        {/* Swap button */}
        <button
          onClick={onSwap}
          title={metricsOnLeft ? "Move metrics to right" : "Move metrics to left"}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all"
          style={{
            background: "rgba(99,102,241,0.10)",
            border: "1px solid rgba(99,102,241,0.25)",
            color: "rgba(165,180,252,0.9)",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "rgba(99,102,241,0.20)")}
          onMouseLeave={e => (e.currentTarget.style.background = "rgba(99,102,241,0.10)")}
        >
          <span style={{ fontSize: "13px" }}>⇄</span>
          <span>Swap</span>
        </button>
      </div>
    </div>
  );
}

function BarStat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <span style={{ color: "rgba(148,163,184,0.7)" }}>
      {label}:{" "}
      <strong className={ok === undefined ? "text-gray-200" : ok ? "text-emerald-400" : "text-red-400"}>
        {value}
      </strong>
    </span>
  );
}

// ─── Metrics Panel (right/left sticky column) ─────────────────────────────────

function MetricsPanel({
  chainStatus, refreshing, ticker, chainReady,
}: {
  chainStatus: ChainStatusResponse | null;
  refreshing: boolean;
  ticker: TickerEntry[];
  chainReady: boolean;
}) {
  return (
    <div className="space-y-3">

      {/* ── Section label ── */}
      <div className="flex items-center gap-2 px-1">
        <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: "rgba(99,102,241,0.8)" }}>
          Live Metrics
        </span>
        {refreshing && <LoadingSpinner size="sm" />}
      </div>

      {!chainStatus ? (
        <div className="glass-card rounded-2xl p-6 text-center">
          <LoadingSpinner size="sm" />
          <div className="text-xs mt-2" style={{ color: "rgba(148,163,184,0.5)" }}>Connecting...</div>
        </div>
      ) : (
        <>
          {/* ── Mint Gate Hero ── */}
          <div className={`glass-card rounded-2xl p-5 text-center ${chainStatus.mintAllowed ? "glass-card-done" : "glass-card-blocked"}`}>
            <div className="flex items-center justify-center gap-2 mb-1">
              <div className="relative">
                <div className={`w-3 h-3 rounded-full ${chainStatus.mintAllowed ? "bg-emerald-400" : "bg-red-400"}`} />
                <div className={`sonar-ring absolute inset-0 rounded-full ${chainStatus.mintAllowed ? "sonar-ring-green" : "sonar-ring-red"}`} />
              </div>
              <span className="text-xs uppercase tracking-widest" style={{ color: "rgba(148,163,184,0.6)" }}>Mint Gate</span>
            </div>
            <div className={`text-3xl font-black tracking-tight ${chainStatus.mintAllowed ? "text-emerald-400" : "text-red-400"}`}
              style={{ textShadow: chainStatus.mintAllowed ? "0 0 20px rgba(52,211,153,0.5)" : "0 0 20px rgba(248,113,113,0.5)" }}>
              {chainStatus.mintAllowed ? "OPEN" : "CLOSED"}
            </div>
            <div className="text-xs mt-1" style={{ color: "rgba(148,163,184,0.5)" }}>{chainStatus.mintReason}</div>
          </div>

          {/* ── 4 Policy Gates — only after chain setup completes ── */}
          <div className="glass-card rounded-2xl p-4 space-y-2">
            <div className="text-xs font-semibold tracking-widest uppercase mb-3" style={{ color: "rgba(99,102,241,0.7)" }}>
              Policy Gates
            </div>
            {!chainReady ? (
              <div className="py-6 text-center space-y-2">
                <div className="text-2xl">🔒</div>
                <div className="text-xs" style={{ color: "rgba(100,116,139,0.6)" }}>
                  Gates populate after<br />chain setup completes
                </div>
              </div>
            ) : (
              <>
                <MetricGateRow
                  name="Backing"
                  value={`${chainStatus.onChainBacking}%`}
                  passed={chainStatus.onChainBacking >= 100}
                  threshold="≥ 100%"
                  reg="GENIUS Act §4"
                />
                <MetricGateRow
                  name="Liquidity"
                  value={`${chainStatus.onChainLiquidity}%`}
                  passed={chainStatus.onChainLiquidity >= 30}
                  threshold="≥ 30%"
                  reg="MiCA Art.54"
                />
                <MetricGateRow
                  name="Risk Score"
                  value={`${chainStatus.onChainRiskScore}`}
                  passed={chainStatus.onChainRiskScore <= 70}
                  threshold="≤ 70"
                  reg="Composite"
                />
                <MetricGateRow
                  name="Eligibility"
                  value="—"
                  passed={chainStatus.mintAllowed}
                  threshold="≥ 100%"
                  reg="GENIUS Act §4(a)"
                />
              </>
            )}
          </div>

          {/* ── Balances ── */}
          <div className="glass-card rounded-2xl p-4 space-y-2">
            <div className="text-xs font-semibold tracking-widest uppercase mb-3" style={{ color: "rgba(99,102,241,0.7)" }}>
              Balances
            </div>
            <BalanceRow label="Total Supply"     value={`${chainStatus.totalSupply.toLocaleString()} cvUSD`} />
            <BalanceRow label="Deployer"          value={`${chainStatus.deployerBalance.toLocaleString()} cvUSD`} />
            <BalanceRow label="LINK"              value={`${chainStatus.linkBalance.toFixed(4)} LINK`} highlight={chainStatus.linkBalance < 1 ? "warn" : "ok"} />
            <BalanceRow label="Block"             value={`#${chainStatus.blockNumber}`} mono />
            <BalanceRow label="Network"           value={chainStatus.network} />
          </div>

          {/* ── Activity Ticker ── */}
          <div className="glass-card rounded-2xl p-4">
            <div className="text-xs font-semibold tracking-widest uppercase mb-3" style={{ color: "rgba(99,102,241,0.7)" }}>
              Activity
            </div>
            {ticker.length === 0 ? (
              <div className="text-xs py-4 text-center" style={{ color: "rgba(100,116,139,0.5)" }}>
                No events yet...
              </div>
            ) : (
              <div className="space-y-1.5">
                {ticker.map((entry, idx) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-2 text-xs fade-in-up rounded-lg px-2 py-1.5"
                    style={{
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.04)",
                      opacity: Math.max(0.35, 1 - idx * 0.08),
                    }}
                  >
                    <span className="flex-shrink-0 text-sm leading-none">{entry.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate" style={{ color: "rgba(203,213,225,0.85)" }}>{entry.text}</div>
                      <div className="font-mono" style={{ color: "rgba(100,116,139,0.6)", fontSize: "10px" }}>{entry.time}</div>
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

// ─── Metric Gate Row (in metrics panel) ──────────────────────────────────────

function MetricGateRow({ name, value, passed, threshold, reg }: {
  name: string; value: string; passed: boolean; threshold: string; reg: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2" style={{
      background: passed ? "rgba(52,211,153,0.05)" : "rgba(248,113,113,0.05)",
      border: `1px solid ${passed ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)"}`,
    }}>
      <span className={`text-base font-bold flex-shrink-0 ${passed ? "text-emerald-400" : "text-red-400"}`}>
        {passed ? "✓" : "✗"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs" style={{ color: "rgba(148,163,184,0.7)" }}>{name}</span>
          <span className={`text-sm font-bold shimmer-text ${passed ? "shimmer-safe" : "shimmer-danger"}`}>
            {value}
          </span>
        </div>
        <div className="flex justify-between text-xs mt-0.5">
          <span style={{ color: "rgba(100,116,139,0.6)" }}>{threshold}</span>
          <span style={{ color: "rgba(100,116,139,0.5)", fontStyle: "italic" }}>{reg}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Balance Row ──────────────────────────────────────────────────────────────

function BalanceRow({ label, value, highlight, mono }: {
  label: string; value: string; highlight?: "ok" | "warn"; mono?: boolean;
}) {
  const color =
    highlight === "warn" ? "#fbbf24" :
    highlight === "ok"   ? "#34d399" :
    "rgba(203,213,225,0.9)";

  return (
    <div className="flex items-center justify-between text-xs">
      <span style={{ color: "rgba(148,163,184,0.55)" }}>{label}</span>
      <span className={mono ? "font-mono" : "font-medium"} style={{ color }}>{value}</span>
    </div>
  );
}

// ─── Step Card ────────────────────────────────────────────────────────────────

function StepCard({
  index, meta, state, isActive, isEnabled, onRun, chainStatus, transactions,
}: {
  index: number;
  meta: (typeof STEP_META)[0];
  state: StepState;
  isActive: boolean;
  isEnabled: boolean;
  onRun: () => void;
  chainStatus: ChainStatusResponse | null;
  transactions: ChainTxResponse | null;
}) {
  const isRunning = state.status === "running";
  const isDone    = state.status === "done";
  const isError   = state.status === "error";
  const isBlocked = state.status === "blocked";
  const isPending = state.status === "pending";

  const cardClass = [
    "glass-card rounded-2xl overflow-hidden relative transition-all duration-300",
    isDone    ? "glass-card-done"    : "",
    isBlocked ? "glass-card-blocked" : "",
    isRunning ? "glass-card-running" : "",
    isError   ? "glass-card-error"   : "",
  ].join(" ");

  const numStyle: React.CSSProperties =
    isDone    ? { background: "linear-gradient(135deg,#059669,#34d399)", boxShadow: "0 0 14px rgba(52,211,153,0.45)" } :
    isBlocked ? { background: "linear-gradient(135deg,#dc2626,#f87171)", boxShadow: "0 0 14px rgba(248,113,113,0.45)" } :
    isError   ? { background: "linear-gradient(135deg,#dc2626,#f87171)", boxShadow: "0 0 12px rgba(248,113,113,0.35)" } :
    isRunning ? { background: "linear-gradient(135deg,#4338ca,#818cf8)", boxShadow: "0 0 16px rgba(99,102,241,0.6)"  } :
    isActive && isEnabled ? { background: "linear-gradient(135deg,#4f46e5,#6366f1)", boxShadow: "0 0 12px rgba(99,102,241,0.35)" } :
    { background: "rgba(255,255,255,0.06)", boxShadow: "none" };

  const statusBadge =
    isDone    ? <Badge color="green">✓ Done</Badge>      :
    isBlocked ? <Badge color="red">🛑 Blocked</Badge>    :
    isError   ? <Badge color="red">✗ Error</Badge>       :
    isRunning ? <Badge color="indigo">⟳ Running</Badge>  :
    <Badge color="dim">Pending</Badge>;

  const showButton = !meta.autoRun && isEnabled && (isPending || isError);

  return (
    <div className={cardClass}>
      {isDone    && <div className="border-sweep-line border-sweep-line-green" />}
      {isBlocked && <div className="border-sweep-line border-sweep-line-red" />}

      <div className="px-5 py-4 flex items-center gap-4">
        <div className="relative flex-shrink-0 w-9 h-9">
          {isRunning && <div className="ring-ping" style={{ background: "rgba(99,102,241,0.25)" }} />}
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white relative z-10" style={numStyle}>
            {isDone ? "✓" : isBlocked ? "!" : index}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-100">{meta.title}</span>
            {statusBadge}
          </div>
          <p className="text-xs mt-0.5" style={{ color: "rgba(148,163,184,0.6)" }}>{meta.subtitle}</p>
        </div>

        {showButton && (
          <button onClick={onRun} disabled={isRunning}
            className="btn-run flex-shrink-0 px-4 py-1.5 text-white text-xs font-semibold rounded-lg">
            Execute
          </button>
        )}
        {isRunning && <LoadingSpinner size="sm" />}
      </div>

      {state.log.length > 0 && (
        <div style={{ borderTop: "1px solid rgba(99,102,241,0.15)" }}>
          <TerminalLog lines={state.log} />
        </div>
      )}

      {(isDone || isBlocked) && Object.keys(state.data).length > 0 && (
        <div className="p-4 space-y-4 fade-in-up" style={{ borderTop: "1px solid rgba(99,102,241,0.12)" }}>
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
      style={{ background: "rgba(0,0,0,0.45)" }}>
      <div className="crt-scanline" />
      {lines.map((line, i) => (
        <div key={i}
          className={`log-line ${
            line.startsWith("✓") ? "terminal-green" :
            line.startsWith("✗") ? "terminal-red"   :
            line.startsWith("⚠") ? "terminal-amber" :
            line.startsWith("ℹ") ? "terminal-blue"  : "terminal-dim"
          }`}
          style={{ animationDelay: `${Math.min(i * 20, 200)}ms` }}>
          {line || "\u00a0"}
        </div>
      ))}
    </div>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({ color, children }: { color: "green" | "red" | "indigo" | "dim"; children: React.ReactNode }) {
  const styles = {
    green:  { background: "rgba(52,211,153,0.10)",  border: "1px solid rgba(52,211,153,0.25)",  color: "#34d399" },
    red:    { background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.25)", color: "#f87171" },
    indigo: { background: "rgba(99,102,241,0.12)",  border: "1px solid rgba(99,102,241,0.30)",  color: "#818cf8" },
    dim:    { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(148,163,184,0.5)" },
  }[color];
  return <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={styles}>{children}</span>;
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
      <div className="space-y-4">
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
      <div className="space-y-4">
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
      <div className="space-y-4">
        {cre   && <CRETerminal result={cre} />}
        {actus && <ActusPanel data={actus} />}
      </div>
    );
  }

  if (index === 6) {
    const mint = state.data.mint as MintResponse | undefined;
    return (
      <div className="space-y-4">
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
    <div className="space-y-4">
      <div className="glass-inner rounded-xl p-4">
        <div className="text-xs font-semibold tracking-widest uppercase mb-3" style={{ color: "rgba(129,140,248,0.8)" }}>
          {chainStatus.network} · ChainID {chainStatus.chainId}
        </div>
        <div className="space-y-2">
          {[
            ["ConvergeStablecoin (cvUSD)", chainStatus.stablecoinAddress],
            ["MultiAttributeRiskPolicy",   chainStatus.policyAddress],
            ["RiskConsumer",               chainStatus.consumerAddress],
            ["Deployer",                   chainStatus.deployerAddress],
          ].map(([label, addr]) => (
            <div key={label} className="flex items-center gap-3 text-xs">
              <span className="w-48 flex-shrink-0" style={{ color: "rgba(148,163,184,0.6)" }}>{label}</span>
              <a href={`https://sepolia.etherscan.io/address/${addr}`} target="_blank" rel="noopener noreferrer"
                className="code-chip text-indigo-300 hover:text-indigo-200">{addr}</a>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <GlassMetric label="Total Supply"     value={`${chainStatus.totalSupply.toLocaleString()}`}     sub="cvUSD · totalSupply()"       level="safe" />
        <GlassMetric label="Deployer Balance" value={`${chainStatus.deployerBalance.toLocaleString()}`} sub="cvUSD · balanceOf(deployer)"  level="safe" />
        <GlassMetric label="LINK Balance"     value={chainStatus.linkBalance.toFixed(2)}                 sub="LINK · CRE fees"              level={chainStatus.linkBalance > 1 ? "safe" : "warning"} />
      </div>

      {transactions && transactions.transactions.length > 0 && (
        <div className="glass-inner rounded-xl p-4">
          <div className="text-xs font-semibold tracking-widest uppercase mb-3" style={{ color: "rgba(129,140,248,0.8)" }}>
            Recent Transactions
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b" style={{ borderColor: "rgba(255,255,255,0.06)", color: "rgba(100,116,139,0.8)" }}>
                <th className="text-left py-1.5 pr-4">Hash</th>
                <th className="text-left py-1.5 pr-4">Function</th>
                <th className="text-left py-1.5 pr-4">Time</th>
                <th className="text-center py-1.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.transactions.slice(0, 5).map(tx => (
                <tr key={tx.hash} className="border-b" style={{ borderColor: "rgba(255,255,255,0.03)" }}>
                  <td className="py-1.5 pr-4">
                    <a href={`https://sepolia.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                      className="code-chip text-indigo-400 hover:text-indigo-300">{tx.hash.slice(0, 12)}…</a>
                  </td>
                  <td className="py-1.5 pr-4" style={{ color: "rgba(148,163,184,0.7)" }}>{tx.functionName.split("(")[0] || "transfer"}</td>
                  <td className="py-1.5 pr-4" style={{ color: "rgba(100,116,139,0.7)" }}>{new Date(Number(tx.timeStamp) * 1000).toLocaleString()}</td>
                  <td className="py-1.5 text-center">
                    <span className={tx.isError === "0" ? "terminal-green" : "terminal-red"}>{tx.isError === "0" ? "✓" : "✗"}</span>
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
    <div className="glass-inner rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: "rgba(129,140,248,0.8)" }}>
          ACTUS Simulation — Phase {data.phase}
          {data.overrideDescription && ` · ${data.overrideDescription}`}
        </span>
        <span className="text-xs" style={{ color: "rgba(100,116,139,0.7)" }}>
          {data.contractCount} contracts · {data.totalACTUSEvents} events
        </span>
      </div>

      <div className={`rounded-xl border-2 p-4 text-center ${open ? "mint-open-hero" : "mint-closed-hero"}`}>
        <div className={`text-2xl font-black tracking-tight ${open ? "text-emerald-400" : "text-red-400"}`}>
          {open ? "✅ MINTING ALLOWED" : "🛑 MINTING BLOCKED"}
        </div>
        <div className="text-xs mt-1" style={{ color: "rgba(148,163,184,0.6)" }}>
          Supply: {formatUSD(h.tokenSupply)} · Reserves: {formatUSD(h.totalReserves)}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <GateCard name="Backing"     passed={h.backingPass}     value={`${h.backingPct}%`}           threshold={`≥ ${th.backingPct}%`}         reg="GENIUS Act §4" />
        <GateCard name="Liquidity"   passed={h.liquidityPass}   value={`${h.liquidityPct}%`}         threshold={`≥ ${th.liquidityPct}%`}       reg="MiCA Art.54" />
        <GateCard name="Risk Score"  passed={h.riskPass}        value={`${h.riskScore}/100`}         threshold={`≤ ${th.riskScore}`}           reg="Composite" />
        <GateCard name="Eligibility" passed={h.eligibilityPass} value={`${h.assetEligibilityPct}%`} threshold={`≥ ${th.assetEligibilityPct}%`} reg="GENIUS Act §4(a)" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <GlassMetric label="Backing"     value={fmtPct(h.backingPct)}             sub={`${formatUSD(h.totalReserves)} reserves`}                           level={backingLevel(h.backingPct)} />
        <GlassMetric label="Liquidity"   value={fmtPct(h.liquidityPct)}           sub={`${formatUSD(h.cashReserves)} cash`}                                level={liquidityLevel(h.liquidityPct)} />
        <GlassMetric label="Risk Score"  value={`${h.riskScore}`}                 sub={h.riskScore <= 70 ? "Within limit" : "Above limit (70)"}            level={riskLevel(h.riskScore)} />
        <GlassMetric label="Eligibility" value={fmtPct(h.assetEligibilityPct)}   sub="GENIUS-permitted"                                                    level={eligibilityLevel(h.assetEligibilityPct)} />
        <GlassMetric label="WAM"         value={`${h.wamDays}d`}                  sub="Weighted avg maturity"                                              level={h.wamDays <= 30 ? "safe" : h.wamDays <= 90 ? "warning" : "danger"} />
        <GlassMetric label="Diversity"   value={`${h.custodianDiversityScore}`}   sub="Custodian HHI"                                                      level={diversityLevel(h.custodianDiversityScore)} />
        <GlassMetric label="T-Bill %"    value={fmtPct(h.tbillPct)}              sub={`${formatUSD(h.tbillReserves)}`}                                     level={h.tbillPct <= 50 ? "safe" : "warning"} />
        <GlassMetric label="Ineligible"  value={formatUSD(h.ineligibleReserves)} sub={h.ineligibleReserves === 0 ? "None — compliant" : "NON-GENIUS!"}    level={h.ineligibleReserves === 0 ? "safe" : "danger"} />
      </div>

      <MaturityLadder entries={h.maturityLadder} />
    </div>
  );
}

// ─── Gate Card ────────────────────────────────────────────────────────────────

function GateCard({ name, passed, value, threshold, reg }: {
  name: string; passed: boolean; value: string; threshold: string; reg: string;
}) {
  return (
    <div className={`gate-card rounded-xl border p-3 liquid-fill ${passed ? "gate-card-pass" : "gate-card-fail"}`}
      style={{ background: passed ? "rgba(52,211,153,0.06)" : "rgba(248,113,113,0.06)" }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs uppercase tracking-wide" style={{ color: "rgba(148,163,184,0.6)" }}>{name}</span>
        <span className={`text-sm font-bold ${passed ? "text-emerald-400" : "text-red-400"}`}>{passed ? "✓" : "✗"}</span>
      </div>
      <div className={`text-lg font-bold shimmer-text ${passed ? "shimmer-safe" : "shimmer-danger"}`}>{value}</div>
      <div className="text-xs mt-0.5" style={{ color: "rgba(100,116,139,0.7)" }}>≥ {threshold}</div>
      <div className="text-xs italic" style={{ color: "rgba(100,116,139,0.5)" }}>{reg}</div>
    </div>
  );
}

// ─── Glass Metric ─────────────────────────────────────────────────────────────

function GlassMetric({ label, value, sub, level }: {
  label: string; value: string; sub: string; level: "safe" | "warning" | "danger";
}) {
  const shimmerClass = level === "safe" ? "shimmer-safe" : level === "warning" ? "shimmer-warning" : "shimmer-danger";
  return (
    <div className="metric-glass rounded-xl p-3">
      <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "rgba(148,163,184,0.5)" }}>{label}</div>
      <div className={`text-xl font-bold shimmer-text ${shimmerClass}`}>{value}</div>
      <div className="text-xs mt-0.5" style={{ color: "rgba(100,116,139,0.65)" }}>{sub}</div>
    </div>
  );
}

// ─── CRE Terminal ─────────────────────────────────────────────────────────────

function CRETerminal({ result }: { result: CRERunResponse }) {
  return (
    <div className="cre-terminal">
      <div className="cre-terminal-header">
        <div className="cre-dot" style={{ background: "#ff5f57" }} />
        <div className="cre-dot" style={{ background: "#febc2e" }} />
        <div className="cre-dot" style={{ background: "#28c840" }} />
        <span className="ml-2 text-xs font-mono" style={{ color: "rgba(165,180,252,0.8)" }}>
          cre workflow simulate --target {result.target} --broadcast
        </span>
        <span className="ml-auto text-xs" style={{ color: result.success ? "rgba(52,211,153,0.8)" : "rgba(248,113,113,0.8)" }}>
          exit {result.exitCode}
        </span>
      </div>
      <pre className="px-4 py-3 text-xs font-mono max-h-44 overflow-y-auto leading-relaxed whitespace-pre-wrap"
        style={{ color: "rgba(148,163,184,0.75)" }}>
        {result.output || "(no output)"}
      </pre>
      <div className="crt-scanline" />
    </div>
  );
}

// ─── Tx Card ──────────────────────────────────────────────────────────────────

function TxCard({ label, txHash, lines, color }: {
  label: string; txHash: string | null; lines: string[]; color: "green" | "red";
}) {
  const borderColor = color === "green" ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)";
  const bg          = color === "green" ? "rgba(52,211,153,0.05)"  : "rgba(248,113,113,0.05)";
  const textColor   = color === "green" ? "#34d399" : "#f87171";
  return (
    <div className="rounded-xl p-4 space-y-2" style={{ border: `1px solid ${borderColor}`, background: bg }}>
      <div className="text-xs font-semibold" style={{ color: textColor }}>{label}</div>
      {lines.map((l, i) => <div key={i} className="text-xs" style={{ color: "rgba(148,163,184,0.75)" }}>{l}</div>)}
      {txHash && (
        <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
          className="code-chip text-indigo-400 hover:text-indigo-300 text-xs block break-all">{txHash}</a>
      )}
    </div>
  );
}

// ─── Mint Blocked Card ────────────────────────────────────────────────────────

function MintBlockedCard({ reason }: { reason: string }) {
  return (
    <div className="rounded-2xl border-2 p-6 text-center space-y-3 mint-closed-hero">
      <div className="text-4xl font-black text-red-400" style={{ textShadow: "0 0 20px rgba(248,113,113,0.5)" }}>
        🛑 MINT BLOCKED
      </div>
      <div className="text-sm" style={{ color: "rgba(148,163,184,0.7)" }}>
        Contract reverted with <code className="code-chip text-red-300 text-xs">MintBlockedError</code>
      </div>
      <div className="inline-block px-4 py-2 rounded-xl text-sm font-medium text-red-200"
        style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.25)" }}>
        "{reason}"
      </div>
      <div className="text-xs" style={{ color: "rgba(100,116,139,0.6)" }}>
        On-chain enforcement · gas estimation revert · no tx broadcast
      </div>
    </div>
  );
}

// ─── Mint Allowed Card ────────────────────────────────────────────────────────

function MintAllowedCard() {
  return (
    <div className="rounded-2xl border-2 p-6 text-center mint-open-hero">
      <div className="text-4xl font-black text-emerald-400" style={{ textShadow: "0 0 20px rgba(52,211,153,0.5)" }}>
        ✅ MINT ALLOWED
      </div>
      <div className="text-sm mt-2" style={{ color: "rgba(148,163,184,0.7)" }}>
        Phase C · All 4 policy gates PASS
      </div>
    </div>
  );
}

// ─── Maturity Ladder ─────────────────────────────────────────────────────────

function MaturityLadder({ entries }: { entries: MaturityEntry[] }) {
  const visible = entries.filter(e => e.principal > 0).sort((a, b) => a.daysToMaturity - b.daysToMaturity);
  if (visible.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold tracking-widest uppercase mb-2" style={{ color: "rgba(129,140,248,0.7)" }}>
        Reserve Composition — Maturity Ladder
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b" style={{ borderColor: "rgba(255,255,255,0.06)", color: "rgba(100,116,139,0.8)" }}>
              <th className="text-left py-1.5 pr-3">Contract</th>
              <th className="text-left py-1.5 pr-3">Category</th>
              <th className="text-right py-1.5 pr-3">Principal</th>
              <th className="text-right py-1.5 pr-3">Maturity</th>
              <th className="text-center py-1.5 pr-3">Liquid</th>
              <th className="text-center py-1.5">GENIUS</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(e => (
              <tr key={e.contractID} className="border-b" style={{ borderColor: "rgba(255,255,255,0.03)" }}>
                <td className="py-1.5 pr-3 font-mono" style={{ color: "rgba(203,213,225,0.8)" }}>{e.contractID}</td>
                <td className="py-1.5 pr-3"><CategoryBadge category={e.category} /></td>
                <td className="py-1.5 pr-3 text-right font-mono" style={{ color: "rgba(203,213,225,0.8)" }}>{formatUSD(e.principal)}</td>
                <td className="py-1.5 pr-3 text-right" style={{ color: "rgba(148,163,184,0.6)" }}>{e.availableNow ? "now" : `${e.daysToMaturity}d`}</td>
                <td className="py-1.5 pr-3 text-center">{e.availableNow ? <span className="terminal-green">✓</span> : <span className="terminal-red">✗</span>}</td>
                <td className="py-1.5 text-center">{e.isGeniusEligible ? <span className="terminal-green">✓</span> : <span className="terminal-red">✗</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Category Badge ───────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    cash:  { bg: "rgba(52,211,153,0.12)",  color: "#34d399" },
    tbill: { bg: "rgba(96,165,250,0.12)",  color: "#60a5fa" },
    repo:  { bg: "rgba(34,211,238,0.12)",  color: "#22d3ee" },
    mmf:   { bg: "rgba(99,102,241,0.12)",  color: "#818cf8" },
  };
  const s = map[category] ?? { bg: "rgba(248,113,113,0.12)", color: "#f87171" };
  return (
    <span className="px-1.5 py-0.5 rounded text-xs font-medium"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}22` }}>
      {category}
    </span>
  );
}

export default App;
