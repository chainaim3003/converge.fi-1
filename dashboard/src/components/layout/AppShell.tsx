/**
 * AppShell — Main layout wrapper.
 *
 * From CLAUDE.md section 9.1:
 *  Header (top bar)
 *  Sidebar (left nav)
 *  Main content area (panels on left, chat placeholder on right)
 */

import React, { useState } from "react";
import { Header } from "./Header";
import { Sidebar, SidebarView } from "./Sidebar";

interface AppShellProps {
  healthStatus: "healthy" | "degraded" | "offline";
  lastUpdateTimestamp: number | null;
  children: React.ReactNode;
}

export function AppShell({ healthStatus, lastUpdateTimestamp, children }: AppShellProps) {
  const [activeView, setActiveView] = useState<SidebarView>("overview");

  return (
    <div className="h-screen flex flex-col bg-gray-950">
      <Header healthStatus={healthStatus} lastUpdateTimestamp={lastUpdateTimestamp} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeView={activeView} onViewChange={setActiveView} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
