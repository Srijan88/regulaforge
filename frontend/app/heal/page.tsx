"use client";

import { useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { apiFetch } from "@/lib/api";
import { useMode } from "@/contexts/ModeContext";
import { getMockHeal, getMockFullPolicyYaml } from "@/lib/mock-scenarios";
import { Wrench, Sparkles, ShieldX, Eye, ShieldCheck, CheckCircle2, Download, Copy, Check } from "lucide-react";
import { API } from "@/lib/api";

interface RuleDetail {
  name: string;
  condition: string;
  action: string;
  addresses: string[];
  reasoning: string;
}

interface HealResult {
  run_id: string;
  new_rule_count: number;
  addresses_attacks: string[];
  diff_yaml: string;
  reasoning: string;
  rule_details: RuleDetail[];
  regression_passed: boolean;
  gemini_guard_activated?: boolean;
}

const STEPS = [
  { label: "Fetching run data and failed attacks",       ms: 0    },
  { label: "Grouping failures by attack category",       ms: 800  },
  { label: "Analysing attack patterns with Gemini 2.5 Pro", ms: 2000 },
  { label: "Generating new ingress rules for each gap",  ms: 4500 },
  { label: "Validating YAML policy patch",               ms: 7000 },
];

function HealingProgress() {
  const [step, setStep] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let i = 1;
    const tick = () => {
      if (i < STEPS.length) {
        const delay = STEPS[i].ms - STEPS[i - 1].ms;
        timer.current = setTimeout(() => {
          setStep(i);
          i++;
          tick();
        }, delay);
      }
    };
    tick();
    return () => clearTimeout(timer.current);
  }, []);

  const pct = Math.round((step / (STEPS.length - 1)) * 100);

  return (
    <div className="rounded-2xl p-6 mt-4 border"
      style={{ background: "#091120", borderColor: "rgba(139,92,246,0.25)", boxShadow: "0 0 24px rgba(139,92,246,0.08)" }}>
      <div className="flex items-center gap-2 mb-5">
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" style={{ color: "#a78bfa" }}>
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
        </svg>
        <span className="text-sm font-semibold" style={{ color: "#a78bfa" }}>
          <Sparkles size={13} className="inline mr-1" />Gemini 2.5 Pro — analysing policy gaps
        </span>
      </div>
      <div className="space-y-3.5">
        {STEPS.map((s, i) => {
          const done    = i < step;
          const active  = i === step;
          const pending = i > step;
          return (
            <div key={i} className={`flex items-start gap-3 transition-all duration-500 ${pending ? "opacity-30" : "opacity-100"}`}>
              {/* connector line */}
              <div className="flex flex-col items-center">
                <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-all"
                  style={done ? {
                    background: "rgba(16,217,124,0.20)",
                    border: "1px solid rgba(16,217,124,0.45)",
                    boxShadow: "0 0 8px rgba(16,217,124,0.30)",
                  } : active ? {
                    background: "rgba(139,92,246,0.20)",
                    border: "1px solid rgba(139,92,246,0.55)",
                    boxShadow: "0 0 10px rgba(139,92,246,0.35)",
                  } : {
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.10)",
                  }}>
                  {done
                    ? <span style={{ color: "#10d97c", fontSize: 8 }}>✓</span>
                    : active
                    ? <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#a78bfa" }} />
                    : <span className="w-1.5 h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.18)" }} />
                  }
                </div>
                {i < STEPS.length - 1 && (
                  <div className="w-px mt-1 mb-0 flex-1" style={{
                    height: 16,
                    background: done ? "rgba(16,217,124,0.30)" : "rgba(255,255,255,0.06)",
                  }} />
                )}
              </div>
              <span className="text-xs leading-relaxed mt-0.5" style={
                done   ? { color: "#8892a8", textDecoration: "line-through" }
                : active ? { color: "#eef1f8" }
                :          { color: "#3a4060" }
              }>{s.label}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-5 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: "linear-gradient(to right, #3b82f6, #8b5cf6)" }}
        />
      </div>
    </div>
  );
}

const ACTION_COLORS: Record<string, { color: string; bg: string; border: string; leftBorder: string }> = {
  DENY:    { color: "#f04747", bg: "rgba(240,71,71,0.08)",  border: "rgba(240,71,71,0.20)",  leftBorder: "#f04747" },
  REVIEW:  { color: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.20)", leftBorder: "#f59e0b" },
  ALLOW:   { color: "#10d97c", bg: "rgba(16,217,124,0.06)", border: "rgba(16,217,124,0.18)", leftBorder: "#10d97c" },
};

