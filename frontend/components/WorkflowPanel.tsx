"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { apiFetch } from "@/lib/api";
import { useMode, MOCK_POLICIES, MockPolicy } from "@/contexts/ModeContext";
import {
  Shield, ShieldOff, Settings2, MessageSquare, Crosshair,
  Wrench, LayoutDashboard, FileText, ChevronRight, Zap,
} from "lucide-react";

const NAV_TABS = [
  { id: "problem",   label: "Problem",    href: "/problem",    Icon: ShieldOff,      danger: true  },
  { id: "compile",   label: "Compile",    href: "/compile",    Icon: Settings2,      danger: false },
  { id: "simulate",  label: "Simulate",   href: "/simulate",   Icon: MessageSquare,  danger: false },
  { id: "redteam",   label: "Red Team",   href: "/redteam",    Icon: Crosshair,      danger: false },
  { id: "heal",      label: "Heal",       href: "/heal",       Icon: Wrench,         danger: false },
  { id: "dashboard", label: "Dashboard",  href: "/dashboard",  Icon: LayoutDashboard,danger: false },
  { id: "audit",     label: "Audit",      href: "/audit",      Icon: FileText,       danger: false },
] as const;

interface WorkflowPanelProps {
  activeTab: typeof NAV_TABS[number]["id"];
}

