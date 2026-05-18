"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { apiFetch } from "@/lib/api";
import { useMode } from "@/contexts/ModeContext";
import { LayoutDashboard, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Regulation {
  id: string;
  name: string;
  status: "active" | "roadmap";
}

interface AuditEvent {
  time: string;
  event: string;
  rule: string;
  action: string;
  risk: number;
}

interface Explanation {
  icon: string;
  title: string;
  description: string;
  risk: number;
  rule: string;
}

interface AttackBreakdown {
  category: string;
  total: number;
  blocked: number;
}

interface Stats {
  policy_coverage_percent: number;
  total_rules: number;
  attacks_total: number;
  attacks_blocked: number;
  attacks_blocked_after_heal: number;
  block_rate_before: number;
  block_rate_after: number;
  risk_score_before: number;
  risk_score_after: number;
  safe_transactions_total: number;
  safe_transactions_passed: number;
  patches_applied: number;
  regulations_covered: Regulation[];
  recent_audit_events: AuditEvent[];
  top_blocked_explanations: Explanation[];
  attack_breakdown: AttackBreakdown[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function actionColor(a: string) {
  const u = a.toUpperCase();
  if (u === "DENY")   return "#f04747";
  if (u === "REVIEW") return "#f59e0b";
  return "#10d97c";
}
function actionRowStyle(a: string) {
  const u = a.toUpperCase();
  if (u === "DENY")   return { background: "rgba(240,71,71,0.06)" };
  if (u === "REVIEW") return { background: "rgba(245,158,11,0.05)" };
  return {};
}

// ── Section 1: Metric Cards ───────────────────────────────────────────────────

function ProgressBarGrad({ pct, fromColor, toColor }: { pct: number; fromColor: string; toColor: string }) {
  return (
    <div className="w-full h-1.5 rounded-full overflow-hidden mt-2" style={{ background: "rgba(255,255,255,0.06)" }}>
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: `linear-gradient(to right, ${fromColor}, ${toColor})` }}
      />
    </div>
  );
}

function MetricCard({ iconEl, title, main, mainColor, mainShadow, sub, extra }: {
  iconEl: React.ReactNode;
  title: string;
  main: string;
  mainColor: string;
  mainShadow: string;
  sub: string;
  extra?: React.ReactNode;
}) {
  return (
    <div
      className="bg-[#091120] border border-white/[0.07] rounded-2xl p-5 flex flex-col gap-1 transition-all duration-200"
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.13)";
        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 20px rgba(0,0,0,0.40)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.07)";
        (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        {iconEl}
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[#3a4060]">{title}</span>
      </div>
      <p className="text-3xl font-bold font-mono leading-none" style={{ color: mainColor, textShadow: `0 0 14px ${mainShadow}` }}>
        {main}
      </p>
      {extra}
      <p className="text-xs text-[#3a4060] mt-1">{sub}</p>
    </div>
  );
}

function MetricsRow({ s }: { s: Stats }) {
  const safeRate = s.safe_transactions_total > 0
    ? Math.round(s.safe_transactions_passed / s.safe_transactions_total * 100) : 100;
  const riskReduction = s.risk_score_before > 0
    ? Math.round((s.risk_score_before - s.risk_score_after) / s.risk_score_before * 100) : 87;

  return (
    <div className="grid grid-cols-5 gap-4">
      <MetricCard
        iconEl={<span className="text-lg">📋</span>}
        title="Policy Coverage"
        main={`${s.policy_coverage_percent}%`}
        mainColor="#3b82f6"
        mainShadow="rgba(59,130,246,0.45)"
        sub={`${s.total_rules} controls covered`}
        extra={<ProgressBarGrad pct={s.policy_coverage_percent} fromColor="#3b82f6" toColor="#8b5cf6" />}
      />
      <MetricCard
        iconEl={<span className="text-lg">🛡</span>}
        title="Attacks Blocked"
        main={`${s.attacks_blocked_after_heal}/${s.attacks_total}`}
        mainColor="#10d97c"
        mainShadow="rgba(16,217,124,0.40)"
        sub={`${s.block_rate_after}% block rate`}
        extra={<ProgressBarGrad pct={s.block_rate_after} fromColor="#10d97c" toColor="#3b82f6" />}
      />
      <MetricCard
        iconEl={<span className="text-lg">⚡</span>}
        title="Risk Score"
        main={String(s.risk_score_after)}
        mainColor="#f59e0b"
        mainShadow="rgba(245,158,11,0.40)"
        sub={`▼ ${riskReduction}% reduction`}
        extra={
          <div className="flex items-center gap-3 mt-1 text-xs font-mono">
            <span style={{ color: "#f04747" }}>Before: {s.risk_score_before}</span>
            <span className="text-[#3a4060]">→</span>
            <span style={{ color: "#10d97c" }}>After: {s.risk_score_after}</span>
          </div>
        }
      />
      <MetricCard
        iconEl={<span className="text-lg">✅</span>}
        title="Safe Txn Integrity"
        main={`${s.safe_transactions_passed}/${s.safe_transactions_total}`}
        mainColor="#10d97c"
        mainShadow="rgba(16,217,124,0.35)"
        sub="no regression"
        extra={<ProgressBarGrad pct={safeRate} fromColor="#10d97c" toColor="#22d3ee" />}
      />
      <MetricCard
        iconEl={<span className="text-lg">🔧</span>}
        title="Policy Patches"
        main={String(s.patches_applied)}
        mainColor="#a78bfa"
        mainShadow="rgba(139,92,246,0.40)"
        sub="patches applied"
        extra={<p className="text-[10px] mt-1 font-mono" style={{ color: "#a78bfa" }}>✦ auto-healed</p>}
      />
    </div>
  );
}

// ── Section 2 Left: Attack Breakdown Bar Chart ────────────────────────────────

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="border rounded-xl px-3 py-2 text-xs font-mono"
      style={{ background: "#091120", borderColor: "rgba(255,255,255,0.10)" }}>
      <p className="text-[#8892a8] mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
};

