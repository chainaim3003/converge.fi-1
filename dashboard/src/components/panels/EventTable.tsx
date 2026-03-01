/**
 * EventTable — Sortable table of ACTUS simulation events.
 *
 * Data source: /api/run-simulation raw events
 * From CLAUDE.md section 9.2:
 *   "Sortable table: type, time, payoff, nominalValue"
 *
 * Event types (from CLAUDE.md section 5.3):
 *   PP  = behavioral model redemption outputs
 *   MRD = behavioral model risk metric outputs
 *   IED = initial exchange date
 *   MD  = maturity date
 *   IP  = interest payment
 */

import React, { useState, useMemo } from "react";
import { Card } from "../shared/Card";
import { ACTUSEvent } from "../../lib/api";
import { formatUSD } from "../../lib/formatters";

interface EventTableProps {
  events: ACTUSEvent[];
}

type SortField = "type" | "time" | "payoff" | "nominalValue";
type SortDir = "asc" | "desc";

const eventTypeLabels: Record<string, string> = {
  IED: "Initial Exchange",
  PP: "Redemption (PP)",
  IP: "Interest Payment",
  MD: "Maturity",
  MRD: "Risk Metric",
  AD: "Analysis Date",
  SC: "Status Change",
  RR: "Rate Reset",
};

export function EventTable({ events }: EventTableProps) {
  const [sortField, setSortField] = useState<SortField>("time");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterType, setFilterType] = useState<string>("all");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  // Get unique event types for filter dropdown
  const eventTypes = useMemo(() => {
    const types = new Set(events.map((e) => e.type));
    return Array.from(types).sort();
  }, [events]);

  const sortedEvents = useMemo(() => {
    let filtered = filterType === "all" ? events : events.filter((e) => e.type === filterType);

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "type":
          cmp = a.type.localeCompare(b.type);
          break;
        case "time":
          cmp = a.time.localeCompare(b.time);
          break;
        case "payoff":
          cmp = a.payoff - b.payoff;
          break;
        case "nominalValue":
          cmp = a.nominalValue - b.nominalValue;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [events, sortField, sortDir, filterType]);

  if (events.length === 0) {
    return (
      <Card title="Event Table">
        <p className="text-gray-500 text-sm py-4">
          Run a simulation to see event details.
        </p>
      </Card>
    );
  }

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  return (
    <Card title={`Event Table (${sortedEvents.length} of ${events.length} events)`}>
      {/* Filter */}
      <div className="mb-3 flex items-center gap-3">
        <label className="text-xs text-gray-400">Filter by type:</label>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
        >
          <option value="all">All ({events.length})</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>
              {t} ({events.filter((e) => e.type === t).length})
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto max-h-80 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900">
            <tr className="border-b border-gray-700">
              <th
                onClick={() => handleSort("type")}
                className="text-left py-2 px-2 text-gray-400 cursor-pointer hover:text-gray-200"
              >
                Type{sortIndicator("type")}
              </th>
              <th
                onClick={() => handleSort("time")}
                className="text-left py-2 px-2 text-gray-400 cursor-pointer hover:text-gray-200"
              >
                Time{sortIndicator("time")}
              </th>
              <th
                onClick={() => handleSort("payoff")}
                className="text-right py-2 px-2 text-gray-400 cursor-pointer hover:text-gray-200"
              >
                Payoff{sortIndicator("payoff")}
              </th>
              <th
                onClick={() => handleSort("nominalValue")}
                className="text-right py-2 px-2 text-gray-400 cursor-pointer hover:text-gray-200"
              >
                Nominal Value{sortIndicator("nominalValue")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedEvents.map((event, i) => {
              const isRedemption = event.type === "PP" && Math.abs(event.payoff) > 0;
              return (
                <tr
                  key={i}
                  className={`border-b border-gray-800/50 ${
                    isRedemption ? "bg-red-900/10" : ""
                  }`}
                >
                  <td className="py-1.5 px-2">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        event.type === "PP"
                          ? "bg-red-900/30 text-red-400"
                          : event.type === "IED"
                          ? "bg-blue-900/30 text-blue-400"
                          : event.type === "MD"
                          ? "bg-purple-900/30 text-purple-400"
                          : "bg-gray-800 text-gray-400"
                      }`}
                    >
                      {event.type}
                    </span>
                    <span className="ml-1.5 text-gray-500">
                      {eventTypeLabels[event.type] || event.type}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-gray-300">{event.time.substring(0, 16)}</td>
                  <td
                    className={`py-1.5 px-2 text-right tabular-nums ${
                      event.payoff < 0
                        ? "text-red-400"
                        : event.payoff > 0
                        ? "text-emerald-400"
                        : "text-gray-500"
                    }`}
                  >
                    {event.payoff === 0 ? "—" : formatUSD(event.payoff)}
                  </td>
                  <td className="py-1.5 px-2 text-right text-gray-300 tabular-nums">
                    {formatUSD(event.nominalValue)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
