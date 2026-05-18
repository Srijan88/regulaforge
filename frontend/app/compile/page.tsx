"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { API } from "@/lib/api";
import { useMode } from "@/contexts/ModeContext";
import { getMockRules } from "@/lib/mock-scenarios";
import {
  UploadCloud, FileText, CheckCircle2, AlertCircle, Loader2,
  ShieldX, ShieldCheck, Eye, ChevronDown, ChevronRight, Sparkles, Zap,
} from "lucide-react";

interface PolicyRule {
  id: string;
  name: string;
  description: string;
  action: string;
  severity: string;
  source_clauses: { source_doc: string; section: string }[];
}

const SEVERITY_META: Record<string, { color: string; shadow: string; dot: string }> = {
  critical: { color: "#f04747", shadow: "rgba(240,71,71,0.45)",   dot: "bg-[#f04747]" },
  high:     { color: "#f59e0b", shadow: "rgba(245,158,11,0.45)",  dot: "bg-[#f59e0b]" },
  medium:   { color: "#22d3ee", shadow: "rgba(34,211,238,0.40)",  dot: "bg-[#22d3ee]" },
  low:      { color: "#3a4060", shadow: "rgba(58,64,96,0.30)",    dot: "bg-[#3a4060]" },
};

const ACTION_META: Record<string, { label: string; color: string; bg: string; border: string; leftBorder: string; Icon: typeof ShieldCheck }> = {
  deny:  { label: "DENY",  color: "#f04747", bg: "rgba(240,71,71,0.12)",  border: "rgba(240,71,71,0.25)", leftBorder: "#f04747", Icon: ShieldX     },
  audit: { label: "AUDIT", color: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.25)",leftBorder: "#f59e0b", Icon: Eye          },
  allow: { label: "ALLOW", color: "#10d97c", bg: "rgba(16,217,124,0.10)", border: "rgba(16,217,124,0.22)",leftBorder: "#10d97c", Icon: ShieldCheck  },
};

