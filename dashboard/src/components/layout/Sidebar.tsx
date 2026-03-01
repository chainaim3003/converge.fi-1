/**
 * Sidebar — Navigation for dashboard views.
 *
 * From CLAUDE.md section 9.1:
 *  • Overview
 *  • Risk
 *  • Simulations
 *  • Alerts
 *  • On-Chain
 */

import React from "react";

export type SidebarView = "overview" | "risk" | "simulations" | "alerts" | "chain";

interface SidebarProps {
  activeView: SidebarView;
  onViewChange: (view: SidebarView) => void;
}

const navItems: Array<{ id: SidebarView; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "◉" },
  { id: "risk", label: "Risk", icon: "⚠" },
  { id: "simulations", label: "Simulations", icon: "▶" },
  { id: "alerts", label: "Alerts", icon: "🔔" },
  { id: "chain", label: "On-Chain", icon: "⛓" },
];

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  return (
    <nav className="w-16 bg-gray-900 border-r border-gray-800 flex flex-col items-center py-4 gap-1">
      {navItems.map((item) => (
        <button
          key={item.id}
          onClick={() => onViewChange(item.id)}
          className={`w-12 h-12 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-colors ${
            activeView === item.id
              ? "bg-converge-900/50 text-converge-400"
              : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
          }`}
          title={item.label}
        >
          <span className="text-base">{item.icon}</span>
          <span className="text-[9px] leading-none">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
