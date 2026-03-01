# Converge.fi — Lessons Learned

## ACTUS Integration
- Postman JSON `body.raw` is a STRING — must `JSON.parse()` before sending via code
- Steps MUST execute IN ORDER (each depends on previous MongoDB data)
- Port 8082 (risk data) ≠ 8083 (simulation engine) — different services
- ACTUS URLs from env vars ONLY — never hardcode

## Smart Contracts
- Contract deployment order matters — policies first, then RiskConsumer, then stablecoin
- Policies initialize with safe defaults so mint isn't blocked before first CRE run
- Staleness guard is the safety net — if CRE stops running, minting stops

## Architecture
- The risk engine is a circuit breaker, NOT a per-mint evaluator
- Off-chain computation runs on a schedule, on-chain state is always pre-computed
- Three policy gates catch different failure modes: insolvency, illiquidity, dangerous combinations
