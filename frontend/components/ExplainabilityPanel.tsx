"use client";

import { useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExplainData {
  what_detected: string;
  policy_violated: string;
  what_would_happen: string;
  severity: string;           // "CRITICAL" | "HIGH" | "MEDIUM"
  regulation_reference: string;
  audit_id: string;
  timestamp: string;
  from_cache?: boolean;
}

interface Props {
  verdict: string;            // "DENY" | "HUMAN_REVIEW"
  rule_name?: string;
  risk_score?: number;
  enforced_by?: string;
  data: ExplainData | null;   // null = still loading / failed
  loading: boolean;
  compact?: boolean;          // true = smaller padding (for modals / redteam)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: "bg-[#ff3333]/20 text-[#ff3333] border border-[#ff3333]/40",
  HIGH:     "bg-[#ff8800]/20 text-[#ff8800] border border-[#ff8800]/40",
  MEDIUM:   "bg-[#f5a623]/20 text-[#f5a623] border border-[#f5a623]/40",
};

function severityStyle(s: string) {
  return SEVERITY_STYLE[s?.toUpperCase()] ?? SEVERITY_STYLE.MEDIUM;
}

// ── Skeleton loader ───────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="flex flex-col gap-2 py-1">
      <div className="flex items-center gap-2">
        <span className="text-[#a78bfa] text-xs animate-pulse">✦</span>
        <span className="text-[#a78bfa]/70 text-xs font-mono animate-pulse">
          Analyzing compliance context…
        </span>
      </div>
      <div className="space-y-1.5 pl-4">
        {[80, 60, 90, 55].map((w, i) => (
          <div
            key={i}
            className="h-2 rounded bg-white/[0.06] animate-pulse"
            style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Fallback (no explainability data, not loading) ────────────────────────────

function Fallback({ rule_name, risk_score }: { rule_name?: string; risk_score?: number }) {
  return (
    <div className="text-xs text-[#44474f] space-y-1">
      {rule_name && (
        <p className="font-mono text-[#8e9099]">Rule: {rule_name}</p>
      )}
      {risk_score != null && risk_score > 0 && (
        <p className="font-mono text-[#8e9099]">Risk Score: {risk_score.toFixed(2)}</p>
      )}
      <p className="text-[#44474f] italic">
        Upload a policy document to see the detailed compliance explanation here.
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ExplainabilityPanel({
  verdict,
  rule_name,
  risk_score,
  enforced_by,
  data,
  loading,
  compact = false,
}: Props) {
  const [expanded, setExpanded] = useState(true);

  const isDeny   = verdict.toUpperCase() === "DENY";
  const isReview = verdict.toUpperCase() === "HUMAN_REVIEW";

  // Theme colours
  const borderColor = isDeny   ? "border-[#ff3333]"
                    : isReview ? "border-[#f59e0b]"
                    :            "border-[#8e9099]";
  const bgColor     = isDeny   ? "bg-[#ff2200]/[0.07]"
                    : isReview ? "bg-[#f59e0b]/[0.06]"
                    :            "bg-white/[0.02]";
  const headerColor = isDeny   ? "text-[#ff4444]"
                    : isReview ? "text-[#f59e0b]"
                    :            "text-[#8e9099]";
  const labelColor  = isDeny   ? "text-[#ff6b6b]"
                    : isReview ? "text-[#f59e0b]/80"
                    :            "text-[#8e9099]";

  const headerIcon  = isDeny ? "⛔" : "👁";
  const headerText  = isDeny ? "BLOCKED — Here's why" : "ESCALATED FOR REVIEW — Here's why";

  const isGemini = enforced_by === "gemini_semantic_layer";
  const p = compact ? "px-3 py-2.5" : "px-4 py-3";

  return (
    <div
      className={`rounded border-l-[3px] ${borderColor} ${bgColor} text-xs font-sans overflow-hidden`}
      style={{ animation: "explainIn 0.2s ease-out" }}
    >
      {/* Header */}
      <div
        className={`${p} flex items-center justify-between cursor-pointer select-none`}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">{headerIcon}</span>
          <span className={`font-bold tracking-wide ${headerColor}`}>{headerText}</span>
          {isGemini && (
            <span className="text-[#a78bfa] text-[10px] font-mono ml-1">✦ Gemini</span>
          )}
        </div>
        <button
          className={`text-[10px] font-mono ${labelColor} hover:opacity-80 transition-opacity flex items-center gap-1`}
        >
          {expanded ? "▲ hide" : "▼ details"}
        </button>
      </div>

      {/* Divider */}
      <div className={`h-px mx-${compact ? "3" : "4"} ${isDeny ? "bg-[#ff3333]/20" : "bg-[#f59e0b]/20"}`} />

      {/* Body */}
      {expanded && (
        <div className={`${p} space-y-3`}>
          {loading ? (
            <Skeleton />
          ) : data ? (
            <>
              {/* Detected */}
              <div>
                <p className={`text-[10px] uppercase tracking-widest font-semibold ${labelColor} mb-0.5`}>
                  🔍 Detected
                </p>
                <p className="text-[#c4c6d0] leading-relaxed">{data.what_detected}</p>
              </div>

              {/* Policy */}
              <div>
                <p className={`text-[10px] uppercase tracking-widest font-semibold ${labelColor} mb-0.5`}>
                  📋 Policy
                </p>
                <p className="text-[#c4c6d0] leading-relaxed">{data.policy_violated}</p>
              </div>

              {/* Impact */}
              <div>
                <p className={`text-[10px] uppercase tracking-widest font-semibold ${labelColor} mb-0.5`}>
                  ⚠ Impact
                </p>
                <p className="text-[#c4c6d0] leading-relaxed">{data.what_would_happen}</p>
              </div>

              {/* Footer metadata */}
              <div className={`pt-2 border-t ${isDeny ? "border-[#ff3333]/15" : "border-[#f59e0b]/15"} flex flex-wrap gap-x-3 gap-y-1 items-center`}>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${severityStyle(data.severity)}`}>
                  {data.severity}
                </span>
                {risk_score != null && risk_score > 0.01 && (
                  <span className="text-[10px] text-[#8e9099] font-mono">
                    risk: {risk_score.toFixed(2)}
                  </span>
                )}
                {isGemini
                  ? <span className="text-[10px] text-[#a78bfa] font-mono">✦ Gemini</span>
                  : <span className="text-[10px] text-[#5b9bd5] font-mono">⬡ LT</span>
                }
                {rule_name && (
                  <span className="text-[10px] text-[#44474f] font-mono truncate max-w-[180px]">
                    {rule_name}
                  </span>
                )}
                <span className="text-[10px] text-[#383d4a] font-mono ml-auto">
                  {data.audit_id} · {data.timestamp}
                </span>
              </div>
            </>
          ) : (
            <Fallback rule_name={rule_name} risk_score={risk_score} />
          )}
        </div>
      )}

      <style jsx>{`
        @keyframes explainIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
