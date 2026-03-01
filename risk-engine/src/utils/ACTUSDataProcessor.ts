/**
 * ACTUSDataProcessor — Event stream processing utilities.
 *
 * Processes raw ACTUS simulation events into structured data
 * suitable for dashboard charts and panels.
 */

import { ACTUSEvent, ACTUSEventType } from "../types";

/** Processed event with parsed time */
export interface ProcessedEvent extends ACTUSEvent {
  parsedTime: Date;
  dayIndex: number;    // 0-based day from start
}

/** Daily summary for charts */
export interface DailySummary {
  date: string;
  day: number;
  nominalValue: number;
  totalRedemption: number;
  eventCount: number;
  riskMetric?: number;
}

/**
 * Filter events by type.
 */
export function filterByType(events: ACTUSEvent[], type: ACTUSEventType): ACTUSEvent[] {
  return events.filter((e) => e.type === type);
}

/**
 * Process raw events: parse times, compute day indices.
 */
export function processEvents(events: ACTUSEvent[]): ProcessedEvent[] {
  if (events.length === 0) return [];

  const startTime = new Date(events[0].time).getTime();
  const msPerDay = 24 * 60 * 60 * 1000;

  return events.map((event) => {
    const parsedTime = new Date(event.time);
    const dayIndex = Math.floor((parsedTime.getTime() - startTime) / msPerDay);
    return { ...event, parsedTime, dayIndex };
  });
}

/**
 * Aggregate events into daily summaries for charts.
 */
export function computeDailySummaries(events: ACTUSEvent[]): DailySummary[] {
  const processed = processEvents(events);
  if (processed.length === 0) return [];

  const dailyMap = new Map<number, ProcessedEvent[]>();
  for (const event of processed) {
    const existing = dailyMap.get(event.dayIndex) || [];
    existing.push(event);
    dailyMap.set(event.dayIndex, existing);
  }

  const summaries: DailySummary[] = [];
  const days = Array.from(dailyMap.keys()).sort((a, b) => a - b);

  for (const day of days) {
    const dayEvents = dailyMap.get(day)!;
    const ppEvents = dayEvents.filter((e) => e.type === "PP" && Math.abs(e.payoff) > 0);
    const lastEvent = dayEvents[dayEvents.length - 1];

    summaries.push({
      date: dayEvents[0].time.substring(0, 10),
      day,
      nominalValue: lastEvent.nominalValue,
      totalRedemption: ppEvents.reduce((sum, e) => sum + Math.abs(e.payoff), 0),
      eventCount: dayEvents.length,
    });
  }

  return summaries;
}

/**
 * Extract key trajectory points for the risk timeline.
 * Identifies when thresholds are crossed.
 */
export function extractTrajectoryPoints(
  events: ACTUSEvent[],
  initialNotional: number = 100_000_000
): Array<{ day: number; date: string; label: string; nominalValue: number }> {
  const processed = processEvents(events);
  const points: Array<{ day: number; date: string; label: string; nominalValue: number }> = [];

  if (processed.length === 0) return points;

  // IED event
  const ied = processed.find((e) => e.type === "IED");
  if (ied) {
    points.push({
      day: ied.dayIndex,
      date: ied.time.substring(0, 10),
      label: "Contract initialized",
      nominalValue: ied.nominalValue,
    });
  }

  // First redemption
  const firstPP = processed.find((e) => e.type === "PP" && Math.abs(e.payoff) > 0);
  if (firstPP) {
    points.push({
      day: firstPP.dayIndex,
      date: firstPP.time.substring(0, 10),
      label: "First redemption triggered",
      nominalValue: firstPP.nominalValue,
    });
  }

  // 50% supply destruction
  const halfPoint = processed.find((e) => e.nominalValue <= initialNotional * 0.5);
  if (halfPoint) {
    points.push({
      day: halfPoint.dayIndex,
      date: halfPoint.time.substring(0, 10),
      label: "50% supply destroyed",
      nominalValue: halfPoint.nominalValue,
    });
  }

  // MD event
  const md = processed.find((e) => e.type === "MD");
  if (md) {
    points.push({
      day: md.dayIndex,
      date: md.time.substring(0, 10),
      label: "Maturity reached",
      nominalValue: md.nominalValue,
    });
  }

  return points;
}