function RuleCard({ rule, idx }: { rule: PolicyRule; idx: number }) {
  const [expanded, setExpanded] = useState(false);
  const sev    = SEVERITY_META[rule.severity] ?? SEVERITY_META.low;
  const action = ACTION_META[rule.action] ?? {
    label: rule.action.toUpperCase(), color: "#8892a8",
    bg: "rgba(136,146,168,0.10)", border: "rgba(136,146,168,0.20)",
    leftBorder: "#8892a8", Icon: ShieldCheck,
  };
  const { Icon: ActionIcon } = action;

  return (
    <div
      className="bg-[#091120] border border-white/[0.07] rounded-2xl overflow-hidden transition-all duration-200 hover:border-white/[0.13]"
      style={{
        borderLeft: `3px solid ${action.leftBorder}`,
        animationDelay: `${idx * 30}ms`,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 20px rgba(0,0,0,0.35)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
      }}
    >
      <div
        className="flex items-center gap-3 p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Action icon */}
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: action.bg, border: `1px solid ${action.border}` }}
        >
          <ActionIcon size={14} style={{ color: action.color }} />
        </div>

        {/* Name + description */}
        <div className="flex-1 min-w-0">
          <span className="font-mono text-sm font-semibold text-[#eef1f8] block truncate">{rule.name}</span>
          <span className="text-xs text-[#3a4060] truncate block mt-0.5">{rule.description}</span>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} style={{ boxShadow: `0 0 5px ${sev.color}` }} />
            <span className="text-xs font-mono" style={{ color: sev.color }}>{rule.severity}</span>
          </div>
          <span
            className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg"
            style={{ background: action.bg, color: action.color, border: `1px solid ${action.border}` }}
          >
            {action.label}
          </span>
          <span className="text-[#3a4060]">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-white/[0.05] px-4 pb-4 pt-3 bg-[#050b17]/60">
          <p className="text-xs text-[#8892a8] leading-relaxed mb-3">{rule.description}</p>
          {rule.source_clauses.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {rule.source_clauses.map((c, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded-lg"
                  style={{ color: "#22d3ee", background: "rgba(34,211,238,0.07)", border: "1px solid rgba(34,211,238,0.20)" }}>
                  <FileText size={9} />
                  {c.source_doc} §{c.section}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ProgressInfo {
  message: string;
  chunk_index: number;
  total_chunks: number;
  pass_num: number;
}

const PRESET_POLICIES = [
  {
    id:          "pci-dss",
    name:        "PCI-DSS v4.0",
    description: "Payment Card Industry Data Security Standard",
    icon:        "💳",
    color:       "#3b82f6",
    tags:        ["22 rules", "Cardholder data", "Access control"],
  },
  {
    id:          "ffiec",
    name:        "FFIEC Handbook",
    description: "Federal Financial Institutions Examination Council",
    icon:        "🏦",
    color:       "#10b981",
    tags:        ["18 rules", "Banking IT", "Fraud detection"],
  },
  {
    id:          "ofac",
    name:        "OFAC Sanctions",
    description: "Office of Foreign Assets Control — SDN screening",
    icon:        "🌐",
    color:       "#8b5cf6",
    tags:        ["15 rules", "Wire screening", "AML/KYC"],
  },
] as const;

export default function CompilePage() {
  const [rules, setRules]   = useState<PolicyRule[]>([]);
  const [status, setStatus] = useState<"idle" | "streaming" | "done" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [progress, setProgress]   = useState<ProgressInfo | null>(null);
  const [dragging, setDragging]   = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const { mode, selectedPolicy }  = useMode();

  // Mock mode: stream pre-built rules with a simulated delay
  useEffect(() => {
    if (mode !== "mock" || !selectedPolicy) return;

    const policyId   = selectedPolicy.id;
    const policyName = selectedPolicy.name;
    const mockRules  = getMockRules(policyId);
    let cancelled    = false;

    setRules([]);
    setStatus("streaming");
    setStatusMsg(`Loading ${policyName} demo policy…`);

    let i = 0;
    const tick = setInterval(() => {
      if (cancelled) { clearInterval(tick); return; }
      if (i < mockRules.length) {
        const rule = mockRules[i];
        if (rule) setRules((prev) => [...prev, rule]);
        i++;
      } else {
        clearInterval(tick);
        if (!cancelled) {
          setStatus("done");
          setStatusMsg(`Loaded ${mockRules.length} rules from ${policyName} (demo)`);
        }
      }
    }, 80);

    return () => { cancelled = true; clearInterval(tick); };
  }, [mode, selectedPolicy]);

  const uploadPdf = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setStatus("error");
      setStatusMsg("Only PDF files accepted.");
      return;
    }

    setRules([]);
    setProgress(null);
    setStatus("streaming");
    setStatusMsg(`Extracting rules from ${file.name}…`);

    const form = new FormData();
    form.append("file", file);

    const res = await fetch(`${API}/compile/upload`, { method: "POST", body: form });
    if (!res.ok || !res.body) {
      setStatus("error");
      setStatusMsg(`Upload failed: ${res.statusText}`);
      return;
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === "progress") {
            setProgress({
              message: event.message,
              chunk_index: event.chunk_index,
              total_chunks: event.total_chunks,
              pass_num: event.pass_num,
            });
            setStatusMsg(
              event.pass_num > 1
                ? `Pass 2 — ${event.message} (${event.chunk_index}/${event.total_chunks})`
                : `${event.message} (${event.chunk_index}/${event.total_chunks})`
            );
          } else if (event.type === "rule") {
            setRules((prev) => [...prev, event.data]);
          } else if (event.type === "done") {
            setProgress(null);
            setStatus("done");
            setStatusMsg(`Extracted ${event.data.total_rules} rules from ${event.data.source}`);
          } else if (event.type === "error") {
            setProgress(null);
            setStatus("error");
            setStatusMsg(event.message);
          }
        } catch { /* ignore parse errors */ }
      }
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadPdf(file);
  }, [uploadPdf]);

  const loadPreset = useCallback((preset: typeof PRESET_POLICIES[number]) => {
    if (status === "streaming") return;
    setActivePreset(preset.id);
    setRules([]);
    setProgress(null);
    setStatus("streaming");
    setStatusMsg(`Loading ${preset.name} preset policy…`);
    const presetRules = getMockRules(preset.id);
    let i = 0;
    let cancelled = false;
    const tick = setInterval(() => {
      if (cancelled) { clearInterval(tick); return; }
      if (i < presetRules.length) {
        const rule = presetRules[i];
        if (rule) setRules(prev => [...prev, rule]);
        i++;
      } else {
        clearInterval(tick);
        if (!cancelled) {
          setStatus("done");
          setStatusMsg(`Loaded ${presetRules.length} rules from ${preset.name}`);
        }
      }
    }, 60);
    return () => { cancelled = true; clearInterval(tick); };
  }, [status]);

  const denyCount   = rules.filter(r => r.action === "deny").length;
  const auditCount  = rules.filter(r => r.action === "audit").length;
  const allowCount  = rules.filter(r => r.action === "allow").length;
  const critCount   = rules.filter(r => r.severity === "critical").length;

  return (
    <Shell activeTab="compile">
      <div className="p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-semibold text-[#eef1f8]">Compile Policy</h2>
            <p className="text-xs text-[#3a4060] mt-0.5">Extract compliance rules from a regulatory PDF</p>
          </div>
          {status === "done" && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
              style={{ background: "rgba(16,217,124,0.08)", border: "1px solid rgba(16,217,124,0.22)", boxShadow: "0 0 12px rgba(16,217,124,0.10)" }}>
              <CheckCircle2 size={12} style={{ color: "#10d97c" }} />
              <span className="text-xs font-medium" style={{ color: "#10d97c" }}>{rules.length} rules extracted</span>
            </div>
          )}
        </div>

        {/* Mock mode banner */}
        {mode === "mock" && selectedPolicy && (
          <div className="mb-5 flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{ background: "rgba(139,92,246,0.07)", border: "1px solid rgba(139,92,246,0.22)" }}>
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-lg"
              style={{ background: `${selectedPolicy.color}18`, border: `1px solid ${selectedPolicy.color}30` }}
            >
              {selectedPolicy.icon}
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold" style={{ color: "#a78bfa" }}>
                <Sparkles size={11} className="inline mr-1" />Mock Mode — {selectedPolicy.name}
              </p>
              <p className="text-[10px] text-[#3a4060] mt-0.5">Pre-compiled rules loaded automatically. Switch to Live Mode to upload a real PDF.</p>
            </div>
          </div>
        )}

        {/* Upload drop zone */}
        {mode !== "mock" && (
          <label
            htmlFor="pdf-upload"
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className="flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-2xl py-12 px-6 text-center mb-5 cursor-pointer transition-all duration-200"
            style={dragging ? {
              borderColor: "#3b82f6",
              background: "rgba(59,130,246,0.06)",
              transform: "scale(1.005)",
              boxShadow: "0 0 24px rgba(59,130,246,0.15)",
            } : {
              borderColor: "rgba(255,255,255,0.08)",
            }}
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center transition-all"
              style={dragging ? {
                background: "rgba(59,130,246,0.20)",
                border: "1px solid rgba(59,130,246,0.40)",
                boxShadow: "0 0 20px rgba(59,130,246,0.20)",
              } : {
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}>
              <UploadCloud size={24} style={{ color: dragging ? "#3b82f6" : "#3a4060" }} />
            </div>
            <div>
              <p className="text-sm font-medium text-[#8892a8]">
                {dragging ? "Drop to upload" : "Drop your policy PDF here"}
              </p>
              <p className="text-xs text-[#3a4060] mt-1">PCI-DSS · FFIEC · OFAC — or click to browse</p>
            </div>
            <input
              id="pdf-upload"
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadPdf(e.target.files[0])}
            />
          </label>
        )}

        {/* Pre-built policy presets (live mode) */}
        {mode !== "mock" && (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <Zap size={11} style={{ color: "#f59e0b" }} />
              <span className="text-[10px] font-semibold text-[#3a4060] uppercase tracking-widest">
                Or load a pre-built policy
              </span>
              <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.05)" }} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {PRESET_POLICIES.map(preset => {
                const isActive  = activePreset === preset.id && status !== "idle";
                const isLoading = isActive && status === "streaming";
                return (
                  <button
                    key={preset.id}
                    onClick={() => loadPreset(preset)}
                    disabled={status === "streaming"}
                    className="relative text-left rounded-2xl p-4 transition-all duration-200 disabled:opacity-50"
                    style={isActive ? {
                      background:   `${preset.color}12`,
                      border:       `1.5px solid ${preset.color}55`,
                      boxShadow:    `0 0 18px ${preset.color}14`,
                    } : {
                      background:   "rgba(255,255,255,0.02)",
                      border:       "1.5px solid rgba(255,255,255,0.07)",
                    }}
                    onMouseEnter={e => {
                      if (status !== "streaming")
                        (e.currentTarget as HTMLButtonElement).style.border = `1.5px solid ${preset.color}40`;
                    }}
                    onMouseLeave={e => {
                      if (!isActive)
                        (e.currentTarget as HTMLButtonElement).style.border = "1.5px solid rgba(255,255,255,0.07)";
                    }}
                  >
                    {/* Active checkmark */}
                    {isActive && !isLoading && (
                      <span className="absolute top-3 right-3 w-4 h-4 rounded-full flex items-center justify-center text-[10px]"
                        style={{ background: preset.color, color: "#000" }}>✓</span>
                    )}
                    {isLoading && (
                      <span className="absolute top-3 right-3">
                        <Loader2 size={13} className="animate-spin" style={{ color: preset.color }} />
                      </span>
                    )}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xl">{preset.icon}</span>
                      <span className="text-sm font-semibold text-[#eef1f8]">{preset.name}</span>
                    </div>
                    <p className="text-[10px] mb-3" style={{ color: isActive ? `${preset.color}cc` : "#3a4060" }}>
                      {preset.description}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {preset.tags.map(tag => (
                        <span key={tag} className="text-[9px] font-mono px-1.5 py-0.5 rounded-md"
                          style={isActive
                            ? { background: `${preset.color}20`, color: preset.color, border: `1px solid ${preset.color}35` }
                            : { background: "rgba(255,255,255,0.04)", color: "#3a4060", border: "1px solid rgba(255,255,255,0.06)" }
                          }>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Status banner */}
        {status !== "idle" && (
          <div className="flex items-center gap-2.5 text-xs font-mono mb-5 px-4 py-3 rounded-2xl border"
            style={status === "error" ? {
              background: "rgba(240,71,71,0.07)",
              borderColor: "rgba(240,71,71,0.22)",
              color: "#f87171",
            } : status === "done" ? {
              background: "rgba(16,217,124,0.07)",
              borderColor: "rgba(16,217,124,0.22)",
              color: "#10d97c",
            } : {
              background: "rgba(59,130,246,0.07)",
              borderColor: "rgba(59,130,246,0.22)",
              color: "#60a5fa",
            }}
          >
            {status === "streaming" && <Loader2 size={13} className="animate-spin shrink-0" />}
            {status === "done"      && <CheckCircle2 size={13} className="shrink-0" />}
            {status === "error"     && <AlertCircle  size={13} className="shrink-0" />}
            <span className="flex-1">{statusMsg}</span>
            {status === "streaming" && rules.length > 0 && (
              <span className="shrink-0 font-bold" style={{ color: "#22d3ee" }}>{rules.length} extracted…</span>
            )}
          </div>
        )}

        {/* Stats strip */}
        {status === "done" && rules.length > 0 && (
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              { label: "Total",    value: rules.length, color: "#eef1f8", topBorder: "#3b82f6" },
              { label: "Deny",     value: denyCount,    color: "#f04747", topBorder: "#f04747" },
              { label: "Audit",    value: auditCount,   color: "#f59e0b", topBorder: "#f59e0b" },
              { label: "Critical", value: critCount,    color: "#f04747", topBorder: "#f04747" },
            ].map((s) => (
              <div key={s.label}
                className="bg-[#091120] border border-white/[0.07] rounded-2xl p-3 text-center"
                style={{ borderTop: `2px solid ${s.topBorder}` }}
              >
                <p className="text-[10px] text-[#3a4060] uppercase tracking-widest mb-1">{s.label}</p>
                <p className="text-2xl font-bold font-mono" style={{ color: s.color, textShadow: `0 0 12px ${s.color}50` }}>
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Progress bar + skeleton while streaming */}
        {status === "streaming" && rules.length === 0 && (
          <div className="mb-4 space-y-4">
            {/* Chunk progress indicator */}
            {progress && (
              <div className="rounded-2xl px-4 py-3 space-y-2"
                style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.18)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-[#60a5fa] flex items-center gap-2">
                    <Loader2 size={11} className="animate-spin" />
                    {progress.pass_num > 1 ? "Deep scan — " : "⚙ "}{progress.message}
                  </span>
                  <span className="text-[10px] font-mono text-[#3a4060]">
                    {progress.chunk_index} / {progress.total_chunks}
                  </span>
                </div>
                {/* progress bar */}
                <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.round((progress.chunk_index / progress.total_chunks) * 100)}%`,
                      background: progress.pass_num > 1
                        ? "linear-gradient(90deg, #a78bfa, #7c3aed)"
                        : "linear-gradient(90deg, #3b82f6, #22d3ee)",
                      boxShadow: progress.pass_num > 1
                        ? "0 0 8px rgba(167,139,250,0.5)"
                        : "0 0 8px rgba(59,130,246,0.5)",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Pulse skeleton cards */}
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-[#091120] border border-white/[0.05] rounded-2xl p-4 animate-pulse"
                style={{ animationDelay: `${i * 150}ms` }}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-white/[0.04] rounded-lg" />
                  <div className="flex-1">
                    <div className="h-3 rounded w-48 mb-2" style={{ background: "rgba(255,255,255,0.06)" }} />
                    <div className="h-2.5 rounded w-72" style={{ background: "rgba(255,255,255,0.04)" }} />
                  </div>
                  <div className="h-5 rounded-lg w-16" style={{ background: "rgba(255,255,255,0.04)" }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Progress bar shown above rule list while streaming continues */}
        {status === "streaming" && rules.length > 0 && progress && (
          <div className="rounded-2xl px-4 py-2.5 mb-3 space-y-1.5"
            style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)" }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-[#60a5fa] flex items-center gap-1.5">
                <Loader2 size={10} className="animate-spin" />
                {progress.pass_num > 1 ? "Deep scan — " : ""}{progress.message}
              </span>
              <span className="text-[10px] font-mono text-[#3a4060]">{progress.chunk_index}/{progress.total_chunks}</span>
            </div>
            <div className="h-0.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.round((progress.chunk_index / progress.total_chunks) * 100)}%`,
                  background: "linear-gradient(90deg, #3b82f6, #22d3ee)",
                }}
              />
            </div>
          </div>
        )}

        {/* Rules list */}
        {rules.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-semibold text-[#3a4060] uppercase tracking-widest">Extracted Rules</span>
              <div className="flex-1 h-px bg-white/[0.05]" />
              <span className="text-[10px] text-[#3a4060] font-mono">{rules.length} total</span>
            </div>
            <div className="space-y-2">
              {rules.filter(r => r?.id).map((rule, idx) => (
                <RuleCard key={rule.id} rule={rule} idx={idx} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
