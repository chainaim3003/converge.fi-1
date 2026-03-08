# converge.fi-1-125 — Full Run Guide

---

## PRE-REQUISITES

- ACTUS Docker must be running on ports `8082`, `8083`, `27018`
- Bun installed globally
- Node.js + npm installed
- CRE CLI installed globally (`cre` command available)
- Hardhat available via `npx`

---

## STEP 1 — Root project setup

```cmd
cd C:\CHAINAIM3003\mcp-servers\ChainlinkConvergence\converge.fi-1-125
```

```cmd
copy .env.example .env
```

```cmd
npm install
```

### Fix: CRE Javy plugin (one-time setup — required before any `cre workflow simulate`)

```cmd
bun x cre-setup
```

> Expected output: `✅ CRE TS SDK is ready to use.`
> Without this, every `cre workflow simulate` command will fail with WASM build error.

---

## STEP 2 — Compile contracts

```cmd
npx hardhat compile
```

---

## STEP 3 — Set forwarder on Sepolia (contracts already deployed)

```cmd
npx hardhat run scripts/setForwarder.ts --network sepolia
```

---

## STEP 4 — Verify on-chain setup

```cmd
npx hardhat run scripts/verifySetup.ts --network sepolia
```

---

## STEP 5 — Risk Engine setup

```cmd
cd C:\CHAINAIM3003\mcp-servers\ChainlinkConvergence\converge.fi-1-125\risk-engine
```

```cmd
copy .env.example .env
```

> Edit `risk-engine\.env` and set `DEMO_DIR` to your local `iter-fin-demo-1` directory path.

```cmd
npm install
```

```cmd
npm run dev
```

> Risk engine now running on `http://localhost:3001` — keep this terminal open.

---

## STEP 6 — Test risk engine is working

```cmd
curl.exe -X POST http://localhost:3001/api/v1/cre-report -H "Content-Type: application/json" -d "{\"simulationId\":\"StableCoin-BackingRatio-RedemptionPressure-30d\",\"scenarioId\":\"sc_depeg_stress_scn01\"}"
```

```cmd
curl http://localhost:3001/api/health
```

```cmd
curl http://localhost:3001/api/demo/health-check
```

```cmd
curl "http://localhost:3001/api/demo/health-check?phase=B"
```

```cmd
curl "http://localhost:3001/api/demo/health-check?phase=C"
```

---

## STEP 7 — Dashboard setup (new terminal)

```cmd
cd C:\CHAINAIM3003\mcp-servers\ChainlinkConvergence\converge.fi-1-125\dashboard
```

```cmd
npm install
```

```cmd
npm run dev
```

> Dashboard now running on `http://localhost:5173` — keep this terminal open.

---

## STEP 8 — CRE Workflow setup (new terminal)

```cmd
cd C:\CHAINAIM3003\mcp-servers\ChainlinkConvergence\converge.fi-1-125\workflows\risk-monitoring
```

```cmd
npm install
```

> Note: `npm install` here runs `bun x cre-setup` automatically via `postinstall` script in `package.json`.
> If it does not run automatically, run it manually:

```cmd
bun x cre-setup
```

---

## STEP 9 — Run CRE workflows (risk-monitoring)

All commands run from:
```cmd
cd C:\CHAINAIM3003\mcp-servers\ChainlinkConvergence\converge.fi-1-125
```

```cmd
cre workflow simulate workflows/risk-monitoring --target local-simulation --broadcast
```

```cmd
cre workflow simulate workflows/risk-monitoring --target approach3 --broadcast
```

```cmd
cre workflow simulate workflows/risk-monitoring --target asset-quality --broadcast
```

```cmd
cre workflow simulate workflows/risk-monitoring --target maturity-ladder --broadcast
```

```cmd
cre workflow simulate workflows/risk-monitoring --target compliance-drift --broadcast
```

```cmd
cre workflow simulate workflows/risk-monitoring --target concentration-drift --broadcast
```

