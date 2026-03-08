/**
 * POST /api/admin/burn     — Burns deployer's entire cvUSD balance via Sepolia.
 * POST /api/admin/mint     — Mints cvUSD to deployer; returns reason if blocked.
 * POST /api/admin/cre-run  — Spawns CRE CLI: cre workflow simulate --target <X> --broadcast
 *
 * Rules enforced here:
 *   - CRE is NEVER skipped. All admin risk-report pushes go through CRE CLI only.
 *   - No mocks. No fallbacks. Real transactions on Ethereum Sepolia.
 *   - Private key stays server-side in risk-engine/.env — never sent to the browser.
 */

import { Router, Request, Response } from "express";
import {
  JsonRpcProvider,
  Wallet,
  Contract,
  Interface,
  formatEther,
  parseEther,
} from "ethers";
import { exec } from "child_process";
import { config } from "../config";

const router = Router();

// ─── Minimal ABIs — only what admin routes need ───────────────────────────────

const STABLECOIN_ABI = [
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function burn(uint256 amount)",
  "function mint(address to, uint256 amount)",
  "error MintBlockedError(string reason)",
];

// ─── POST /api/admin/burn ─────────────────────────────────────────────────────

router.post("/admin/burn", async (_req: Request, res: Response) => {
  if (!config.sepoliaRpcUrl || !config.privateKey || !config.stablecoinAddress) {
    res.status(500).json({ error: "Missing SEPOLIA_RPC_URL / PRIVATE_KEY / STABLECOIN_ADDRESS in risk-engine/.env" });
    return;
  }

  try {
    const provider = new JsonRpcProvider(config.sepoliaRpcUrl);
    const wallet = new Wallet(config.privateKey, provider);
    const stablecoin = new Contract(config.stablecoinAddress, STABLECOIN_ABI, wallet);

    const balanceRaw = await stablecoin.balanceOf(config.deployerAddress);
    const balanceHuman = Number(formatEther(balanceRaw));

    if (balanceRaw === 0n) {
      const supplyRaw = await stablecoin.totalSupply();
      res.json({
        success: true,
        txHash: null,
        burnedAmount: 0,
        newSupply: Number(formatEther(supplyRaw)),
        message: "Deployer balance is already 0 — nothing to burn",
      });
      return;
    }

    console.log(`[admin/burn] Burning ${balanceHuman} cvUSD from deployer...`);

    const tx = await stablecoin.burn(balanceRaw);
    console.log(`[admin/burn] tx submitted: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`[admin/burn] confirmed in block ${receipt.blockNumber}`);

    const newSupplyRaw = await stablecoin.totalSupply();

    res.json({
      success: true,
      txHash: receipt.hash,
      burnedAmount: balanceHuman,
      newSupply: Number(formatEther(newSupplyRaw)),
      blockNumber: receipt.blockNumber,
    });
  } catch (error: any) {
    console.error("[admin/burn] Error:", error.message);
    res.status(500).json({ error: "Burn failed", details: error.message });
  }
});

// ─── POST /api/admin/mint ─────────────────────────────────────────────────────

router.post("/admin/mint", async (req: Request, res: Response) => {
  const { amount } = req.body;
  if (typeof amount !== "number" || amount <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }
  if (!config.sepoliaRpcUrl || !config.privateKey || !config.stablecoinAddress || !config.deployerAddress) {
    res.status(500).json({ error: "Missing chain config in risk-engine/.env" });
    return;
  }

  try {
    const provider = new JsonRpcProvider(config.sepoliaRpcUrl);
    const wallet = new Wallet(config.privateKey, provider);
    const stablecoin = new Contract(config.stablecoinAddress, STABLECOIN_ABI, wallet);

    console.log(`[admin/mint] Minting ${amount} cvUSD to deployer...`);

    const amountWei = parseEther(amount.toString());
    const tx = await stablecoin.mint(config.deployerAddress, amountWei);
    console.log(`[admin/mint] tx submitted: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`[admin/mint] confirmed in block ${receipt.blockNumber}`);

    const newBalanceRaw = await stablecoin.balanceOf(config.deployerAddress);
    const newSupplyRaw = await stablecoin.totalSupply();

    res.json({
      success: true,
      txHash: receipt.hash,
      mintedAmount: amount,
      newBalance: Number(formatEther(newBalanceRaw)),
      newSupply: Number(formatEther(newSupplyRaw)),
      blockNumber: receipt.blockNumber,
    });
  } catch (err: any) {
    // ─── Decode MintBlockedError ────────────────────────────────────────────
    let blocked = false;
    let reason = "Mint failed";

    try {
      // ethers v6: err.revert populated for known custom errors
      if (err.revert && err.revert.name === "MintBlockedError") {
        blocked = true;
        reason = String(err.revert.args[0]);
      } else if (err.data) {
        const iface = new Interface(["error MintBlockedError(string reason)"]);
        const parsed = iface.parseError(err.data);
        if (parsed) {
          blocked = true;
          reason = String(parsed.args[0]);
        }
      } else if (err.message && err.message.includes("MintBlockedError")) {
        blocked = true;
        // Extract reason from error message as fallback
        const match = err.message.match(/MintBlockedError\("([^"]+)"\)/);
        if (match) reason = match[1];
        else reason = err.message;
      }
    } catch (_parseErr) {
      // If parsing fails, use raw message
    }

    if (blocked) {
      console.log(`[admin/mint] Blocked — reason: ${reason}`);
      res.json({ success: false, blocked: true, reason });
    } else {
      console.error("[admin/mint] Error:", err.message);
      res.status(500).json({ success: false, blocked: false, error: err.message });
    }
  }
});

