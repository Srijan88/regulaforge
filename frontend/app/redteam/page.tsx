"use client";

import { useRef, useState } from "react";
import Shell from "@/components/Shell";
import { API, apiFetch } from "@/lib/api";
import ExplainabilityPanel, { ExplainData } from "@/components/ExplainabilityPanel";
import { useMode } from "@/contexts/ModeContext";
import { getMockAttacks } from "@/lib/mock-scenarios";
import {
  Crosshair, Play, ShieldCheck, ShieldX, AlertTriangle, Zap, Wrench,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Category definitions with layer sub-types
// ---------------------------------------------------------------------------
const CATEGORIES = [
  {
    id:          "social_engineering" as const,
    label:       "Social Engineering",
    short:       "SE",
    color:       "#f59e0b",
    description: "Authority impersonation & vendor fraud",
    layers: [
      { name: "BEC / Vendor Fraud",    desc: "Spoofed supplier account changes" },
      { name: "CFO Impersonation",     desc: "Executive wire transfer requests" },
      { name: "Invoice Manipulation",  desc: "Altered payment instructions" },
      { name: "Urgency Bypass",        desc: "Pressure-based approval tricks" },
    ],
  },
  {
    id:          "jailbreak" as const,
    label:       "Jailbreak",
    short:       "JB",
    color:       "#ef4444",
    description: "Instruction override & policy bypass",
    layers: [
      { name: "Persona Override",       desc: "Adopt an unrestricted identity" },
      { name: "Escalation Failure",     desc: "Bypass human-review escalation" },
      { name: "Guardrail Bypass",       desc: "Strip compliance constraints" },
      { name: "Training Mode Exploit",  desc: "Sandbox / demo context abuse" },
    ],
  },
  {
    id:          "tool_exploitation" as const,
    label:       "Tool Exploitation",
    short:       "TE",
    color:       "#3b82f6",
    description: "Function-call abuse & API injection",
    layers: [
      { name: "Unsafe Execution",   desc: "Trigger tools without auth" },
      { name: "SQL Injection",      desc: "DB query parameter tampering" },
      { name: "Function Hijack",    desc: "Redirect tool calls to attacker" },
      { name: "Indirect Injection", desc: "Payload embedded in tool results" },
    ],
  },
  {
    id:          "pii_exfiltration" as const,
    label:       "PII Exfiltration",
    short:       "PII",
    color:       "#10b981",
    description: "Credential theft & bulk data harvesting",
    layers: [
      { name: "Account Harvesting", desc: "Bulk routing/account extraction" },
      { name: "Credential Theft",   desc: "API keys, passwords, PINs" },
      { name: "Audit Pretexting",   desc: "Fake compliance review requests" },
      { name: "Bulk Data Leak",     desc: "Mass PII export via query abuse" },
    ],
  },
  {
    id:          "sanctions_fraud" as const,
    label:       "Sanctions & Wire Fraud",
    short:       "SF",
    color:       "#8b5cf6",
    description: "OFAC bypass & AML evasion",
    layers: [
      { name: "OFAC Bypass",             desc: "Sanctioned entity payments" },
      { name: "Shell Company Routing",   desc: "BVI / Cayman intermediaries" },
      { name: "Crypto Laundering",       desc: "Crypto on-ramp obfuscation" },
      { name: "Intermediary Obfuscation", desc: "Multi-hop fund routing" },
    ],
  },
] as const;

type CategoryId = typeof CATEGORIES[number]["id"];

const ATTACK_COUNT_OPTIONS = [10, 20, 30, 40, 50, 100];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface VerdictRow {
  attack_id: string;
  prompt: string;
  verdict: string;
  expected: string;
  passed: boolean;
  matched_rule?: string;
  latency_ms: number;
  enforced_by?: string;
  risk_score?: number;
  category?: string;
  category_label?: string;
  lobster_trap_response?: Record<string, unknown>;
}

interface Summary {
  run_id: string;
  total_attacks: number;
  passed: number;
  failed: number;
  pass_rate: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function verdictColor(v: string) {
  const u = v.replace("RuleAction.", "").toUpperCase();
  if (u === "DENY")         return "#f04747";
  if (u === "HUMAN_REVIEW") return "#f59e0b";
  if (u === "ALLOW")        return "#10d97c";
  return "#8892a8";
}

function getCatMeta(id?: string) {
  return CATEGORIES.find(c => c.id === id);
}

function CategoryBadge({ categoryId }: { categoryId?: string }) {
  const cat = getCatMeta(categoryId);
  if (!cat) return null;
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wide shrink-0"
      style={{ background: `${cat.color}18`, color: cat.color, border: `1px solid ${cat.color}35` }}
    >
      {cat.short}
    </span>
  );
}

function layerBadge(row: VerdictRow) {
  const by = row.enforced_by ?? "lobster_trap";
  if (by === "gemini_semantic_layer") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono"
        style={{ background: "rgba(139,92,246,0.18)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.30)" }}>
        ✦ Gemini{row.matched_rule ? ` · ${row.matched_rule}` : ""}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono"
      style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.25)" }}>
      ⬡ LT{row.matched_rule ? ` · ${row.matched_rule}` : ""}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Category selection card
// ---------------------------------------------------------------------------
function CategoryCard({
  cat,
  active,
  disabled,
  onToggle,
}: {
  cat: typeof CATEGORIES[number];
  active: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className="relative text-left rounded-2xl p-4 transition-all duration-200 disabled:opacity-50 w-full"
      style={active ? {
        background:    `${cat.color}10`,
        border:        `1.5px solid ${cat.color}55`,
        boxShadow:     `0 0 18px ${cat.color}14`,
      } : {
        background:   "rgba(255,255,255,0.02)",
        border:       "1.5px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Check mark */}
      {active && (
        <span
          className="absolute top-3 right-3 w-4 h-4 rounded-full flex items-center justify-center text-[10px]"
          style={{ background: cat.color, color: "#000" }}
        >✓</span>
      )}

      {/* Badge + name */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md"
          style={active
            ? { background: `${cat.color}25`, color: cat.color }
            : { background: "rgba(255,255,255,0.06)", color: "#3a4060" }
          }
        >
          {cat.short}
        </span>
        <p className="text-xs font-semibold" style={{ color: active ? "#eef1f8" : "#8892a8" }}>
          {cat.label}
        </p>
      </div>

      {/* Description */}
      <p className="text-[10px] mb-3" style={{ color: active ? `${cat.color}99` : "#3a4060" }}>
        {cat.description}
      </p>

      {/* Layer sub-types */}
      <div className="space-y-1">
        {cat.layers.map(layer => (
          <div key={layer.name} className="flex items-start gap-1.5">
            <ChevronRight
              size={9}
              className="mt-0.5 shrink-0"
              style={{ color: active ? `${cat.color}80` : "#2a3050" }}
            />
            <div>
              <span
                className="text-[10px] font-medium"
                style={{ color: active ? "#eef1f8" : "#3a4060" }}
              >
                {layer.name}
              </span>
              <span
                className="text-[9px] ml-1"
                style={{ color: active ? "#3a5060" : "#1e2540" }}
              >
                — {layer.desc}
              </span>
            </div>
          </div>
        ))}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Why? modal
// ---------------------------------------------------------------------------
interface WhyModal { row: VerdictRow; data: ExplainData | null; loading: boolean; }

function WhyModalOverlay({ modal, onClose }: { modal: WhyModal; onClose: () => void }) {
  const verdictStr = modal.row.verdict.replace("RuleAction.", "").toUpperCase();
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
        style={{ background: "#091120", borderColor: "rgba(255,255,255,0.10)" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.07]">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-[#8892a8]">Compliance Explanation</span>
            <span className="text-xs font-mono text-[#3a4060]">·</span>
            <span className="text-xs font-mono text-[#3a4060] truncate max-w-[180px]">{modal.row.attack_id}</span>
          </div>
          <button onClick={onClose} className="text-[#3a4060] hover:text-[#8892a8] text-lg leading-none">×</button>
        </div>
        <div className="p-4">
          <p className="text-xs text-[#8892a8] mb-3 italic">"{modal.row.prompt.slice(0, 120)}{modal.row.prompt.length > 120 ? "…" : ""}"</p>
          <ExplainabilityPanel
            verdict={verdictStr}
            rule_name={modal.row.matched_rule}
            risk_score={modal.row.risk_score}
            enforced_by={modal.row.enforced_by}
            data={modal.data}
            loading={modal.loading}
            compact
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attack row
// ---------------------------------------------------------------------------
function AttackRow({ row, idx, onWhy }: { row: VerdictRow; idx: number; onWhy: (row: VerdictRow) => void }) {
  const [open, setOpen] = useState(false);
  const verdictStr  = row.verdict.replace("RuleAction.", "").toUpperCase();
  const expectedStr = row.expected.replace("RuleAction.", "").toUpperCase();
  const geminiGuard = row.lobster_trap_response?.gemini_guard as Record<string, string> | undefined;

  const passStyle = row.passed
    ? { borderLeft: "2px solid rgba(16,217,124,0.35)" }
    : { borderLeft: "2px solid rgba(240,71,71,0.35)" };

  return (
    <>
      <tr
        className={`border-b border-white/[0.04] cursor-pointer transition-colors ${open ? "bg-white/[0.04]" : "hover:bg-white/[0.02]"} animate-[fadeIn_0.15s_ease-in]`}
        onClick={() => setOpen(!open)}
        style={{ animationDelay: `${idx * 18}ms`, ...passStyle }}
      >
        <td className="px-3 py-2.5 w-32">
          <div className="flex items-center gap-1.5">
            <CategoryBadge categoryId={row.category} />
            <span className="text-[10px] font-mono truncate max-w-[70px]" style={{ color: row.attack_id.startsWith("ATK") ? "#f04747" : "#10d97c" }}>
              {row.attack_id}
            </span>
          </div>
        </td>
        <td className="px-3 py-2.5 text-xs text-[#eef1f8] max-w-[240px]">
          <span className="line-clamp-1">{row.prompt}</span>
        </td>
        <td className="px-3 py-2.5 w-40">{layerBadge(row)}</td>
        <td className="px-3 py-2.5 text-xs font-mono font-bold w-28" style={{ color: verdictColor(verdictStr) }}>
          {verdictStr}
        </td>
        <td className="px-3 py-2.5 text-xs font-mono w-20"
          style={{ color: (row.risk_score ?? 0) >= 0.25 ? "#10d97c" : "#f04747" }}>
          {typeof row.risk_score === "number" ? row.risk_score.toFixed(3) : "—"}
        </td>
        <td className="px-3 py-2.5 text-xs font-mono text-[#3a4060] w-20">
          {row.latency_ms > 0 ? `${Math.round(row.latency_ms)}ms` : "—"}
        </td>
        <td className="px-3 py-2.5 w-16">
          <span className="text-xs font-bold font-mono px-2 py-0.5 rounded-md"
            style={row.passed ? {
              color: "#10d97c", background: "rgba(16,217,124,0.10)", border: "1px solid rgba(16,217,124,0.22)",
            } : {
              color: "#f04747", background: "rgba(240,71,71,0.10)", border: "1px solid rgba(240,71,71,0.22)",
            }}>
            {row.passed ? "PASS" : "FAIL"}
          </span>
        </td>
        <td className="px-3 py-2.5 w-16 text-right">
          {(verdictStr === "DENY" || verdictStr === "HUMAN_REVIEW" || !row.passed) && (
            <button
              onClick={(e) => { e.stopPropagation(); onWhy(row); }}
              className="text-[10px] font-mono px-2 py-0.5 rounded-md transition-all duration-200"
              style={!row.passed && verdictStr === "ALLOW"
                ? { color: "#f04747", background: "rgba(240,71,71,0.10)", border: "1px solid rgba(240,71,71,0.30)" }
                : { color: "#a78bfa", background: "rgba(139,92,246,0.10)", border: "1px solid rgba(139,92,246,0.25)" }}
              onMouseEnter={(e) => {
                const s = (e.currentTarget as HTMLButtonElement).style;
                s.background = !row.passed && verdictStr === "ALLOW" ? "rgba(240,71,71,0.20)" : "rgba(139,92,246,0.20)";
              }}
              onMouseLeave={(e) => {
                const s = (e.currentTarget as HTMLButtonElement).style;
                s.background = !row.passed && verdictStr === "ALLOW" ? "rgba(240,71,71,0.10)" : "rgba(139,92,246,0.10)";
              }}
            >
              {!row.passed && verdictStr === "ALLOW" ? "⚠ Gap?" : "📋 Why?"}
            </button>
          )}
        </td>
        <td className="px-3 py-2.5 w-6 text-[#3a4060] text-xs">{open ? "▲" : "▼"}</td>
      </tr>
      {open && (
        <tr style={{ background: "#050b17" }}>
          <td colSpan={9} className="px-6 py-4 text-xs">
            <div className="space-y-2">
              {row.category_label && (
                <div className="flex items-center gap-2">
                  <CategoryBadge categoryId={row.category} />
                  <span className="text-[10px] text-[#8892a8]">{row.category_label}</span>
                </div>
              )}
              <div>
                <span className="text-[#3a4060] uppercase tracking-widest text-[10px]">Full prompt</span>
                <p className="mt-1 text-[#eef1f8] leading-relaxed">{row.prompt}</p>
              </div>
              <div className="flex flex-wrap gap-4 mt-2">
                {[
                  { label: "Expected",    value: expectedStr,   color: verdictColor(expectedStr) },
                  { label: "Got",         value: verdictStr,    color: verdictColor(verdictStr) },
                  { label: "Enforced by", value: row.enforced_by ?? "lobster_trap", color: "#eef1f8" },
                  { label: "Rule",        value: row.matched_rule ?? "—",           color: "#eef1f8" },
                  { label: "Risk score",  value: typeof row.risk_score === "number" ? row.risk_score.toFixed(4) : "—", color: (row.risk_score ?? 0) >= 0.25 ? "#10d97c" : "#f04747" },
                  { label: "Latency",     value: row.latency_ms > 0 ? `${row.latency_ms.toFixed(1)}ms` : "—", color: "#eef1f8" },
                ].map(f => (
                  <div key={f.label}>
                    <span className="text-[#3a4060] uppercase tracking-widest text-[10px]">{f.label}</span>
                    <p className="mt-0.5 font-mono font-bold" style={{ color: f.color }}>{f.value}</p>
                  </div>
                ))}
              </div>
              {geminiGuard && (
                <div className="mt-3 p-3 rounded-xl" style={{ background: "rgba(139,92,246,0.10)", border: "1px solid rgba(139,92,246,0.22)" }}>
                  <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "#a78bfa" }}>✦ Gemini Semantic Guard</p>
                  <div className="space-y-1">
                    <p className="text-[#eef1f8]"><span className="text-[#3a4060] w-20 inline-block">Verdict:</span>
                      <span className="font-bold" style={{ color: geminiGuard.verdict === "DENY" ? "#f04747" : "#f59e0b" }}>{geminiGuard.verdict}</span></p>
                    <p className="text-[#eef1f8]"><span className="text-[#3a4060] w-20 inline-block">Category:</span> {geminiGuard.category}</p>
                    <p className="text-[#eef1f8]"><span className="text-[#3a4060] w-20 inline-block">Reason:</span> {geminiGuard.reason}</p>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function RedTeamPage() {
  const [rows, setRows]         = useState<VerdictRow[]>([]);
  const [summary, setSummary]   = useState<Summary | null>(null);
  const [running, setRunning]   = useState(false);
  const [buildingPhase, setBuildingPhase] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [runId, setRunId]       = useState<string | null>(null);
  const [whyModal, setWhyModal] = useState<WhyModal | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // No categories selected by default — user must choose
  const [selectedCats, setSelectedCats] = useState<Set<CategoryId>>(new Set());
  const [attackCount, setAttackCount]   = useState(20);
  // Full-stack opt-in: Gemini layer disabled by default.
  // Default is policy-only — tests what your COMPILED RULES catch, not Gemini's general intelligence.
  const [fullStack, setFullStack]       = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollIndexRef = useRef<number>(0);
  const { mode, selectedPolicy } = useMode();

  const toggleCat = (id: CategoryId) => {
    setSelectedCats(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canRun = mode === "mock" || selectedCats.size > 0;

  const openWhy = async (row: VerdictRow) => {
    setWhyModal({ row, data: null, loading: true });
    if (mode === "mock" && selectedPolicy) {
      await new Promise(r => setTimeout(r, 500));
      const verdictStr = row.verdict.replace("RuleAction.", "").toUpperCase();
      const isGap = !row.passed && verdictStr === "ALLOW";
      setWhyModal(prev => prev ? { ...prev, loading: false, data: isGap ? {
        what_detected:      "No compiled rule matched this attack — policy gap detected",
        policy_violated:    `${selectedPolicy.name} — rule missing for this attack vector`,
        what_would_happen:  "Attack passed through undetected. Use Heal to generate a new rule that covers this pattern.",
        severity:           "HIGH",
        regulation_reference: selectedPolicy.name,
        audit_id:           `gap-mock-${Math.random().toString(16).slice(2, 6)}`,
        timestamp:          new Date().toISOString(),
      } : {
        what_detected:      `Attack pattern matched '${row.matched_rule || "policy rule"}'`,
        policy_violated:    `${selectedPolicy.name} — ${row.matched_rule || "compliance rule"}`,
        what_would_happen:  "Transaction blocked and logged to compliance audit trail",
        severity:           (row.risk_score ?? 0) > 0.9 ? "CRITICAL" : (row.risk_score ?? 0) > 0.7 ? "HIGH" : "MEDIUM",
        regulation_reference: selectedPolicy.name,
        audit_id:           `reg-mock-${Math.random().toString(16).slice(2, 6)}`,
        timestamp:          new Date().toISOString(),
      } } : null);
      return;
    }
    try {
      const explain = await apiFetch<ExplainData>("/simulate/explain", {
        method: "POST",
        body: JSON.stringify({
          prompt: row.prompt, verdict: row.verdict.replace("RuleAction.", ""),
          rule_name: row.matched_rule ?? null, risk_score: row.risk_score ?? 0,
          enforced_by: row.enforced_by ?? "lobster_trap",
        }),
      });
      setWhyModal(prev => prev ? { ...prev, data: explain, loading: false } : null);
    } catch {
      setWhyModal(prev => prev ? { ...prev, loading: false } : null);
    }
  };

  const runAttacks = () => {
    if (running || !canRun) return;
    setRows([]);
    setSummary(null);
    setRunning(true);
    setBuildingPhase(true);
    setProgress({ done: 0, total: 0 });
    setRunError(null);

    if (mode === "mock" && selectedPolicy) {
      setBuildingPhase(false);
      const catFilter = selectedCats.size > 0 ? Array.from(selectedCats) : undefined;
      const mockAttacks = getMockAttacks(selectedPolicy.id, catFilter);
      const total = mockAttacks.length;
      const mockRunId = `mock-${selectedPolicy.id}-${Date.now().toString(16).slice(-6)}`;
      let cancelled = false, i = 0;
      const tick = setInterval(() => {
        if (cancelled) { clearInterval(tick); return; }
        if (i < total) {
          const atk = mockAttacks[i];
          if (atk) setRows(prev => [...prev, atk as unknown as VerdictRow]);
          setProgress({ done: i + 1, total });
          i++;
        } else {
          clearInterval(tick);
          if (cancelled) return;
          const passed = mockAttacks.filter(a => a.passed).length;
          setSummary({ run_id: mockRunId, total_attacks: total, passed, failed: total - passed, pass_rate: Math.round((passed / total) * 100) });
          setRunId(mockRunId);
          localStorage.setItem("last_run_id", mockRunId);
          setRunning(false);
        }
      }, 120);
      pollRef.current = tick;
      return;
    }

    // Start background run then poll for incremental results
    const cats = Array.from(selectedCats).join(",");
    const qs   = `categories=${cats}&total=${attackCount}&concurrency=2&disable_gemini=${!fullStack}`;

    apiFetch<{ run_id: string; total: number }>(
      `/redteam/start/finance-combined?${qs}`,
      { method: "POST" },
    ).then(({ run_id, total }) => {
      setBuildingPhase(false);
      setProgress({ done: 0, total });
      pollIndexRef.current = 0;

      const timer = setInterval(async () => {
        try {
          const data = await apiFetch<{
            verdicts: VerdictRow[];
            total: number;
            done: boolean;
            summary: Summary | null;
            error: string | null;
          }>(`/redteam/progress/${run_id}?from_index=${pollIndexRef.current}`);

          if (data.total > 0) setBuildingPhase(false);
          if (data.verdicts.length > 0) {
            pollIndexRef.current += data.verdicts.length;
            setRows(prev => [...prev, ...data.verdicts]);
            setProgress({ done: pollIndexRef.current, total: data.total });
          }

          if (data.done) {
            clearInterval(timer);
            if (data.summary) {
              const s = { ...data.summary, run_id };
              setSummary(s);
              setRunId(run_id);
              localStorage.setItem("last_run_id", run_id);
            }
            setRunning(false);
          }
          if (data.error) {
            clearInterval(timer);
            setRunning(false);
          }
        } catch (e) {
          clearInterval(timer);
          setRunning(false);
          setRunError(String(e));
        }
      }, 600);

      pollRef.current = timer;
    }).catch((e: unknown) => {
      setBuildingPhase(false);
      setRunning(false);
      setRunError(e instanceof Error ? e.message : String(e));
    });
  };

  const pct         = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const passedCount = rows.filter(r => r.passed).length;
  const failedCount = rows.filter(r => !r.passed).length;
  const ltCount     = rows.filter(r => !r.enforced_by || r.enforced_by === "lobster_trap").length;
  const geminiCount = rows.filter(r => r.enforced_by === "gemini_semantic_layer").length;

  return (
    <Shell activeTab="redteam">
      <div className="p-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.25)", boxShadow: "0 0 14px rgba(59,130,246,0.15)" }}>
              <Crosshair size={18} style={{ color: "#3b82f6" }} />
            </div>
            <div>
              <h2 className="text-base font-semibold bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] bg-clip-text text-transparent">
                Red Team Evaluation
              </h2>
              {mode === "mock" && selectedPolicy
                ? <p className="text-[10px] text-[#a78bfa] mt-0.5">{selectedPolicy.icon} {selectedPolicy.name} · mock mode</p>
                : fullStack
                ? <p className="text-[10px] text-[#a78bfa] mt-0.5 flex items-center gap-1"><Zap size={9} /> Full-stack — LT + Gemini Semantic Guard</p>
                : <p className="text-[10px] text-[#f87171] mt-0.5 flex items-center gap-1">⬡ Policy-only — testing compiled LT rules, Gemini disabled</p>
              }
            </div>
          </div>
          <button
            onClick={runAttacks}
            disabled={running || !canRun}
            className="flex items-center gap-2 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 disabled:opacity-40"
            style={{ background: "linear-gradient(to right, #2563eb, #4f46e5)" }}
            onMouseEnter={(e) => { if (canRun && !running) (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 20px rgba(79,70,229,0.45)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "none"; }}
          >
            <Play size={13} />
            {buildingPhase ? "Building suite…"
              : running ? `Running… ${pct}%`
              : mode === "mock" ? `Run ${selectedPolicy ? getMockAttacks(selectedPolicy.id, selectedCats.size > 0 ? Array.from(selectedCats) : undefined).length : 0} Attacks`
              : selectedCats.size > 0 ? `Run ${attackCount} Attacks`
              : "Select Categories"}
          </button>
        </div>

        {/* ── Category selection cards + attack count ── */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-semibold text-[#eef1f8]">Attack Categories</p>
              <p className="text-[10px] text-[#3a4060] mt-0.5">
                {selectedCats.size === 0
                  ? "Select categories to filter, or run All"
                  : mode === "mock" && selectedPolicy
                  ? `${selectedCats.size} of ${CATEGORIES.length} selected · ${getMockAttacks(selectedPolicy.id, Array.from(selectedCats)).length} attacks`
                  : `${selectedCats.size} of ${CATEGORIES.length} selected · ${attackCount} attacks total`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Select All / Clear All — both modes */}
              <button
                onClick={() => setSelectedCats(new Set(CATEGORIES.map(c => c.id)))}
                disabled={running || selectedCats.size === CATEGORIES.length}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 disabled:opacity-40"
                style={{ background: "rgba(59,130,246,0.10)", border: "1px solid rgba(59,130,246,0.30)", color: "#60a5fa" }}
              >
                All
              </button>
              <button
                onClick={() => setSelectedCats(new Set())}
                disabled={running || selectedCats.size === 0}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 disabled:opacity-40"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", color: "#8892a8" }}
              >
                Clear
              </button>

              {/* Live-mode only: Gemini toggle + attack count */}
              {mode !== "mock" && (
                <>
                  <div className="w-px h-5 mx-1" style={{ background: "rgba(255,255,255,0.08)" }} />
                  <button
                    onClick={() => setFullStack(f => !f)}
                    disabled={running}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 disabled:opacity-50"
                    style={fullStack ? {
                      background: "rgba(139,92,246,0.15)",
                      border: "1px solid rgba(139,92,246,0.50)",
                      color: "#a78bfa",
                    } : {
                      background: "rgba(240,71,71,0.08)",
                      border: "1px solid rgba(240,71,71,0.30)",
                      color: "#f87171",
                    }}
                    title={fullStack
                      ? "Full Stack: LT + Gemini active. Click to switch back to policy-only mode."
                      : "Policy Only: Gemini disabled. Click to enable full-stack mode (fewer failures)."}
                  >
                    {fullStack ? "✦ Gemini ON" : "⬡ Gemini OFF"}
                  </button>
                  <span className="text-[10px] text-[#3a4060] uppercase tracking-widest">Attacks</span>
                  <select
                    value={attackCount}
                    onChange={e => setAttackCount(Number(e.target.value))}
                    disabled={running}
                    className="rounded-xl px-3 py-1.5 text-sm font-mono disabled:opacity-50"
                    style={{ background: "#091120", border: "1px solid rgba(59,130,246,0.35)", color: "#60a5fa", minWidth: 70 }}
                  >
                    {ATTACK_COUNT_OPTIONS.map(n => (
                      <option key={n} value={n} style={{ background: "#091120", color: "#eef1f8" }}>{n}</option>
                    ))}
                  </select>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-5 gap-3">
            {CATEGORIES.map(cat => (
              <CategoryCard
                key={cat.id}
                cat={cat}
                active={selectedCats.has(cat.id)}
                disabled={running}
                onToggle={() => toggleCat(cat.id)}
              />
            ))}
          </div>

          {/* Empty-selection hint */}
          {selectedCats.size === 0 && !running && (
            <div className="mt-3 flex items-center gap-2 text-[11px] text-[#3a4060]"
              style={{ paddingLeft: 4 }}>
              <span style={{ color: "#f59e0b" }}>↑</span>
              {mode === "mock"
                ? "Select categories to filter — or run all attacks at once"
                : "Click a category card above to include those attacks in the suite"}
            </div>
          )}
        </div>

        {/* ── Building phase indicator ── */}
        {buildingPhase && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-xl text-xs font-mono"
            style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.20)", color: "#a78bfa" }}>
            <span className="animate-spin inline-block w-3 h-3 border border-purple-400 border-t-transparent rounded-full" />
            Fetching HuggingFace dataset + generating Gemini attacks in parallel…
          </div>
        )}

        {/* ── Progress bar ── */}
        {running && !buildingPhase && (
          <div className="w-full rounded-full h-1.5 mb-5" style={{ background: "rgba(255,255,255,0.05)" }}>
            <div className="h-full rounded-full transition-all duration-300"
              style={{ width: `${pct}%`, background: "linear-gradient(to right, #3b82f6, #8b5cf6)" }} />
          </div>
        )}

        {/* ── Live counters ── */}
        {(running || summary) && rows.length > 0 && (
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              { label: "Total",     value: progress.total || summary?.total_attacks || 0, color: "#eef1f8",  Icon: Crosshair,   shadow: "rgba(238,241,248,0.15)" },
              { label: "Passed",    value: passedCount,   color: "#10d97c",  Icon: ShieldCheck, shadow: "rgba(16,217,124,0.25)" },
              { label: "Failed",    value: failedCount,   color: "#f04747",  Icon: ShieldX,     shadow: "rgba(240,71,71,0.25)"  },
              { label: "Pass rate", value: rows.length > 0 ? `${Math.round((passedCount / rows.length) * 100)}%` : "—", color: "#22d3ee", Icon: AlertTriangle, shadow: "rgba(34,211,238,0.20)" },
            ].map(s => (
              <div key={s.label}
                className="bg-[#091120] border border-white/[0.07] rounded-2xl p-4 hover:border-white/[0.13] transition-all duration-200"
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 20px rgba(0,0,0,0.40)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center"
                    style={{ background: `${s.color}15`, border: `1px solid ${s.color}25` }}>
                    <s.Icon size={11} style={{ color: s.color }} />
                  </div>
                  <p className="text-[10px] text-[#3a4060] uppercase tracking-widest">{s.label}</p>
                </div>
                <p className="text-2xl font-bold font-mono" style={{ color: s.color, textShadow: `0 0 12px ${s.shadow}` }}>
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* ── Layer + category breakdown ── */}
        {rows.length > 0 && (
          <div className="flex flex-wrap gap-4 mb-4 text-xs font-mono items-center">
            <span style={{ color: "#60a5fa" }}>⬡ LT enforced: {ltCount}</span>
            {fullStack && <span style={{ color: "#a78bfa" }}>✦ Gemini enforced: {geminiCount}</span>}
            {!fullStack && <span style={{ color: "#f87171" }}>⬡ Gemini layer disabled</span>}
            <span className="text-[#1e2540]">|</span>
            {CATEGORIES.filter(c => selectedCats.has(c.id)).map(cat => {
              const catRows   = rows.filter(r => r.category === cat.id);
              if (catRows.length === 0) return null;
              const catPassed = catRows.filter(r => r.passed).length;
              return (
                <span key={cat.id} className="flex items-center gap-1">
                  <span className="text-[9px] font-bold px-1 rounded"
                    style={{ background: `${cat.color}18`, color: cat.color }}>
                    {cat.short}
                  </span>
                  <span style={{ color: catPassed === catRows.length ? "#10d97c" : catPassed === 0 ? "#f04747" : "#f59e0b" }}>
                    {catPassed}/{catRows.length}
                  </span>
                </span>
              );
            })}
          </div>
        )}

        {/* ── Run ID + Heal CTA ── */}
        {runId && !running && (
          <div className="flex items-center justify-between mb-4 gap-4">
            <p className="text-xs text-[#3a4060] font-mono">
              run_id: <span className="text-[#8892a8]">{runId}</span>
            </p>
            {failedCount > 0 && (
              <Link
                href="/heal"
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all duration-200 shrink-0"
                style={{ background: "linear-gradient(to right, #7c3aed, #4f46e5)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 0 20px rgba(124,58,237,0.50)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.boxShadow = "none"; }}
              >
                <Wrench size={13} />
                Heal {failedCount} Failing Rule{failedCount !== 1 ? "s" : ""}
              </Link>
            )}
          </div>
        )}

        {/* ── Results table ── */}
        {rows.length > 0 && (
          <div className="rounded-2xl border border-white/[0.06] overflow-hidden" style={{ background: "#091120" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {["ID / Cat", "Prompt", "Layer", "Verdict", "Risk ≥0.25", "Latency", "Result", "Why?", ""].map(h => (
                    <th key={h} className="text-left px-3 py-3 text-[10px] text-[#3a4060] uppercase tracking-widest font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.filter(r => r?.attack_id).map((row, i) => (
                  <AttackRow key={row.attack_id} row={row} idx={i} onWhy={openWhy} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Error banner ── */}
        {runError && (
          <div className="mb-4 px-4 py-3 rounded-xl text-xs font-mono break-all"
            style={{ background: "rgba(240,71,71,0.10)", border: "1px solid rgba(240,71,71,0.30)", color: "#f87171" }}>
            <span className="font-bold">Error: </span>{runError}
          </div>
        )}

        {/* ── Empty state ── */}
        {rows.length === 0 && !running && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.15)" }}>
              <Crosshair size={24} style={{ color: "rgba(59,130,246,0.40)" }} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-[#8892a8]">No attacks run yet</p>
              <p className="text-xs text-[#3a4060] mt-1">
                {selectedCats.size === 0
                  ? "Select attack categories above to configure your test suite"
                  : `${selectedCats.size} categories selected — press Run ${attackCount} Attacks`}
              </p>
            </div>
          </div>
        )}
      </div>

      {whyModal && <WhyModalOverlay modal={whyModal} onClose={() => setWhyModal(null)} />}

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </Shell>
  );
}
