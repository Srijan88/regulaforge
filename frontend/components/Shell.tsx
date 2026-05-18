"use client";

import { ReactNode } from "react";
import WorkflowPanel from "./WorkflowPanel";
import ObservabilityPanel from "./ObservabilityPanel";

interface ShellProps {
  children: ReactNode;
  activeTab: "problem" | "compile" | "simulate" | "redteam" | "heal" | "dashboard" | "audit";
}

export default function Shell({ children, activeTab }: ShellProps) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#060e20] text-[#e2e2e6]">
      {/* Left panel — Workflow nav (280px) */}
      <WorkflowPanel activeTab={activeTab} />

      {/* Center panel — Primary workspace */}
      <main className="flex-1 overflow-y-auto border-x border-white/10">
        {children}
      </main>

      {/* Right panel — Live observability feed (320px) */}
      <ObservabilityPanel />
    </div>
  );
}
