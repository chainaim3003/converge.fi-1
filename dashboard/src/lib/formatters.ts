/**
 * V4 Formatting utilities.
 * All metrics are integer percentages (490 = 490%, 69 = 69%).
 * No bps conversion needed.
 */

/** Format integer percentage: 490 → "490%" */
export function fmtPct(value: number): string {
  return `${value}%`;
}

/** Format large numbers with commas: 490000 → "$490,000" */
export function formatUSD(value: number): string {
  return "$" + value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Format large numbers with abbreviation: 100000000 → "$100M" */
export function formatUSDShort(value: number): string {
  if (value >= 1_000_000_000) return "$" + (value / 1_000_000_000).toFixed(1) + "B";
  if (value >= 1_000_000) return "$" + (value / 1_000_000).toFixed(1) + "M";
  if (value >= 1_000) return "$" + (value / 1_000).toFixed(1) + "K";
  return "$" + value.toFixed(0);
}

/** Risk score to severity level */
export function riskLevel(score: number): "safe" | "warning" | "danger" {
  if (score <= 40) return "safe";
  if (score <= 70) return "warning";
  return "danger";
}

/** Backing % to severity level (V4: integer %) */
export function backingLevel(pct: number): "safe" | "warning" | "danger" {
  if (pct >= 150) return "safe";
  if (pct >= 100) return "warning";
  return "danger";
}

/** Liquidity % to severity level (V4: threshold is 30%) */
export function liquidityLevel(pct: number): "safe" | "warning" | "danger" {
  if (pct >= 50) return "safe";
  if (pct >= 30) return "warning";
  return "danger";
}

/** Asset eligibility to severity level (V4: must be 100%) */
export function eligibilityLevel(pct: number): "safe" | "warning" | "danger" {
  if (pct >= 100) return "safe";
  if (pct >= 80) return "warning";
  return "danger";
}

/** Custodian diversity to severity level */
export function diversityLevel(score: number): "safe" | "warning" | "danger" {
  if (score >= 70) return "safe";
  if (score >= 50) return "warning";
  return "danger";
}

/** Format ISO date string to short display: "Mar 7, 2026" */
export function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Format timestamp as relative time */
export function timeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