export default function HealPage() {
  const [runId, setRunId]         = useState("");
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [healing, setHealing]     = useState(false);
  const [applying, setApplying]   = useState(false);
  const [result, setResult]       = useState<HealResult | null>(null);
  const [applied, setApplied]     = useState(false);
  const [error, setError]         = useState("");
  const [copied, setCopied]       = useState(false);
  const { mode, selectedPolicy }  = useMode();

  const downloadPolicy = () => {
    if (mode === "mock" && result?.diff_yaml && selectedPolicy) {
      const fullYaml = getMockFullPolicyYaml(selectedPolicy.id, result.diff_yaml);
      const blob = new Blob([fullYaml], { type: "text/yaml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedPolicy.id}_healed_policy.yaml`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    const a = document.createElement("a");
    a.href = `${API}/heal/policy/yaml`;
    a.download = "finance_policy.yaml";
    a.click();
  };

  const copyPolicy = async () => {
    try {
      let text: string;
      if (mode === "mock" && result?.diff_yaml && selectedPolicy) {
        text = getMockFullPolicyYaml(selectedPolicy.id, result.diff_yaml);
      } else {
        const resp = await fetch(`${API}/heal/policy/yaml`);
        text = await resp.text();
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem("last_run_id") ?? "";
    setRunId(saved);
  }, []);

  const heal = async () => {
    if (mode !== "mock" && !runId.trim()) return;
    setHealing(true);
    setResult(null);
    setApplied(false);
    setError("");

    if (mode === "mock" && selectedPolicy) {
      await new Promise((r) => setTimeout(r, 7500));
      setResult(getMockHeal(selectedPolicy.id) as HealResult);
      setHealing(false);
      return;
    }

    try {
      const data = await apiFetch<HealResult>(`/heal/run/${runId}?max_attempts=${maxAttempts}`, { method: "POST" });
      setResult(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setHealing(false);
    }
  };

  const apply = async () => {
    if (!result) return;
    setApplying(true);
    setError("");
    try {
      if (mode === "mock") {
        await new Promise(r => setTimeout(r, 800));
        setApplied(true);
        return;
      }
      await apiFetch(`/heal/apply/${result.run_id}`, { method: "POST" });
      setApplied(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Shell activeTab="heal">
      <div className="p-6">

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.25)", boxShadow: "0 0 14px rgba(59,130,246,0.15)" }}>
            <Wrench size={18} style={{ color: "#3b82f6" }} />
          </div>
          <div>
            <h2 className="text-base font-semibold bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] bg-clip-text text-transparent">
              Heal Failing Rules
            </h2>
            <p className="text-xs text-[#3a4060] mt-0.5">Auto-generate policy patches with Gemini 2.5 Pro</p>
          </div>
        </div>

        {/* Mock mode banner */}
        {mode === "mock" && selectedPolicy && (
          <div className="mb-5 flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{ background: "rgba(139,92,246,0.07)", border: "1px solid rgba(139,92,246,0.22)" }}>
            <span className="text-xl">{selectedPolicy.icon}</span>
            <div className="flex-1">
              <p className="text-xs font-semibold" style={{ color: "#a78bfa" }}>
                <Sparkles size={11} className="inline mr-1" />Mock Mode — {selectedPolicy.name}
              </p>
              <p className="text-[10px] text-[#3a4060] mt-0.5">Pre-built healing patch ready. Click Generate Patch to simulate the analysis.</p>
            </div>
            <button
              onClick={heal}
              disabled={healing}
              className="text-white px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-40 whitespace-nowrap"
              style={{ background: "linear-gradient(to right, #7c3aed, #a78bfa)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 16px rgba(139,92,246,0.40)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "none"; }}
            >
              {healing ? "Analysing…" : "Generate Patch"}
            </button>
          </div>
        )}

        {/* Input row — live mode only */}
        {mode === "live" && (
          <>
            <div className="flex gap-3 mb-2">
              <input
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
                placeholder="run-xxxxxxxx  (from Red Team tab)"
                className="flex-1 rounded-xl px-4 py-2.5 text-sm text-[#eef1f8] placeholder:text-[#3a4060] font-mono focus:outline-none transition-all duration-200"
                style={{ background: "#091120", border: "1px solid rgba(255,255,255,0.08)" }}
                onFocus={(e) => {
                  (e.currentTarget as HTMLInputElement).style.borderColor = "rgba(59,130,246,0.50)";
                  (e.currentTarget as HTMLInputElement).style.boxShadow = "0 0 0 3px rgba(59,130,246,0.10)";
                }}
                onBlur={(e) => {
                  (e.currentTarget as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.08)";
                  (e.currentTarget as HTMLInputElement).style.boxShadow = "none";
                }}
              />

              {/* Max attempts dropdown */}
              <div className="flex flex-col gap-1 shrink-0">
                <label className="text-[10px] text-[#3a4060] uppercase tracking-widest px-1">Max attempts</label>
                <select
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(Number(e.target.value))}
                  disabled={healing}
                  className="rounded-xl px-3 py-2.5 text-sm font-mono text-[#eef1f8] focus:outline-none transition-all duration-200 disabled:opacity-40 cursor-pointer"
                  style={{
                    background: "#091120",
                    border: "1px solid rgba(139,92,246,0.35)",
                    color: "#a78bfa",
                    minWidth: 90,
                  }}
                >
                  {[1, 2, 3, 4, 5].map(n => (
                    <option key={n} value={n} style={{ background: "#091120", color: "#eef1f8" }}>
                      {n} {n === 1 ? "pass" : "passes"}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={heal}
                disabled={healing || !runId.trim()}
                className="text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-40 whitespace-nowrap self-end"
                style={{ background: "linear-gradient(to right, #7c3aed, #a78bfa)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 16px rgba(139,92,246,0.40)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "none"; }}
              >
                {healing ? `Analysing… (${maxAttempts}×)` : "Generate Patch"}
              </button>
            </div>
            <p className="text-xs text-[#3a4060] mb-6">
              Gemini will run up to <span style={{ color: "#a78bfa" }}>{maxAttempts} pass{maxAttempts > 1 ? "es" : ""}</span> — each pass targets attacks not yet covered by previous rules.
            </p>
          </>
        )}

        {error && (
          <div className="text-xs font-mono px-3 py-2 mb-4 rounded-xl"
            style={{ color: "#f04747", background: "rgba(240,71,71,0.08)", border: "1px solid rgba(240,71,71,0.20)" }}>
            {error}
          </div>
        )}

        {/* Healing progress animation */}
        {healing && <HealingProgress />}

        {result && !healing && (
          <div className="flex flex-col gap-5">
            {/* Stats */}
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: "New rules",       value: result.new_rule_count,           color: "#a78bfa", shadow: "rgba(139,92,246,0.35)", topBorder: "#8b5cf6" },
                { label: "Attacks covered", value: result.addresses_attacks.length, color: "#22d3ee", shadow: "rgba(34,211,238,0.30)",  topBorder: "#22d3ee" },
                { label: `Attempts used`,    value: maxAttempts, color: "#a78bfa", shadow: "rgba(139,92,246,0.35)", topBorder: "#8b5cf6" },
              { label: "Regression",      value: result.regression_passed ? "PASS" : "FAIL",
                  color: result.regression_passed ? "#10d97c" : "#f04747",
                  shadow: result.regression_passed ? "rgba(16,217,124,0.30)" : "rgba(240,71,71,0.30)",
                  topBorder: result.regression_passed ? "#10d97c" : "#f04747" },
              ].map((s) => (
                <div key={s.label} className="bg-[#091120] border border-white/[0.07] rounded-2xl p-4 transition-all duration-200"
                  style={{ borderTop: `2px solid ${s.topBorder}` }}>
                  <p className="text-xs text-[#3a4060] uppercase tracking-widest">{s.label}</p>
                  <p className="text-2xl font-bold font-mono mt-1" style={{ color: s.color, textShadow: `0 0 12px ${s.shadow}` }}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Gemini analysis */}
            <div className="rounded-2xl p-4"
              style={{
                background: "rgba(139,92,246,0.06)",
                border: "1px solid rgba(139,92,246,0.22)",
                boxShadow: "0 0 20px rgba(139,92,246,0.06)",
              }}>
              <div className="flex items-center gap-2 mb-2">
                <span style={{ color: "#a78bfa", fontSize: 14 }}>✦</span>
                <p className="text-xs uppercase tracking-widest" style={{ color: "#a78bfa" }}>Gemini Analysis</p>
              </div>
              <p className="text-sm text-[#eef1f8] leading-relaxed">{result.reasoning}</p>
            </div>

            {/* New rules */}
            {result.rule_details.length > 0 && (
              <div>
                <p className="text-xs text-[#3a4060] uppercase tracking-widest mb-3">Generated Rules</p>
                <div className="flex flex-col gap-3">
                  {result.rule_details.map((r, i) => {
                    const actionMeta = ACTION_COLORS[r.action] ?? ACTION_COLORS.DENY;
                    const ActionIcon = r.action === "DENY" ? ShieldX : r.action === "ALLOW" ? ShieldCheck : Eye;
                    return (
                      <div key={r.name}
                        className="bg-[#091120] border border-white/[0.07] rounded-2xl p-4 transition-all duration-200"
                        style={{ borderLeft: `3px solid ${actionMeta.leftBorder}`, animationDelay: `${i * 80}ms` }}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-lg flex items-center justify-center"
                              style={{ background: actionMeta.bg, border: `1px solid ${actionMeta.border}` }}>
                              <ActionIcon size={11} style={{ color: actionMeta.color }} />
                            </div>
                            <span className="font-mono text-sm font-semibold" style={{ color: "#a78bfa" }}>{r.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono" style={{ color: "#22d3ee" }}>{r.condition}</span>
                            <span className="text-xs px-2 py-0.5 rounded-md font-bold"
                              style={{ color: actionMeta.color, background: actionMeta.bg, border: `1px solid ${actionMeta.border}` }}>
                              {r.action}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-[#eef1f8] mb-2">{r.reasoning}</p>
                        <div className="flex flex-wrap gap-1">
                          {r.addresses.map(id => (
                            <span key={id} className="text-xs font-mono text-[#8892a8] px-1.5 py-0.5 rounded"
                              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                              {id}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* YAML patch */}
            {result.diff_yaml && (
              <div className="rounded-2xl border border-white/[0.06] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/[0.05] flex items-center justify-between"
                  style={{ background: "#091120" }}>
                  <span className="text-xs text-[#3a4060] uppercase tracking-widest">YAML Patch</span>
                  <span className="text-xs text-[#3a4060] font-mono">{result.new_rule_count} new ingress rules</span>
                </div>
                <pre className="font-mono text-xs p-4 text-[#eef1f8] whitespace-pre overflow-x-auto max-h-[360px]"
                  style={{ background: "#030710" }}>
                  {result.diff_yaml}
                </pre>
              </div>
            )}

            {/* Apply / Discard */}
            {!applied ? (
              <div className="flex gap-3">
                <button
                  onClick={apply}
                  disabled={applying}
                  className="text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 disabled:opacity-40"
                  style={{ background: "linear-gradient(to right, #059669, #10d97c)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 20px rgba(16,217,124,0.35)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "none"; }}
                >
                  {applying ? "Applying…" : "Apply Patch & Reload Policy"}
                </button>
                <button
                  onClick={() => setResult(null)}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200"
                  style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.10)", color: "#eef1f8" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                >
                  Discard
                </button>
              </div>
            ) : (
              <div className="rounded-2xl p-4"
                style={{
                  background: "rgba(16,217,124,0.05)",
                  border: "1px solid rgba(16,217,124,0.22)",
                  boxShadow: "0 0 20px rgba(16,217,124,0.10)",
                }}>
                <div className="flex items-center gap-3 mb-1">
                  <CheckCircle2 size={16} style={{ color: "#10d97c" }} />
                  <span className="text-sm font-semibold" style={{ color: "#10d97c" }}>Policy reloaded successfully</span>
                </div>
                <p className="text-xs text-[#8892a8] ml-[28px] mb-4">
                  {result.new_rule_count} new rules active · Lobster Trap reloaded · Run Red Team again to verify improvement
                </p>

                {/* Download / Copy YAML */}
                <div className="ml-[28px] flex flex-col gap-3">
                  <p className="text-xs font-semibold text-[#eef1f8]">Updated Policy YAML</p>
                  <p className="text-[10px] text-[#3a4060]">
                    The patched policy is live in Lobster Trap. Download or copy it to deploy to your own infrastructure.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={downloadPolicy}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all duration-200"
                      style={{ background: "linear-gradient(to right, #0f766e, #10b981)" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 18px rgba(16,185,129,0.40)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "none"; }}
                    >
                      <Download size={13} />
                      Download finance_policy.yaml
                    </button>
                    <button
                      onClick={copyPolicy}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200"
                      style={copied ? {
                        background: "rgba(16,217,124,0.12)",
                        border: "1px solid rgba(16,217,124,0.35)",
                        color: "#10d97c",
                      } : {
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        color: "#eef1f8",
                      }}
                      onMouseEnter={e => { if (!copied) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)"; }}
                      onMouseLeave={e => { if (!copied) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)"; }}
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                      {copied ? "Copied!" : "Copy YAML"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
