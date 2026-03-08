/**
 * GET /api/chain/status      — Reads on-chain state from Ethereum Sepolia.
 * GET /api/chain/transactions — Returns last 10 txns from Etherscan Sepolia API.
 *
 * No mocks. No fallbacks. Real RPC + Real Etherscan.
 */

import { Router, Request, Response } from "express";
import { JsonRpcProvider, Contract, formatEther } from "ethers";
import axios from "axios";
import { config } from "../config";

const router = Router();

// ─── Minimal ABIs — only what this route needs ───────────────────────────────

const STABLECOIN_ABI = [
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function getMintStatus() view returns (bool mintAllowed, string reason, uint16 backingPct, uint16 liquidityPct, uint16 riskScore, uint256 staleAge)",
];

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
];

/** Chainlink LINK token on Ethereum Sepolia */
const LINK_SEPOLIA = "0x779877A7B0D9E8603169DdbD7836e478b4624789";

// ─── GET /api/chain/status ───────────────────────────────────────────────────

router.get("/chain/status", async (_req: Request, res: Response) => {
  if (!config.sepoliaRpcUrl) {
    res.status(500).json({ error: "SEPOLIA_RPC_URL not set in risk-engine/.env" });
    return;
  }
  if (!config.stablecoinAddress || !config.deployerAddress) {
    res.status(500).json({ error: "STABLECOIN_ADDRESS or DEPLOYER_ADDRESS not set in risk-engine/.env" });
    return;
  }

  try {
    const provider = new JsonRpcProvider(config.sepoliaRpcUrl);
    const stablecoin = new Contract(config.stablecoinAddress, STABLECOIN_ABI, provider);
    const link = new Contract(LINK_SEPOLIA, ERC20_ABI, provider);

    const [
      totalSupplyRaw,
      deployerBalanceRaw,
      mintStatusResult,
      linkBalanceRaw,
      blockNumber,
    ] = await Promise.all([
      stablecoin.totalSupply(),
      stablecoin.balanceOf(config.deployerAddress),
      stablecoin.getMintStatus(),
      link.balanceOf(config.deployerAddress),
      provider.getBlockNumber(),
    ]);

    res.json({
      totalSupply: Number(formatEther(totalSupplyRaw)),
      deployerBalance: Number(formatEther(deployerBalanceRaw)),
      mintAllowed: mintStatusResult.mintAllowed,
      mintReason: mintStatusResult.reason,
      onChainBacking: Number(mintStatusResult.backingPct),
      onChainLiquidity: Number(mintStatusResult.liquidityPct),
      onChainRiskScore: Number(mintStatusResult.riskScore),
      staleAge: Number(mintStatusResult.staleAge),
      linkBalance: Number(formatEther(linkBalanceRaw)),
      blockNumber,
      stablecoinAddress: config.stablecoinAddress,
      policyAddress: config.policyAddress,
      consumerAddress: config.consumerAddress,
      deployerAddress: config.deployerAddress,
      network: "Ethereum Sepolia",
      chainId: 11155111,
    });
  } catch (error: any) {
    console.error("[chain/status] Error:", error.message);
    res.status(500).json({ error: "Chain status read failed", details: error.message });
  }
});

// ─── GET /api/chain/transactions ─────────────────────────────────────────────

router.get("/chain/transactions", async (_req: Request, res: Response) => {
  if (!config.etherscanApiKey) {
    res.status(500).json({ error: "ETHERSCAN_API_KEY not set in risk-engine/.env" });
    return;
  }
  if (!config.stablecoinAddress) {
    res.status(500).json({ error: "STABLECOIN_ADDRESS not set in risk-engine/.env" });
    return;
  }

  try {
    const url =
      `https://api-sepolia.etherscan.io/api` +
      `?module=account&action=txlist` +
      `&address=${config.stablecoinAddress}` +
      `&page=1&offset=10&sort=desc` +
      `&apikey=${config.etherscanApiKey}`;

    const response = await axios.get(url, { timeout: 10000 });

    if (response.data.status !== "1" && response.data.message !== "No transactions found") {
      console.warn("[chain/transactions] Etherscan non-ok status:", response.data.message);
    }

    const txns = Array.isArray(response.data.result) ? response.data.result : [];

    res.json({
      transactions: txns.slice(0, 10).map((tx: any) => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: tx.value,
        functionName: tx.functionName || "",
        timeStamp: tx.timeStamp,
        isError: tx.isError,
        gasUsed: tx.gasUsed,
        confirmations: tx.confirmations,
      })),
      count: txns.length,
    });
  } catch (error: any) {
    console.error("[chain/transactions] Error:", error.message);
    res.status(500).json({ error: "Transaction history fetch failed", details: error.message });
  }
});

export default router;
