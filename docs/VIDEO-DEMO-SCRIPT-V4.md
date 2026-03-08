# Converge.fi — 2-Minute Video Demo Script

**"The Circuit Breaker That Never Sleeps"**

Total runtime: 2:00 · 8 segments matching the 8-slide deck
Each segment includes: VISUAL (what's on screen), VO (voiceover), and TIMING.

---

## SEGMENT 1 — Title (0:00 – 0:10)

**SLIDE:** Title card

**VO:**
> "Converge.fi. Autonomous reserve risk monitoring for stablecoins — built on ACTUS financial simulation, Chainlink CRE, and ACE on-chain enforcement."

**VISUAL:** Hold title card. Fade in the three technology pillars.

---

## SEGMENT 2 — The Problem (0:10 – 0:30)

**SLIDE:** The Problem (3 cards)

**VO:**
> "Today, stablecoin reserves are checked quarterly. Between audits, the market is blind. In March 2023, the SVB-USDC depeg happened in 48 hours — the last audit was 30 days stale.
>
> Worse: no one models maturity risk. A stablecoin can be 103% backed but only 1% liquid — if the T-bills don't mature before redemptions hit, it can't pay.
>
> And when things break, a human committee has to vote to halt minting. Manual processes fail at the speed of panic."

**VISUAL:** Highlight each card in sequence as the corresponding problem is spoken.

---

## SEGMENT 3 — The Solution (0:30 – 0:50)

**SLIDE:** The Solution: Converge.fi (3 layers)

**VO:**
> "Converge.fi replaces all three with automation.
>
> ACTUS — an ISO-grade financial standard — simulates every T-bill and cash position deterministically. Not AI, not a black box. Reproducible math.
>
> Chainlink CRE orchestrates hourly: calls ACTUS, computes 8 risk metrics, writes the signed report on-chain.
>
> ACE policy contracts enforce 4 hard gates. If any fail, minting reverts in the same transaction. No committee. No delay."

**VISUAL:** Highlight each layer card as it's mentioned. Brief pause on the ACE enforcement card for emphasis.

---

## SEGMENT 4 — Architecture (0:50 – 1:05)

**SLIDE:** Architecture diagram + data flow

**VO:**
> "Here's the pipeline. ACTUS on AWS simulates the T-bill portfolio. Express computes 8 metrics — backing, liquidity, risk score, maturity, eligibility, custodian diversity. CRE encodes 256 bytes and writes to Sepolia. When mint is called, ACE gates evaluate automatically."

**VISUAL:** Follow the 5-box pipeline left to right. Then briefly highlight the 5-step data flow below.

---

## SEGMENT 5 — 8 Metrics, 4 Gates (1:05 – 1:20)

**SLIDE:** 8 Metrics · 4 Hard Gates

**VO:**
> "Four hard gates individually block minting. Backing must be 100% — that's GENIUS Act. Liquidity 30% — MiCA. Risk score under 70. Asset eligibility must be exactly 100% — zero tolerance for non-permitted assets.
>
> Four soft metrics feed the composite: maturity gap, T-bill concentration, custodian diversity — that's the SVB lesson — and ineligible assets."

**VISUAL:** Point to each gate, then the soft metrics row. Close on the risk score formula.

---

## SEGMENT 6 — Live Demo (1:20 – 1:45)

**SLIDE:** Live Demo: Mint → Block → Restore (this is the demo video moment)

**VO:**
> "Now the demo. Phase A: the reserve is healthy. 490% backing across 5 custodians, 2 T-bills. Risk score: zero. Mint gate: open.
>
> Phase B: stress hits. Cash drained. A distressed corporate bond is added — that's an ineligible asset under GENIUS Act. Liquidity collapses to 4%. Risk score hits 71. Three of four gates fail. Minting is BLOCKED — automatically.
>
> Phase C: the issuer sells the corp bond at a 5% loss and injects $90K emergency cash. Liquidity recovers to 59%. All gates pass. Mint gate reopens. But the risk score is 9, not zero — custodian concentration from the rescue is still visible."

**VISUAL:** Switch to the live dashboard. Click Phase A (green). Click Phase B (red flash, BLOCKED). Click Phase C (amber, OPEN again). Show the maturity ladder table with real contract IDs from ACTUS.

**KEY MOMENT:** The transition from Phase A → Phase B — the moment the dashboard turns red and shows "MINTING BLOCKED" — is the dramatic beat. Hold it for 2 seconds.

---

## SEGMENT 7 — Why It's Superior (1:45 – 1:55)

**SLIDE:** Comparison table

**VO:**
> "Every row in this table is a dimension where Converge.fi is the only solution. Maturity modeling — only us. Asset eligibility — only us. Custodian diversity — only us. Regulatory grounding in actual legislation — only us."

**VISUAL:** Show the table. The Converge.fi column in blue stands out against the gray "None" and "Not checked" in the other columns.

---

## SEGMENT 8 — Closing (1:55 – 2:00)

**SLIDE:** Who It Helps + tagline

**VO:**
> "Issuers. Protocols. Regulators. Holders. Converge.fi — continuous risk, autonomous enforcement."

**VISUAL:** Quick scan of the 4 stakeholder rows. Close on the tagline: "Continuous Risk. Autonomous Enforcement."

---

## PRODUCTION NOTES

### Recording Approach

1. **Slides 1-5, 7-8**: Screen-record the PPTX in presentation mode
2. **Slide 6 (demo)**: Screen-record the live dashboard at `http://localhost:5173`
   - Risk-engine must be running (`cd risk-engine && npm run dev`)
   - Dashboard must be running (`cd dashboard && npm run dev`)
   - ACTUS at `34.203.247.32:8083` must be reachable
   - Click Phase A → wait 2 seconds → Phase B → hold 3 seconds → Phase C

### Voiceover

- Record separately for clean audio
- Total VO: ~400 words at ~200 wpm = 2:00
- Tone: confident, technical but accessible, no hype

### Key Dramatic Moments

| Time | What happens |
|------|-------------|
| 0:18 | "…happened in 48 hours" — pause for effect |
| 1:30 | Dashboard turns red — MINTING BLOCKED — hold the visual |
| 1:38 | "Risk score is 9, not zero" — the restored state isn't perfect, it's honest |
| 1:55 | "Only us" repeated 4x — the differentiation punch |

### Tools

- OBS Studio or QuickTime for screen recording at 1080p
- Audacity for voiceover
- DaVinci Resolve or iMovie for compositing

### Files Needed

- `converge-fi-v4-deck.pptx` — the 8-slide deck
- Dashboard running on `:5173` with risk-engine on `:3001`
- ACTUS reachable at `34.203.247.32:8083`
