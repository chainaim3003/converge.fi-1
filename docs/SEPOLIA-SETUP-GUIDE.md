# Converge.fi — Ethereum Sepolia Testnet Setup Guide

> Based on analysis of the actual codebase at `C:\Asha\chainaim\mcpserver\CHAINLINK\converge.fi-1`
> Date: March 2, 2026

---

## 1. What is Ethereum Sepolia Testnet?

### 1.1 Ethereum Networks Explained

Ethereum has multiple networks. Think of them as copies of the same system running in parallel:

| Network | Chain ID | Real Money? | Purpose |
|---------|----------|-------------|---------|
| Ethereum Mainnet | 1 | Yes (real ETH) | Production — real transactions, real value |
| Sepolia Testnet | 11155111 | No (test ETH) | Development — free testing, no financial risk |
| Hardhat Network | 31337 | No (fake ETH) | Local — runs on your machine only, resets each time |

### 1.2 Why Sepolia?

Sepolia is Ethereum's **primary testnet** for developers. It mirrors mainnet behavior (same EVM, same transaction format, same gas mechanics) but uses **free test ETH** that has no real-world value.

Your `hardhat.config.ts` defines both networks:

```typescript
networks: {
    hardhat: {        // Local — used by `npx hardhat test`
        chainId: 31337,
    },
    sepolia: {        // Testnet — used by `npm run deploy:sepolia`
        url: SEPOLIA_RPC_URL,
        accounts: [PRIVATE_KEY],
        chainId: 11155111,
    },
},
```

When you ran `npx hardhat test`, all 38 tests ran on the **local Hardhat Network** (chain 31337). It spins up a temporary blockchain in memory, runs the tests, and throws it away. Nothing is persisted.

When you run `npm run deploy:sepolia`, your contracts deploy to the **real Sepolia testnet**. They persist on-chain, are publicly visible on sepolia.etherscan.io, and stay there permanently.

### 1.3 How Your Code Connects to Sepolia

```
Your Machine                              Sepolia Network
─────────────                             ───────────────
hardhat.config.ts
    ↓
reads .env file
    ↓
SEPOLIA_RPC_URL ──── HTTP request ────→  Sepolia RPC Node (Alchemy/Infura)
PRIVATE_KEY     ──── signs transactions   (receives your signed transactions,
                                           broadcasts to Sepolia validators)
    ↓
deploy.ts runs
    ↓
5 contracts deployed on-chain ─────────→  Contracts live at permanent addresses
                                           Visible on sepolia.etherscan.io
```

---

## 2. How Many Wallets Do You Need?

### 2.1 Answer: ONE MetaMask Wallet

For the hackathon, you need **exactly 1 wallet** (1 MetaMask account).



| Role | What It Does | Who Is It? |
|------|-------------|------------|
| **Owner/Deployer** | Deploys contracts, wires them together, grants permissions | Your MetaMask account |
| **CRE Forwarder** | Pushes risk reports on-chain (Chainlink automation) | Defaults to your account for testing |
| **Operator** | Authorized to call `mint()` | Auto-granted to deployer in constructor |
| **Depositor** | Calls `deposit()` to add collateral | Anyone (including your account) |
| **Risk Manager** | Views the dashboard (no on-chain interaction) | You (browser only, no wallet needed) |

### 2.2 Why One Wallet Handles Everything

Your deploy script explicitly collapses all roles onto the deployer:

```typescript
// From deploy.ts — CRE forwarder defaults to deployer
const creForwarderAddress = process.env.CRE_FORWARDER_ADDRESS || deployer.address;
```

```solidity
// From ConvergeStablecoin constructor — deployer auto-becomes operator
operators[msg.sender] = true;
```

```solidity
// From ConvergeStablecoin — owner can always mint (no operator check needed)
if (!operators[msg.sender] && msg.sender != owner()) {
    revert OnlyOperator(msg.sender);
}
```

So with one account you can: deploy, push risk reports, deposit, mint, burn, and perform all admin functions.

### 2.3 Comparison: Tests vs Production

In the test file, Hardhat creates 5 separate accounts to test access control:

```typescript
// From test/contracts.test.ts — 5 accounts for testing role separation
[owner, operator, user, creForwarder, outsider] = await ethers.getSigners();
```

These exist to verify that:
- Only the CRE forwarder can call `onReport()`
- Only operators can call `mint()`
- Outsiders get rejected

But on Sepolia for the hackathon demo, **your single account plays all the permitted roles**. The access control still works — it just allows your address through every gate.