function PolicyPickerModal({ onSelect, onClose }: {
  onSelect: (p: MockPolicy) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div className="bg-[#091120] border border-white/[0.10] rounded-2xl w-[460px] shadow-2xl mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07]">
          <div>
            <p className="text-sm font-semibold text-[#eef1f8]">Select Demo Policy</p>
            <p className="text-xs text-[#3a4060] mt-0.5">Pre-built scenarios — no API calls needed</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#3a4060] hover:text-[#8892a8] hover:bg-white/[0.05] transition-all text-lg leading-none"
          >×</button>
        </div>
        <div className="p-4 space-y-2">
          {MOCK_POLICIES.map((policy) => (
            <button
              key={policy.id}
              onClick={() => onSelect(policy)}
              className="w-full text-left p-4 rounded-xl border border-white/[0.06] bg-[#0d1830] hover:border-white/[0.13] hover:bg-[#0f1e3a] transition-all duration-200 group"
              style={{ boxShadow: "none" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 20px rgba(0,0,0,0.35)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-xl"
                  style={{ background: `${policy.color}18`, border: `1px solid ${policy.color}30` }}
                >
                  {policy.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-[#eef1f8] group-hover:text-white transition-colors">{policy.name}</span>
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded-md"
                      style={{ background: `${policy.color}20`, color: policy.color, border: `1px solid ${policy.color}35` }}
                    >
                      {policy.ruleCount} rules
                    </span>
                  </div>
                  <p className="text-xs text-[#8892a8] leading-relaxed">{policy.description}</p>
                </div>
                <ChevronRight size={14} className="text-[#3a4060] group-hover:text-[#8892a8] shrink-0 transition-colors" />
              </div>
            </button>
          ))}
        </div>
        <div className="px-5 pb-4">
          <p className="text-[10px] text-[#3a4060] text-center">
            All mock data is pre-computed and realistic — safe for live demos
          </p>
        </div>
      </div>
    </div>
  );
}

export default function WorkflowPanel({ activeTab }: WorkflowPanelProps) {
  const [ltRunning, setLtRunning] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const { mode, selectedPolicy, switchToMock, switchToLive } = useMode();

  useEffect(() => {
    if (mode === "mock") return;
    apiFetch<{ running: boolean }>("/observe/status")
      .then((d) => setLtRunning(d.running))
      .catch(() => setLtRunning(false));
    const id = setInterval(() => {
      apiFetch<{ running: boolean }>("/observe/status")
        .then((d) => setLtRunning(d.running))
        .catch(() => setLtRunning(false));
    }, 10000);
    return () => clearInterval(id);
  }, [mode]);

  // kept for legacy; segmented switch handles clicks directly now
  const handleModeToggle = () => {
    if (mode === "live") setShowPicker(true);
    else switchToLive();
  };

  return (
    <>
      <nav className="w-[260px] shrink-0 flex flex-col bg-[#050b17] border-r border-white/[0.07] py-5">

        {/* Logo */}
        <div className="px-5 mb-5">
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: "rgba(59,130,246,0.15)",
                border: "1px solid rgba(59,130,246,0.35)",
                boxShadow: "0 0 14px rgba(59,130,246,0.25)",
              }}
            >
              <Shield size={16} className="text-[#3b82f6]" />
            </div>
            <div>
              <h1
                className="font-bold text-base tracking-tight leading-none bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] bg-clip-text text-transparent"
              >
                RegulaForge
              </h1>
              <p className="text-[#3a4060] text-[10px] mt-0.5">Policy Enforcement Compiler</p>
            </div>
          </div>
        </div>

        {/* Mode toggle — segmented LIVE | MOCK switch */}
        <div className="px-3 mb-4">
          <div className="rounded-xl p-1 flex gap-1" style={{ background: "#091120", border: "1px solid rgba(255,255,255,0.07)" }}>
            {/* LIVE segment */}
            <button
              onClick={mode === "mock" ? switchToLive : undefined}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200"
              style={mode === "live" ? {
                background: "linear-gradient(135deg, rgba(16,217,124,0.18), rgba(16,217,124,0.08))",
                border: "1px solid rgba(16,217,124,0.35)",
                color: "#10d97c",
                boxShadow: "0 0 10px rgba(16,217,124,0.15)",
              } : {
                background: "transparent",
                border: "1px solid transparent",
                color: "#3a4060",
              }}
            >
              <span
                className={clsx("w-1.5 h-1.5 rounded-full shrink-0", mode === "live" && "animate-pulse")}
                style={{ background: mode === "live" ? "#10d97c" : "#3a4060", boxShadow: mode === "live" ? "0 0 6px #10d97c" : "none" }}
              />
              Live
            </button>

            {/* MOCK segment */}
            <button
              onClick={mode === "live" ? () => setShowPicker(true) : () => setShowPicker(true)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200"
              style={mode === "mock" ? {
                background: "linear-gradient(135deg, rgba(139,92,246,0.18), rgba(139,92,246,0.08))",
                border: "1px solid rgba(139,92,246,0.35)",
                color: "#a78bfa",
                boxShadow: "0 0 10px rgba(139,92,246,0.15)",
              } : {
                background: "transparent",
                border: "1px solid transparent",
                color: "#3a4060",
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: mode === "mock" ? "#a78bfa" : "#3a4060", boxShadow: mode === "mock" ? "0 0 6px #a78bfa" : "none" }}
              />
              {mode === "mock" && selectedPolicy ? `${selectedPolicy.icon} ${selectedPolicy.shortName}` : "Mock"}
            </button>
          </div>
          {mode === "mock" && selectedPolicy && (
            <p className="text-[9px] text-center mt-1.5 font-mono" style={{ color: "#a78bfa", opacity: 0.6 }}>
              demo · no API calls
            </p>
          )}
        </div>

        {/* Nav */}
        <div className="flex flex-col gap-0.5 px-2">
          {NAV_TABS.map((tab, i) => {
            const isActive = activeTab === tab.id;
            return (
              <div key={tab.id}>
                {i === 1 && (
                  <div className="flex items-center gap-2 my-2.5 px-2">
                    <div className="flex-1 h-px bg-white/[0.06]" />
                    <span className="text-[9px] uppercase tracking-widest text-[#3a4060] font-medium">— Solution —</span>
                    <div className="flex-1 h-px bg-white/[0.06]" />
                  </div>
                )}
                <Link
                  href={tab.href}
                  className={clsx(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 border",
                    isActive && tab.danger
                      ? "border-l-2 border-[#f04747] text-[#f87171]"
                      : isActive
                      ? "border-l-2 border-[#3b82f6] text-[#60a5fa]"
                      : tab.danger
                      ? "border-transparent text-[#f87171] hover:text-[#fca5a5] hover:bg-white/[0.04]"
                      : "border-transparent text-[#4a5070] hover:text-[#8892a8] hover:bg-white/[0.04]"
                  )}
                  style={isActive && tab.danger ? {
                    background: "linear-gradient(to right, rgba(240,71,71,0.15), transparent)",
                    boxShadow: "0 0 10px rgba(240,71,71,0.08)",
                  } : isActive ? {
                    background: "linear-gradient(to right, rgba(59,130,246,0.15), transparent)",
                    boxShadow: "0 0 10px rgba(59,130,246,0.08)",
                  } : {}}
                >
                  <tab.Icon
                    size={15}
                    className={clsx(
                      "shrink-0",
                      isActive && tab.danger ? "text-[#f04747]"
                      : isActive ? "text-[#3b82f6]"
                      : tab.danger ? "text-[#f04747]/70"
                      : "text-[#3a4060]"
                    )}
                  />
                  <span className="font-medium flex-1">{tab.label}</span>
                  {tab.danger && !isActive && (
                    <span
                      className="ml-auto w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
                      style={{ background: "#f04747", boxShadow: "0 0 5px #f04747" }}
                    />
                  )}
                </Link>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-auto px-3 space-y-2.5 pt-4">
          {mode === "mock" && selectedPolicy && (
            <div className="rounded-xl px-3 py-2.5" style={{
              background: "rgba(139,92,246,0.06)",
              border: "1px solid rgba(139,92,246,0.15)",
            }}>
              <p className="text-[9px] uppercase tracking-widest text-[#8b5cf6]/70 mb-1">Demo Policy</p>
              <p className="text-xs font-semibold text-[#eef1f8]">{selectedPolicy.name}</p>
              <p className="text-[10px] text-[#3a4060] mt-0.5">{selectedPolicy.ruleCount} pre-compiled rules</p>
            </div>
          )}

          <div className="px-1">
            {mode === "live" ? (
              <div className="flex items-center gap-2 text-xs text-[#3a4060]">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0`} style={ltRunning
                  ? { background: "#10d97c", boxShadow: "0 0 6px #10d97c" }
                  : { background: "#f04747", boxShadow: "0 0 6px #f04747" }
                } />
                {ltRunning ? "Lobster Trap active" : "Lobster Trap stopped"}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-[#3a4060]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6]/30 shrink-0" />
                Lobster Trap bypassed
              </div>
            )}
          </div>
        </div>
      </nav>

      {showPicker && (
        <PolicyPickerModal
          onSelect={(p) => { switchToMock(p); setShowPicker(false); }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </>
  );
}
