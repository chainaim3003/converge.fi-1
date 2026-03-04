/**
 * GET /api/portfolios — Lists configured portfolios from config/portfolios/
 */

import { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { config } from "../config";

const router = Router();

router.get("/portfolios", (_req: Request, res: Response) => {
  try {
    const portfoliosDir = config.portfoliosDir;

    if (!fs.existsSync(portfoliosDir)) {
      res.json({ count: 0, portfolios: [] });
      return;
    }

    const files = fs.readdirSync(portfoliosDir).filter((f) => f.endsWith(".json"));
    const portfolios = files.map((f) => {
      const content = fs.readFileSync(path.join(portfoliosDir, f), "utf-8");
      return JSON.parse(content);
    });

    res.json({ count: portfolios.length, portfolios });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to list portfolios", details: error.message });
  }
});

export default router;