### 2.4 Production vs Hackathon

| Scenario | Wallets Needed | Why |
|----------|---------------|-----|
| **Hackathon (your case)** | 1 | Single deployer = owner + forwarder + operator |
| **Production** | 3+ | Separate: deployer/admin (multisig), Chainlink DON (CRE forwarder), operator (treasury team) |

---

## 3. Step-by-Step: Setting Up Your Wallet

### Step 1: Install MetaMask

If you don't have it:
1. Go to metamask.io
2. Install the browser extension (Chrome/Firefox/Brave)
3. Create a new wallet — **save your seed phrase securely**

### Step 2: Add Sepolia Network to MetaMask

MetaMask usually includes Sepolia by default. If not:

1. Open MetaMask → Click the network dropdown (top left)
2. Click "Show test networks" or "Add network"
3. Add these details:

| Field | Value |
|-------|-------|
| Network Name | Sepolia |
| RPC URL | `https://rpc.sepolia.org` |
| Chain ID | `11155111` |
| Currency Symbol | `SepoliaETH` |
| Block Explorer | `https://sepolia.etherscan.io` |

### Step 3: Get Free Sepolia Test ETH

You need test ETH to pay for gas (transaction fees). Test ETH is free:

| Faucet | URL | How Much |
|--------|-----|----------|
| Google Cloud Faucet | cloud.google.com/application/web3/faucet/ethereum/sepolia | 0.05 ETH/day |
| Alchemy Faucet | sepoliafaucet.com | 0.5 ETH/day (needs free Alchemy account) |
| Infura Faucet | infura.io/faucet/sepolia | 0.5 ETH/day |
| Chainlink Faucet | faucets.chain.link | 0.1 ETH (also gives LINK tokens) |

**Recommended:** Use the Alchemy faucet — 0.5 ETH is more than enough for deploying all 5 contracts (total cost ~0.01-0.05 ETH in gas).

### Step 4: Get a Reliable RPC URL

The default `https://rpc.sepolia.org` works but can be slow or rate-limited. For reliable access:

**Option A: Alchemy (recommended)**
1. Go to alchemy.com → sign up (free)
2. Create an app → select "Ethereum" → "Sepolia"
3. Copy the HTTPS URL (looks like `https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY`)

**Option B: Infura**
1. Go to infura.io → sign up (free)
2. Create a project → copy Sepolia endpoint

### Step 5: Export Your Private Key from MetaMask

1. Open MetaMask
2. Click the three dots next to your account name
3. Click "Account Details"
4. Click "Show Private Key"
5. Enter your MetaMask password
6. Copy the private key (starts with `0x`)

**CRITICAL: Never share this key. Never commit it to git. Never post it anywhere.**

### Step 6: Create Your `.env` File

In your project root (`C:\Asha\chainaim\mcpserver\CHAINLINK\converge.fi-1`):

1. Copy the example:
```powershell
copy .env.example .env
```

2. Open `.env` in a text editor and fill in:

```env
# Your Sepolia RPC endpoint
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY

# Your MetaMask private key (with 0x prefix)
PRIVATE_KEY=0xYOUR_ACTUAL_PRIVATE_KEY_HERE

# Etherscan API key (optional — for contract verification)
ETHERSCAN_API_KEY=your_etherscan_api_key

# Leave blank — defaults to your deployer address for hackathon
CRE_FORWARDER_ADDRESS=
```

**The `.env` file is already in `.gitignore`** — it will NOT be committed to git. This is correct and intentional.

### Step 7: Verify Your Setup

Before deploying, verify everything is connected:

```powershell
npx hardhat console --network sepolia
```

Then in the console:

```javascript
const [deployer] = await ethers.getSigners();
console.log("Address:", deployer.address);
const balance = await deployer.provider.getBalance(deployer.address);
console.log("Balance:", ethers.formatEther(balance), "ETH");
```

You should see your MetaMask address and a non-zero balance. Type `.exit` to leave the console.

---

## 4. Deploying to Sepolia

Once your `.env` is configured and you have test ETH:

```powershell
npm run deploy:sepolia
```

This runs `scripts/deploy.ts` which does the following 10-step deployment:

```
Step 1:   Deploy BackingRatioPolicy    (threshold = 10000 bps = 100%)
Step 2:   Deploy LiquidityRatioPolicy  (threshold = 1000 bps = 10%)
Step 3:   Deploy RiskScorePolicy       (threshold = 70 out of 100)
Step 4:   Deploy RiskConsumerWithACE   (forwarder = your address)
Step 5:   Wire BackingRatioPolicy    → RiskConsumerWithACE
Step 6:   Wire LiquidityRatioPolicy  → RiskConsumerWithACE
Step 7:   Wire RiskScorePolicy       → RiskConsumerWithACE
Step 8:   Register all 3 policies in RiskConsumerWithACE
Step 9:   Deploy ConvergeStablecoin    ("Converge USD", "cvUSD", 1hr stale limit)
Step 10:  Wire ConvergeStablecoin    → all policies + consumer
```

**Total transactions:** 10 (5 deploys + 5 wiring calls)

**Estimated gas cost:** ~0.01-0.05 SepoliaETH total

After deployment, the script saves all contract addresses to `deployed-addresses.json`:

```json
{
  "network": "sepolia",
  "chainId": 11155111,
  "deployer": "0xYourAddress...",
  "contracts": {
    "BackingRatioPolicy": "0x...",
    "LiquidityRatioPolicy": "0x...",
    "RiskScorePolicy": "0x...",
    "RiskConsumerWithACE": "0x...",
    "ConvergeStablecoin": "0x..."
  }
}
```

---

## 5. Verifying on Etherscan (Optional but Recommended)

After deployment, you can verify your contracts on Sepolia Etherscan so anyone can read the source code:

```powershell
npx hardhat verify --network sepolia DEPLOYED_ADDRESS "Converge USD" "cvUSD" 3600
```

Replace `DEPLOYED_ADDRESS` with the actual address from `deployed-addresses.json`.

You need an Etherscan API key for this:
1. Go to etherscan.io → sign up
2. Go to API Keys → Create New API Key
3. Add it to your `.env` as `ETHERSCAN_API_KEY`

---

## 6. What Happens After Deployment

Once contracts are on Sepolia, here is how the system works with your single wallet:

```
YOUR ONE WALLET does everything:

1. PUSH RISK DATA (acting as CRE Forwarder)
   Your address calls RiskConsumerWithACE.onReport(encodedData)
   → Decodes the risk report
   → Updates BackingRatioPolicy, LiquidityRatioPolicy, RiskScorePolicy

2. DEPOSIT COLLATERAL (acting as Depositor)
   Your address calls ConvergeStablecoin.deposit{value: 0.01 ETH}()
   → Records the deposit
   → Emits DepositReceived event

3. MINT TOKENS (acting as Operator)
   Your address calls ConvergeStablecoin.mint(yourAddress, amount)
   → Checks staleness (< 1 hour since last report)
   → Checks Gate 1: backing ratio >= 100%
   → Checks Gate 2: liquidity ratio >= 10%
   → Checks Gate 3: risk score <= 70
   → All pass → mints cvUSD tokens to you

4. MONITOR (acting as Risk Manager)
   Your browser opens the dashboard
   → Reads ConvergeStablecoin.getMintStatus()
   → Reads RiskConsumerWithACE.getSystemHealth()
   → Displays all metrics, no wallet interaction needed
```

---

## 7. Quick Reference: Commands

| Action | Command |
|--------|---------|
| Compile contracts | `npx hardhat compile` |
| Run tests (local) | `npx hardhat test` |
| Start local node | `npx hardhat node` |
| Deploy to local | `npm run deploy:local` |
| Deploy to Sepolia | `npm run deploy:sepolia` |
| Open Hardhat console | `npx hardhat console --network sepolia` |
| Verify on Etherscan | `npx hardhat verify --network sepolia ADDRESS args...` |

---

## 8. Checklist Before Deploying

- [ ] MetaMask installed with Sepolia network added
- [ ] Sepolia test ETH received from faucet (at least 0.1 ETH)
- [ ] Alchemy or Infura RPC URL obtained
- [ ] Private key exported from MetaMask
- [ ] `.env` file created with `SEPOLIA_RPC_URL` and `PRIVATE_KEY`
- [ ] `npx hardhat compile` succeeds (12 files compiled)
- [ ] `npx hardhat test` passes (38/38 tests)
- [ ] Ready to run `npm run deploy:sepolia`

---

## 9. Security Reminders

- **NEVER** commit your `.env` file to git (it is already in `.gitignore`)
- **NEVER** share your private key with anyone
- **NEVER** use a mainnet private key for testnet development
- **CREATE** a dedicated development wallet — do not use your main MetaMask wallet that holds real funds
- Test ETH on Sepolia has **zero real-world value** — you cannot lose money on the testnet