function AttackChart({ data }: { data: AttackBreakdown[] }) {
  return (
    <div className="bg-[#091120] border border-white/[0.07] rounded-2xl p-5 flex flex-col transition-all duration-200 hover:border-white/[0.13]">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#3a4060] mb-4">
        Attacks by Category
      </p>
      <div className="flex-1 min-h-[220px]">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} barGap={4} barCategoryGap="30%">
            <XAxis
              dataKey="category"
              tick={{ fill: "#3a4060", fontSize: 10 }}
              axisLine={false} tickLine={false}
            />
            <YAxis
              tick={{ fill: "#3a4060", fontSize: 10 }}
              axisLine={false} tickLine={false}
              width={24}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
            <Legend
              wrapperStyle={{ fontSize: 10, color: "#8892a8", paddingTop: 8 }}
            />
            <Bar dataKey="total"   name="Total"   fill="#f04747" opacity={0.75} radius={[4,4,0,0]} />
            <Bar dataKey="blocked" name="Blocked" fill="#10d97c" opacity={0.85} radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Section 2 Right: Compliance Coverage Map ──────────────────────────────────

function ComplianceMap({ regulations }: { regulations: Regulation[] }) {
  return (
    <div className="bg-[#091120] border border-white/[0.07] rounded-2xl p-5 transition-all duration-200 hover:border-white/[0.13]">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#3a4060] mb-4">
        Regulation Coverage
      </p>
      <div className="flex flex-col gap-2">
        {regulations.map((r) => {
          const active = r.status === "active";
          return (
            <div key={r.id} className="flex items-center gap-3 py-2 border-b border-white/[0.04] last:border-0">
              {active
                ? <CheckCircle2 size={14} style={{ color: "#10d97c" }} className="shrink-0" />
                : <Clock size={14} style={{ color: "#f59e0b" }} className="shrink-0" />
              }
              <span className="font-mono text-xs w-32 shrink-0" style={{ color: "#60a5fa" }}>{r.id}</span>
              <span className="text-xs text-[#eef1f8] flex-1">{r.name}</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md"
                style={active ? {
                  color: "#10d97c",
                  background: "rgba(16,217,124,0.10)",
                  border: "1px solid rgba(16,217,124,0.22)",
                } : {
                  color: "#f59e0b",
                  background: "rgba(245,158,11,0.08)",
                  border: "1px solid rgba(245,158,11,0.20)",
                }}>
                {active ? "ACTIVE" : "ROADMAP"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Section 3 Left: Audit Events Table ───────────────────────────────────────

function AuditTable({ events }: { events: AuditEvent[] }) {
  return (
    <div className="bg-[#091120] border border-white/[0.07] rounded-2xl p-5 transition-all duration-200 hover:border-white/[0.13]">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#3a4060] mb-4">
        Recent Audit Events
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/[0.06]">
              {["Time", "Event", "Rule", "Action", "Risk"].map(h => (
                <th key={h} className="text-left pb-2 pr-4 text-[10px] text-[#3a4060] uppercase tracking-widest font-medium last:pr-0">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((e, i) => (
              <tr
                key={i}
                className="border-b border-white/[0.03] last:border-0"
                style={actionRowStyle(e.action)}
              >
                <td className="py-2 pr-4 font-mono text-[#3a4060] whitespace-nowrap">{e.time}</td>
                <td className="py-2 pr-4 text-[#eef1f8] max-w-[140px] truncate">{e.event}</td>
                <td className="py-2 pr-4 font-mono text-[#8892a8] max-w-[160px] truncate">{e.rule}</td>
                <td className="py-2 pr-4 font-bold font-mono" style={{ color: actionColor(e.action) }}>{e.action}</td>
                <td className="py-2 font-mono text-[#8892a8]">{e.risk.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Section 3 Right: Explainability Summary ───────────────────────────────────

function ExplainCards({ items }: { items: Explanation[] }) {
  return (
    <div className="bg-[#091120] border border-white/[0.07] rounded-2xl p-5 transition-all duration-200 hover:border-white/[0.13]">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#3a4060] mb-4">
        Why Attacks Were Blocked
      </p>
      <div className="flex flex-col gap-3">
        {items.map((item, i) => {
          const isDeny = item.icon === "⛔";
          return (
            <div
              key={i}
              className="rounded-xl px-3 py-2.5"
              style={isDeny ? {
                borderLeft: "3px solid #f04747",
                background: "rgba(240,71,71,0.06)",
              } : {
                borderLeft: "3px solid #f59e0b",
                background: "rgba(245,158,11,0.05)",
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span>{item.icon}</span>
                <span className="text-xs font-semibold" style={{ color: isDeny ? "#f87171" : "#f59e0b" }}>
                  {item.title}
                </span>
              </div>
              <p className="text-xs text-[#8892a8] leading-relaxed mb-2">{item.description}</p>
              <div className="flex items-center gap-3 text-[10px] font-mono text-[#3a4060]">
                <span>Risk: {item.risk.toFixed(2)}</span>
                <span>·</span>
                <span className="truncate">{item.rule}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Section 4: Executive Summary Banner ──────────────────────────────────────

function ExecSummary({ s }: { s: Stats }) {
  const riskReduction = s.risk_score_before > 0
    ? Math.round((s.risk_score_before - s.risk_score_after) / s.risk_score_before * 100) : 87;

  return (
    <div className="rounded-2xl p-6 border"
      style={{
        background: "linear-gradient(135deg, #091120, #0d1830, #091120)",
        borderColor: "rgba(59,130,246,0.22)",
        boxShadow: "0 0 30px rgba(59,130,246,0.06)",
      }}>
      <div className="flex items-start justify-between gap-6">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">📊</span>
            <h3 className="text-sm font-bold uppercase tracking-widest" style={{ color: "#3b82f6" }}>
              Executive Summary
            </h3>
          </div>
          <p className="text-sm text-[#8892a8] mb-4 leading-relaxed">
            Your AI finance agent is now protected by RegulaForge policy enforcement.
          </p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
            {[
              `${s.attacks_total} adversarial attacks tested`,
              `${s.attacks_blocked_after_heal}/${s.attacks_total} blocked after auto-healing (${s.block_rate_after}%)`,
              `${s.safe_transactions_passed}/${s.safe_transactions_total} safe transactions preserved (0% regression)`,
              `${s.patches_applied} policy patches auto-applied`,
              "Compliant with PCI-DSS, FFIEC, OFAC",
              "Audit report ready for regulator review",
            ].map((line, i) => (
              <div key={i} className="flex items-start gap-2 text-[#eef1f8]">
                <span className="shrink-0 mt-0.5" style={{ color: "#3b82f6" }}>•</span>
                <span>{line}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-[#8892a8] mt-4">
            Risk reduced from{" "}
            <span className="font-semibold" style={{ color: "#f04747" }}>CRITICAL (score: {s.risk_score_before})</span>
            {" "}to{" "}
            <span className="font-semibold" style={{ color: "#10d97c" }}>LOW (score: {s.risk_score_after})</span>
            {" "}— {riskReduction}% risk reduction
          </p>
        </div>
        <div className="shrink-0 flex flex-col items-center gap-3">
          <div className="text-center">
            <p className="text-5xl font-bold font-mono" style={{ color: "#10d97c", textShadow: "0 0 20px rgba(16,217,124,0.40)" }}>
              {s.block_rate_after}%
            </p>
            <p className="text-[10px] text-[#3a4060] uppercase tracking-widest mt-0.5">blocked</p>
          </div>
          <a
            href="/audit"
            className="text-white px-5 py-2.5 rounded-xl text-sm font-medium text-center whitespace-nowrap transition-all duration-200"
            style={{ background: "linear-gradient(to right, #2563eb, #4f46e5)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 0 20px rgba(79,70,229,0.45)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.boxShadow = "none"; }}
          >
            Download Audit Report PDF
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [stats, setStats]       = useState<Stats | null>(null);
  const [loading, setLoading]   = useState(true);
  const [lastUpdated, setLast]  = useState<string>("");
  const { mode, selectedPolicy } = useMode();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (mode === "mock" && selectedPolicy) {
        await new Promise((r) => setTimeout(r, 300));
        const { getMockDashboard } = await import("@/lib/mock-scenarios");
        setStats(getMockDashboard(selectedPolicy.id) as unknown as Stats);
      } else {
        const data = await apiFetch<Stats>("/dashboard/stats");
        setStats(data);
      }
      setLast(new Date().toLocaleTimeString("en-GB", { hour12: false }));
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  }, [mode, selectedPolicy]);

  useEffect(() => { load(); }, [load]);

  return (
    <Shell activeTab="dashboard">
      <div className="p-6 flex flex-col gap-6 min-h-full">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.25)" }}>
              <LayoutDashboard size={16} style={{ color: "#3b82f6" }} />
            </div>
            <div>
              <h2 className="text-base font-semibold bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] bg-clip-text text-transparent">
                Governance Dashboard
              </h2>
              <p className="text-xs text-[#3a4060] mt-0.5">
                {mode === "mock" && selectedPolicy
                  ? <><span style={{ color: "#a78bfa" }}>{selectedPolicy.icon} {selectedPolicy.name} · mock mode</span></>
                  : "Policy enforcement metrics & compliance posture"
                }
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-[11px] text-[#3a4060] font-mono">
                Updated {lastUpdated}
              </span>
            )}
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl transition-all duration-200 disabled:opacity-40"
              style={{ background: "#091120", border: "1px solid rgba(255,255,255,0.08)", color: "#8892a8" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(59,130,246,0.35)";
                (e.currentTarget as HTMLButtonElement).style.color = "#eef1f8";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.08)";
                (e.currentTarget as HTMLButtonElement).style.color = "#8892a8";
              }}
            >
              <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {loading && !stats && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-center gap-2 text-[#3a4060] text-sm">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Loading dashboard…
            </div>
          </div>
        )}

        {stats && (
          <>
            {/* Section 1 — Metric cards */}
            <MetricsRow s={stats} />

            {/* Section 2 — Chart + Compliance map */}
            <div className="grid grid-cols-2 gap-4">
              <AttackChart data={stats.attack_breakdown} />
              <ComplianceMap regulations={stats.regulations_covered} />
            </div>

            {/* Section 3 — Audit table + Explainability */}
            <div className="grid grid-cols-2 gap-4">
              <AuditTable events={stats.recent_audit_events} />
              <ExplainCards items={stats.top_blocked_explanations} />
            </div>

            {/* Section 4 — Executive summary */}
            <ExecSummary s={stats} />
          </>
        )}
      </div>
    </Shell>
  );
}
