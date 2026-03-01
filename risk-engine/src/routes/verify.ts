/**
 * POST /api/verify — Runs the 6-step StableCoin verification.
 */

import { Router, Request, Response } from "express";
import { StableCoinVerifier } from "../verifier/StableCoinVerifier";
import { isValidVerifyRequest } from "../utils/validation";

const router = Router();
const verifier = new StableCoinVerifier();

router.post("/verify", async (req: Request, res: Response) => {
  const validation = isValidVerifyRequest(req.body);
  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }

  try {
    const result = await verifier.verify(req.body.simulationId);
    const statusCode = result.overall === "pass" ? 200 : 422;
    res.status(statusCode).json(result);
  } catch (error: any) {
    res.status(500).json({
      error: "Verification failed",
      details: error.message,
    });
  }
});

export default router;
