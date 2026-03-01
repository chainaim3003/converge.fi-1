# Converge.fi — Todo

## Phase 1: Foundation + risk-engine ✅
- [x] Initialize project structure, package.json, hardhat.config.ts, .env.example
- [x] Build risk-engine core: config.ts, ACTUSClient.ts
- [x] Build routes: health.ts, simulate.ts, cre-report.ts
- [x] Build metrics computation: events → backingBps, liquidityBps, riskScore
- [ ] Copy 28 simulation JSONs into risk-engine/simulations/
- [ ] Test with curl against running ACTUS Docker
- [ ] Build /api/chat endpoint with Anthropic integration
- [ ] Build treasury simulation JSON (multi-contract: 4 T-bills + liability)

## Phase 2: Smart Contracts + CRE WF1
- [x] Contracts written — circuit breaker pattern
- [x] Hardhat tests written
- [x] Deployment script written (section 6.4 order)
- [ ] Deploy to Sepolia
- [ ] Build WF1 (risk-monitoring) — cron → risk-engine → on-chain
- [ ] Run `cre simulate` → verify report arrives on-chain

## Phase 3: Dashboard
- [x] Scaffold React + Vite + Tailwind
- [x] Build layout: AppShell, Sidebar, Header
- [x] Build left panels (7 components)
- [ ] Connect panels to risk-engine + on-chain reads
- [ ] Build right chat (4 components) — connect to /api/chat
- [ ] Verify: simulation runs → panels update → chat explains results

## Phase 4: Extension Tracks + Polish
- [ ] Build WF2 (reserve-health-check) for DeFi track
- [ ] Build WF3 (privacy) for Privacy track
- [ ] Build WF4 (AI risk agent) for CRE & AI track
- [ ] MCP server for Claude Desktop
- [ ] Polish: loading states, error handling, responsive layout
- [ ] Record 3-5 minute demo video
- [ ] Write README, submit
