/**
 * Formatting utilities for dashboard display.
 */

/** Convert basis points to percentage string: 10200 → "102.00%" */
export function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2) + "%";
}

/** Format large numbers with commas: 100000000 → "$100,000,000" */
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

/** Backing ratio to severity level (basis points) */
export function backingLevel(bps: number): "safe" | "warning" | "danger" {
  if (bps >= 10500) return "safe";      // 105%+
  if (bps >= 10000) return "warning";   // 100-105%
  return "danger";                       // <100%
}

/** Liquidity ratio to severity level (basis points) */
export function liquidityLevel(bps: number): "safe" | "warning" | "danger" {
  if (bps >= 2000) return "safe";       // 20%+
  if (bps >= 1000) return "warning";    // 10-20%
  return "danger";                       // <10%
}

/** Format timestamp as relative time: "2m ago", "1h ago" */
export function timeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/** Format ISO date string to short display: "Mar 7, 2026" */
export function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Format ISO date string to time: "14:32" */
export function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}