// ─── POST /api/admin/cre-run ──────────────────────────────────────────────────

/**
 * Spawns: cre workflow simulate workflows/risk-monitoring --target <target> --broadcast
 * cwd: PROJECT_ROOT (from risk-engine/.env)
 * env: process.env + CRE_ETH_PRIVATE_KEY
 *
 * Returns stdout/stderr so the UI can display the CRE execution log.
 * Timeout: 120 seconds (CRE needs time to call ACTUS + broadcast to Sepolia).
 */
router.post("/admin/cre-run", async (req: Request, res: Response) => {
  const { target } = req.body;

  if (!["demo-A", "demo-B", "demo-C"].includes(target)) {
    res.status(400).json({ error: "target must be one of: demo-A, demo-B, demo-C" });
    return;
  }
  if (!config.projectRoot) {
    res.status(500).json({ error: "PROJECT_ROOT not set in risk-engine/.env" });
    return;
  }
  if (!config.creEthPrivateKey) {
    res.status(500).json({ error: "CRE_ETH_PRIVATE_KEY not set in risk-engine/.env" });
    return;
  }

  const command = `cre workflow simulate workflows/risk-monitoring --target ${target} --broadcast`;
  const cwd = config.projectRoot;

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    CRE_ETH_PRIVATE_KEY: config.creEthPrivateKey,
  };

  console.log(`[admin/cre-run] Spawning: ${command}`);
  console.log(`[admin/cre-run] cwd: ${cwd}`);

  exec(
    command,
    {
      cwd,
      env: childEnv,
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 5, // 5 MB output buffer
    },
    (error, stdout, stderr) => {
      const combinedOutput = [stdout, stderr].filter(Boolean).join("\n").trim();

      if (error) {
        console.error(`[admin/cre-run] CRE exited with code ${error.code}:`, error.message);
        res.json({
          success: false,
          exitCode: error.code ?? 1,
          output: combinedOutput || error.message,
          error: error.message,
        });
        return;
      }

      console.log(`[admin/cre-run] CRE completed for target=${target}`);
      res.json({
        success: true,
        exitCode: 0,
        output: combinedOutput,
        target,
      });
    }
  );
});

export default router;
