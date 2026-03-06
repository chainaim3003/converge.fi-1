# Converge.fi — Command Reference

---

## 1. Build and Start Risk Engine

```powershell
cd C:\CHAINAIM3003\mcp-servers\ChainlinkConvergence\converge.fi-1\risk-engine
npm install
npm run build
npm run server
```

---

## 2. Test Risk Engine is Working (Gap 1 Check)

```powershell
curl.exe -X POST http://localhost:3001/api/v1/cre-report -H "Content-Type: application/json" -d "{\"simulationId\":\"StableCoin-BackingRatio-RedemptionPressure-30d\",\"scenarioId\":\"sc_depeg_stress_scn01\"}"
```

---

## 3. Run WF1 (CRE Workflow — fires immediately)

Risk engine must be running first (Step 1).

```powershell
cd C:\CHAINAIM3003\mcp-servers\ChainlinkConvergence\converge.fi-1\workflows\risk-monitoring
cre workflow simulate --target local-simulation --broadcast --config config.json workflow.ts
```

---

## 4. Verify On-Chain Setup

```powershell
cd C:\CHAINAIM3003\mcp-servers\ChainlinkConvergence\converge.fi-1
npx hardhat run scripts/verifySetup.ts --network sepolia
```

---

## 5. Push Healthy Report On-Chain (mint ALLOWED)

```powershell
cd C:\CHAINAIM3003\mcp-servers\ChainlinkConvergence\converge.fi-1
npx hardhat run scripts/push-report.ts --network sepolia
```

---

## 6. Push Unhealthy Reports On-Chain (mint BLOCKED)

**Backing too low (88% < 100% threshold):**
```powershell
$env:REPORT_MODE="unhealthy-backing"; npx hardhat run scripts/push-report.ts --network sepolia
```

**Liquidity too low (5% < 10% threshold):**
```powershell
$env:REPORT_MODE="unhealthy-liquidity"; npx hardhat run scripts/push-report.ts --network sepolia
```

**Risk score too high (85 > 70 threshold):**
```powershell
$env:REPORT_MODE="unhealthy-score"; npx hardhat run scripts/push-report.ts --network sepolia
```

---

## 7. Mint Tokens (run after Step 5)

```powershell
cd C:\CHAINAIM3003\mcp-servers\ChainlinkConvergence\converge.fi-1
npx hardhat console --network sepolia
```

Inside the console:

```javascript
const s = await ethers.getContractAt("ConvergeStablecoin", "0x8D8131547Ec5Cb2fF1bB941a28fA20e347A928F3")
const [w] = await ethers.getSigners()
await s.mint(w.address, ethers.parseEther("750"))
```

Check balance:

```javascript
await s.balanceOf(w.address)
```

---

## 8. Simulate Cron (keeps on-chain report fresh every 10 minutes)

Risk engine must be running first (Step 1).

```powershell
cd C:\CHAINAIM3003\mcp-servers\ChainlinkConvergence\converge.fi-1
.\scripts\simulate-cron.ps1
```

To change interval (e.g. every 5 minutes):

```powershell
.\scripts\simulate-cron.ps1 -IntervalMinutes 5
```

---

## 9. Run Continuous Randomised Mint Simulator

```powershell
cd C:\CHAINAIM3003\mcp-servers\ChainlinkConvergence\converge.fi-1
npx ts-node scripts/simulate-mint.ts
```

---

## 10. Full Demo — 4 Terminals Together

| Terminal | Command | Purpose |
|---|---|---|
| 1 | `cd risk-engine && npm run server` | Risk engine on port 3001 |
| 2 | `.\scripts\simulate-cron.ps1` | Fires WF1 every 10 min |
| 3 | `npx ts-node scripts/simulate-mint.ts` | Random mints every 1-5 min |
| 4 | `npx hardhat run scripts/verifySetup.ts --network sepolia` | Confirm on-chain state |

---

## 11. View Token Balance on Etherscan

```
https://sepolia.etherscan.io/token/0x8D8131547Ec5Cb2fF1bB941a28fA20e347A928F3
```

Click **Holders** tab to see wallet balances.
Click **Transactions** tab to see all mint transactions.

---

## Deployed Contract Addresses (Ethereum Sepolia — March 3 2026)

| Contract | Address |
|---|---|
| ConvergeStablecoin | `0x8D8131547Ec5Cb2fF1bB941a28fA20e347A928F3` |
| RiskConsumerWithACE | `0x3dC77FE8f9A29036306561800d05bcD2375a2F58` |
| BackingRatioPolicy | `0x19bAfAcEe772a516271C7c2651703663b18137e2` |
| LiquidityRatioPolicy | `0xB8b6c105e3BF22aFfF16fC53A0Cdecb14D2Ea1F3` |
| RiskScorePolicy | `0x0Da6d451b0340fa32E85cDfCE043f1c573b4036d` |
