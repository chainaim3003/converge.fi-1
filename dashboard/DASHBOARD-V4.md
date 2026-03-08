# Converge.fi V4 Dashboard — Setup & Run

## What Changed

The dashboard was rewritten for the V4 data model:

| File | Change |
|------|--------|
| `src/lib/api.ts` | V4 types. Primary endpoint: `GET /api/demo/health-check?phase=A\|B\|C`. Old bps types removed. |
| `src/lib/formatters.ts` | Integer % (no bps→% conversion). New level functions for eligibility, diversity. |
| `src/App.tsx` | Complete rewrite. Single-page layout driven by one API call per phase. |
| `src/components/shared/*` | **Unchanged** — Card, MetricBadge, LoadingSpinner, StatusIndicator. |
| `src/main.tsx` | **Unchanged** — still renders `<App />`. |
| `vite.config.ts` | **Unchanged** — proxy `/api → localhost:3001`. |
| `tailwind.config.ts` | **Unchanged** — `converge-*` colors intact. |

Old panel files (`ReserveHealthPanel.tsx`, `MintBlockStatus.tsx`, etc.) and old hooks (`useRiskData.ts`, `useSimulation.ts`) are still on disk but NOT imported. They can be deleted.

## Data Flow

```
User clicks Phase A/B/C
     │
     ▼
GET /api/demo/health-check?phase=A
     │  (Vite proxy → localhost:3001)
     ▼
risk-engine/src/routes/demo.ts
     │  reads base_portfolio.json
     │  applies phase override
     │  calls ACTUS 34.203.247.32:8083/eventsBatch
     │  computeHealthFromPortfolio() → 8 metrics
     ▼
JSON response: { phase, health, forwardSimulation, thresholds, timestamp }
     │
     ▼
Dashboard renders: Mint Gate → 4 Gates → 8 Metrics → Maturity Ladder → ACTUS Contracts
```

**ONE API call drives the entire UI. No mocks. No fallbacks.**

## Prerequisites

1. **ACTUS server** running at `34.203.247.32:8082` and `34.203.247.32:8083`
2. **Risk-engine** running at `localhost:3001`
3. **Demo data** in the `iter-fin-demo-2/` directory (DEMO_DIR env var)

## Run Steps

```bash
# Terminal 1: Start risk-engine
cd converge.fi-1/risk-engine
npm run dev
# Expect: "Risk engine listening on port 3001"

# Terminal 2: Start dashboard
cd converge.fi-1/dashboard
npm install   # first time only
npm run dev
# Expect: "VITE v5.x.x ready at http://localhost:5173"
```

Open `http://localhost:5173` in your browser.

## Demo Sequence (for video)

1. **Click Phase A** → All green. Mint ALLOWED. 490% backing, 69% liquidity, risk score 0.
2. **Click Phase B** → Red. Mint BLOCKED. 3 gates fail (liquidity 4%, risk score 71, eligibility 57%).
3. **Click Phase C** → Green again. Mint ALLOWED. Restored with 182% backing, 59% liquidity, score 9.

This maps directly to the 3-minute video storyboard from the design document.

## What the UI Shows

- **Mint Gate Hero**: Large ✅ MINTING ALLOWED or 🛑 MINTING BLOCKED
- **4 Hard Gates**: Backing (GENIUS Act), Liquidity (MiCA), Risk Score, Eligibility (GENIUS Act)
- **8 Metrics Grid**: Backing, Liquidity, Risk Score, WAM, Eligibility, Custodian Diversity, T-Bill %, Ineligible Assets
- **Maturity Ladder**: Every contract with principal, custodian, days to maturity, GENIUS eligibility
- **ACTUS Forward Simulation**: Contract-level IED/MD events from the ACTUS engine