```cmd
cre workflow simulate workflows/risk-monitoring --target early-warning --broadcast
```

---

## STEP 10 — Run other CRE workflows

```cmd
cre workflow simulate workflows/reserve-health-check --broadcast
```

```cmd
cre workflow simulate workflows/privacy-reserve-check --broadcast
```

```cmd
cre workflow simulate workflows/vlei-ai-risk-agent --broadcast
```

---

## STEP 11 — Push risk report on-chain manually

From root:

```cmd
cd C:\CHAINAIM3003\mcp-servers\ChainlinkConvergence\converge.fi-1-125
```

**Push healthy report (mint ALLOWED):**
```cmd
npx hardhat run scripts/push-report.ts --network sepolia
```

**Push unhealthy — backing too low:**
```cmd
set REPORT_MODE=unhealthy-backing
npx hardhat run scripts/push-report.ts --network sepolia
```

**Push unhealthy — liquidity too low:**
```cmd
set REPORT_MODE=unhealthy-liquidity
npx hardhat run scripts/push-report.ts --network sepolia
```

**Push unhealthy — risk score too high:**
```cmd
set REPORT_MODE=unhealthy-score
npx hardhat run scripts/push-report.ts --network sepolia
```

---

## STEP 12 — Full demo lifecycle (MINT → HALT → RESTORE)

From root:

```cmd
cd C:\CHAINAIM3003\mcp-servers\ChainlinkConvergence\converge.fi-1-125
npx hardhat run scripts/demo-full-lifecycle.ts --network sepolia
```

---

## STEP 13 — Simulate cron (keeps on-chain report fresh)

```cmd
cd C:\CHAINAIM3003\mcp-servers\ChainlinkConvergence\converge.fi-1-125
.\scripts\simulate-cron.ps1
```

Every 5 minutes instead:

```cmd
.\scripts\simulate-cron.ps1 -IntervalMinutes 5
```

---

## STEP 14 — Simulate random mints

```cmd
cd C:\CHAINAIM3003\mcp-servers\ChainlinkConvergence\converge.fi-1-125
npx ts-node scripts/simulate-mint.ts
```

---

## STEP 15 — Mint tokens manually via Hardhat console

```cmd
npx hardhat console --network sepolia
```

Inside the console:

```javascript
const s = await ethers.getContractAt("ConvergeStablecoin", "0x8D8131547Ec5Cb2fF1bB941a28fA20e347A928F3")
const [w] = await ethers.getSigners()
await s.mint(w.address, ethers.parseEther("1000"))
await s.balanceOf(w.address)
```

---

## FULL DEMO — 4 Terminals Together

| Terminal | Directory | Command | Purpose |
|---|---|---|---|
| 1 | `risk-engine/` | `npm run dev` | Risk engine on port 3001 |
| 2 | root | `.\scripts\simulate-cron.ps1` | Fires WF1 every 10 min |
| 3 | root | `npx ts-node scripts/simulate-mint.ts` | Random mints every 1–5 min |
| 4 | root | `npx hardhat run scripts/demo-full-lifecycle.ts --network sepolia` | Full MINT → HALT → RESTORE demo |

---

## Deployed Contract Addresses (Ethereum Sepolia — March 3, 2026)

| Contract | Address |
|---|---|
| ConvergeStablecoin | `0x8D8131547Ec5Cb2fF1bB941a28fA20e347A928F3` |
| RiskConsumerWithACE | `0x3dC77FE8f9A29036306561800d05bcD2375a2F58` |
| BackingRatioPolicy | `0x19bAfAcEe772a516271C7c2651703663b18137e2` |
| LiquidityRatioPolicy | `0xB8b6c105e3BF22aFfF16fC53A0Cdecb14D2Ea1F3` |
| RiskScorePolicy | `0x0Da6d451b0340fa32E85cDfCE043f1c573b4036d` |

**Etherscan:**
```
https://sepolia.etherscan.io/token/0x8D8131547Ec5Cb2fF1bB941a28fA20e347A928F3
```
