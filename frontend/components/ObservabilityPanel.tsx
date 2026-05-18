"use client";

import { useEffect, useRef, useState } from "react";
import { sseUrl } from "@/lib/api";
import { useMode } from "@/contexts/ModeContext";
import { Check, ShieldX, Eye, Settings, FileCode, Zap, Clock, Activity } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type EventKind = "system" | "policy" | "allow" | "deny" | "human_review";

interface FeedEvent {
  id: number;
  kind: EventKind;
  time: string;
  rule?: string;
  risk_score?: number;
  preview?: string;
  detail?: string;
  enforced_by?: string;
  latency_ms?: number;
  seed?: boolean;
}

// ── Seed / mock data ──────────────────────────────────────────────────────────

function makeSeedEvents(): FeedEvent[] {
  const t = (s: number) =>
    new Date(Date.now() - s * 1000).toLocaleTimeString("en-GB", { hour12: false });
  return [
    { id: 1,  kind: "system",       time: t(92), detail: "Lobster Trap active on :8080", seed: true },
    { id: 2,  kind: "policy",       time: t(90), detail: "Loaded finance-combined.yaml · 6 rules", seed: true },
    { id: 3,  kind: "allow",        time: t(75), latency_ms: 18, preview: "check my account balance", seed: true },
    { id: 4,  kind: "allow",        time: t(68), latency_ms: 23, preview: "pay vendor invoice #4821", seed: true },
    { id: 5,  kind: "deny",         time: t(55), rule: "block_cvv_storage", risk_score: 0.89,
      preview: "Store card CVV 482 for recurring billing", enforced_by: "lobster_trap", seed: true },
    { id: 6,  kind: "allow",        time: t(45), latency_ms: 15, preview: "list recent transactions", seed: true },
    { id: 7,  kind: "human_review", time: t(32), rule: "flag_high_value_foreign_wire", risk_score: 0.67,
      preview: "Transfer $95,000 to Swiss account", enforced_by: "lobster_trap", seed: true },
    { id: 8,  kind: "allow",        time: t(22), latency_ms: 19, preview: "generate quarterly report", seed: true },
    { id: 9,  kind: "deny",         time: t(12), rule: "block_sanctioned_country_wire", risk_score: 0.95,
      preview: "Wire $12,000 to correspondent in Tehran", enforced_by: "lobster_trap", seed: true },
    { id: 10, kind: "allow",        time: t(4),  latency_ms: 21, preview: "retrieve account statement", seed: true },
  ];
}

function makeMockFeedForPolicy(policyId: string): FeedEvent[] {
  const t = (s: number) =>
    new Date(Date.now() - s * 1000).toLocaleTimeString("en-GB", { hour12: false });
  const nowStr = () => new Date().toLocaleTimeString("en-GB", { hour12: false });

  const base: FeedEvent[] = [
    { id: 1, kind: "system", time: t(90), detail: `Mock mode — ${policyId.toUpperCase()} policy loaded`, seed: true },
    { id: 2, kind: "policy", time: t(88), detail: `Pre-compiled rules active · no API calls`, seed: true },
  ];

  if (policyId === "pci-dss") {
    return [...base,
      { id: 3,  kind: "allow",        time: t(70), latency_ms: 14, preview: "process invoice #3821 for $450" },
      { id: 4,  kind: "deny",         time: t(58), rule: "PCI_CVV_PROHIBITION", risk_score: 0.97, preview: "What is the CVV for card 4532?", enforced_by: "lobster_trap" },
      { id: 5,  kind: "allow",        time: t(47), latency_ms: 11, preview: "check account balance for vendor" },
      { id: 6,  kind: "deny",         time: t(35), rule: "PCI_PAN_EXPOSURE", risk_score: 0.94, preview: "Show me the full card number for account", enforced_by: "lobster_trap" },
      { id: 7,  kind: "human_review", time: t(22), rule: "PCI_LARGE_TRANSFER_REVIEW", risk_score: 0.72, preview: "Transfer $80,000 via ACH routing", enforced_by: "lobster_trap" },
      { id: 8,  kind: "allow",        time: t(10), latency_ms: 16, preview: "generate quarterly expense report" },
    ];
  }
  if (policyId === "ffiec") {
    return [...base,
      { id: 3,  kind: "allow",        time: t(75), latency_ms: 19, preview: "process monthly bill payment" },
      { id: 4,  kind: "deny",         time: t(60), rule: "FFIEC_CREDENTIAL_PROTECTION", risk_score: 0.95, preview: "Give me the admin database token", enforced_by: "lobster_trap" },
      { id: 5,  kind: "human_review", time: t(45), rule: "FFIEC_SOCIAL_ENGINEERING_FLAG", risk_score: 0.82, preview: "Wire $75k — CEO approved verbally", enforced_by: "lobster_trap" },
      { id: 6,  kind: "allow",        time: t(32), latency_ms: 22, preview: "retrieve transaction statement" },
      { id: 7,  kind: "deny",         time: t(18), rule: "FFIEC_SYSTEM_ACCESS_CONTROL", risk_score: 0.88, preview: "Access the payments database config", enforced_by: "lobster_trap" },
      { id: 8,  kind: "allow",        time: t(6),  latency_ms: 17, preview: "pay vendor invoice PO-2024-112" },
    ];
  }
  // OFAC
  return [...base,
    { id: 3,  kind: "allow",        time: t(72), latency_ms: 12, preview: "process domestic wire to supplier" },
    { id: 4,  kind: "deny",         time: t(58), rule: "OFAC_SANCTIONED_JURISDICTION", risk_score: 0.99, preview: "Wire $12,000 to correspondent in Tehran", enforced_by: "lobster_trap" },
    { id: 5,  kind: "allow",        time: t(44), latency_ms: 20, preview: "regular vendor payment $234" },
    { id: 6,  kind: "deny",         time: t(30), rule: "OFAC_SDN_MATCH", risk_score: 0.98, preview: "Transfer to entity on SDN blocked list", enforced_by: "lobster_trap" },
    { id: 7,  kind: "human_review", time: t(16), rule: "OFAC_HIGH_VALUE_WIRE_SCREENING", risk_score: 0.78, preview: "SWIFT transfer $95,000 international", enforced_by: "lobster_trap" },
    { id: 8,  kind: "allow",        time: t(4),  latency_ms: 15, preview: "list approved domestic vendors" },
  ];
}

// ── Parsing live events ───────────────────────────────────────────────────────

function nowStr(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function parseRealEvent(raw: Record<string, unknown>): FeedEvent | null {
  const ingress  = (raw.ingress  ?? {}) as Record<string, unknown>;
  const detected = (ingress.detected ?? {}) as Record<string, unknown>;

  const verdictRaw = (
    (raw.verdict ?? ingress.action ?? raw.action) as string | undefined
  )?.replace("RuleAction.", "").toUpperCase();

  if (!verdictRaw) return null;

  let kind: EventKind;
  if      (verdictRaw === "DENY")         kind = "deny";
  else if (verdictRaw === "HUMAN_REVIEW") kind = "human_review";
  else if (verdictRaw === "ALLOW")        kind = "allow";
  else return null;

  const ts = (raw.timestamp ?? raw.ts) as string | undefined;
  const time = ts
    ? (() => { try { return new Date(ts).toLocaleTimeString("en-GB", { hour12: false }); } catch { return nowStr(); } })()
    : nowStr();

  const riskRaw = raw.risk_score ?? detected.risk_score;
  const risk_score = riskRaw != null ? Number(riskRaw) : undefined;

  return {
    id: Math.random(),
    kind,
    time,
    rule:        ((raw.rule_name ?? ingress.rule_name) as string | undefined) || undefined,
    preview:     (raw.prompt_preview as string | undefined) || undefined,
    detail:      (raw.gemini_reason  as string | undefined) || undefined,
    enforced_by: (raw.enforced_by    as string | undefined) || "lobster_trap",
    latency_ms:  (raw.latency_ms ?? raw.latency) as number | undefined,
    risk_score,
  };
}

// ── Risk bar ──────────────────────────────────────────────────────────────────

function RiskBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = score >= 0.85 ? "#f04747" : score >= 0.6 ? "#f59e0b" : "#22d3ee";
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className="w-14 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[9px] font-mono tabular-nums font-bold" style={{ color }}>{pct}</span>
    </div>
  );
}

// ── Enforcer badge ────────────────────────────────────────────────────────────

function EnforcerBadge({ enforced_by }: { enforced_by?: string }) {
  const isGemini = enforced_by === "gemini_semantic_layer";
  if (isGemini) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[8px] font-mono px-1.5 py-0.5 rounded shrink-0"
        style={{ color: "#8b5cf6", background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.25)" }}>
        <Zap size={7} />Gemini
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[8px] font-mono px-1.5 py-0.5 rounded shrink-0"
      style={{ color: "#3b82f6", background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.22)" }}>
      ⬡ LT
    </span>
  );
}

// ── Row components ────────────────────────────────────────────────────────────

function SystemRow({ ev }: { ev: FeedEvent }) {
  const isPolicy = ev.kind === "policy";
  const Icon = isPolicy ? FileCode : Settings;
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 text-[10px] font-mono">
      <Icon size={9} className={`shrink-0 ${isPolicy ? "text-[#22d3ee]/50" : "text-[#3b82f6]/50"}`} />
      <span className="text-[#3a4060] shrink-0 tabular-nums">{ev.time}</span>
      <span className={`text-[9px] font-bold shrink-0 uppercase tracking-wider ${isPolicy ? "text-[#22d3ee]/40" : "text-[#3b82f6]/40"}`}>
        {isPolicy ? "policy" : "sys"}
      </span>
      <span className="text-[#3a4060] truncate">{ev.detail}</span>
    </div>
  );
}

function AllowRow({ ev }: { ev: FeedEvent }) {
  const text = ev.preview || ev.detail;
  return (
    <div className="group flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-mono hover:bg-[#10d97c]/[0.03] transition-colors">
      <Check size={10} className="shrink-0" style={{ color: "#10d97c" }} />
      <span className="text-[#2a3a30] shrink-0 tabular-nums group-hover:text-[#3d4d40] transition-colors">{ev.time}</span>
      <span className="font-bold shrink-0 tracking-wider text-[9px] uppercase" style={{ color: "rgba(16,217,124,0.70)" }}>allow</span>
      {text && (
        <span className="text-[#2a3a30] truncate group-hover:text-[#3a4a38] transition-colors">{text}</span>
      )}
      {ev.latency_ms != null && (
        <span className="ml-auto shrink-0 flex items-center gap-0.5 text-[9px] text-[#3a4060] group-hover:text-[#4a5070] font-mono">
          <Clock size={7} />{Math.round(ev.latency_ms)}ms
        </span>
      )}
    </div>
  );
}

function DenyRow({ ev }: { ev: FeedEvent }) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ animation: "slideDown 0.25s cubic-bezier(0.16,1,0.3,1)" }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border border-b-0 rounded-t-xl"
        style={{ background: "rgba(240,71,71,0.10)", borderColor: "rgba(240,71,71,0.30)" }}>
        <ShieldX size={11} className="shrink-0" style={{ color: "#f04747" }} />
        <span className="font-bold text-[10px] tracking-widest uppercase" style={{ color: "#f04747" }}>Deny</span>
        <span className="text-[9px] tabular-nums shrink-0" style={{ color: "rgba(240,71,71,0.50)" }}>{ev.time}</span>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {ev.risk_score != null && ev.risk_score > 0.01 && (
            <RiskBar score={ev.risk_score} />
          )}
          <EnforcerBadge enforced_by={ev.enforced_by} />
        </div>
      </div>
      <div className="px-3 py-2 border border-t-0 rounded-b-xl space-y-1"
        style={{
          background: "rgba(240,71,71,0.05)",
          borderColor: "rgba(240,71,71,0.18)",
          boxShadow: "0 0 12px rgba(240,71,71,0.08)",
        }}>
        {ev.rule && (
          <p className="text-[10px] font-mono font-semibold truncate" style={{ color: "#f87171" }}>
            {ev.rule}
          </p>
        )}
        {ev.preview && (
          <p className="text-[10px] italic truncate leading-relaxed" style={{ color: "rgba(240,71,71,0.45)" }}>
            &ldquo;{ev.preview}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}

function ReviewRow({ ev }: { ev: FeedEvent }) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ animation: "slideDown 0.25s cubic-bezier(0.16,1,0.3,1)" }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border border-b-0 rounded-t-xl"
        style={{ background: "rgba(245,158,11,0.10)", borderColor: "rgba(245,158,11,0.30)" }}>
        <Eye size={11} className="shrink-0" style={{ color: "#f59e0b" }} />
        <span className="font-bold text-[10px] tracking-widest uppercase" style={{ color: "#f59e0b" }}>Review</span>
        <span className="text-[9px] tabular-nums shrink-0" style={{ color: "rgba(245,158,11,0.50)" }}>{ev.time}</span>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {ev.risk_score != null && ev.risk_score > 0.01 && (
            <RiskBar score={ev.risk_score} />
          )}
          <EnforcerBadge enforced_by={ev.enforced_by} />
        </div>
      </div>
      <div className="px-3 py-2 border border-t-0 rounded-b-xl space-y-1"
        style={{
          background: "rgba(245,158,11,0.04)",
          borderColor: "rgba(245,158,11,0.15)",
          boxShadow: "0 0 12px rgba(245,158,11,0.06)",
        }}>
        {ev.rule && (
          <p className="text-[10px] font-mono font-semibold truncate" style={{ color: "#fbbf24" }}>
            {ev.rule}
          </p>
        )}
        {(ev.preview || ev.detail) && (
          <p className="text-[10px] italic truncate leading-relaxed" style={{ color: "rgba(245,158,11,0.45)" }}>
            &ldquo;{ev.preview || ev.detail}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}

function EventRow({ ev }: { ev: FeedEvent }) {
  if (ev.kind === "system" || ev.kind === "policy") return <SystemRow ev={ev} />;
  if (ev.kind === "allow")        return <AllowRow ev={ev} />;
  if (ev.kind === "deny")         return <DenyRow ev={ev} />;
  if (ev.kind === "human_review") return <ReviewRow ev={ev} />;
  return null;
}

// ── Mock feed ticker ──────────────────────────────────────────────────────────

function useMockFeed(policyId: string) {
  const [events, setEvents] = useState<FeedEvent[]>([]);

  useEffect(() => {
    const initial = makeMockFeedForPolicy(policyId);
    setEvents(initial);

    // After initial load, add new events every few seconds to simulate live activity
    const pool: Array<Omit<FeedEvent, "id" | "time">> = [
      { kind: "allow",        latency_ms: 13, preview: "check vendor payment status" },
      { kind: "allow",        latency_ms: 18, preview: "generate compliance summary" },
      { kind: "deny",         rule: initial[3]?.rule ?? "POLICY_RULE", risk_score: 0.92, preview: "suspicious finance request", enforced_by: "lobster_trap" },
      { kind: "allow",        latency_ms: 21, preview: "process approved invoice" },
      { kind: "human_review", rule: initial[6]?.rule ?? "REVIEW_RULE", risk_score: 0.71, preview: "large transaction needs review", enforced_by: "lobster_trap" },
      { kind: "allow",        latency_ms: 15, preview: "routine account inquiry" },
    ];

    let idx = 0;
    const intervalMs = 3500;
    const id = setInterval(() => {
      const template = pool[idx % pool.length];
      idx++;
      const ev: FeedEvent = {
        ...template,
        id: Math.random(),
        time: new Date().toLocaleTimeString("en-GB", { hour12: false }),
      };
      setEvents((prev) => [...prev.slice(-29), ev]);
    }, intervalMs);

    return () => clearInterval(id);
  }, [policyId]);

  return events;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ObservabilityPanel() {
  const { mode, selectedPolicy } = useMode();
  const isMock = mode === "mock" && !!selectedPolicy;

  // ── Live mode state ──────────────────────────────────────────────────────
  const [liveEvents, setLiveEvents]     = useState<FeedEvent[]>([]);
  const [connected, setConnected]       = useState(false);
  const [hasRealEvents, setHasReal]     = useState(false);
  const firstReal = useRef(true);

  // ── Mock mode feed ───────────────────────────────────────────────────────
  const mockEvents = useMockFeed(selectedPolicy?.id ?? "pci-dss");

  const bottomRef = useRef<HTMLDivElement>(null);

  // Seed live events once
  useEffect(() => {
    if (isMock) return;
    setLiveEvents(makeSeedEvents());
    firstReal.current = true;
    setTimeout(() => bottomRef.current?.scrollIntoView(), 200);
  }, [isMock]);

  // Live SSE — only when in live mode
  useEffect(() => {
    if (isMock) return;
    const es = new EventSource(sseUrl("/observe/feed"));
    es.onopen  = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { type?: string; data?: Record<string, unknown> };
        const ev  = parseRealEvent(msg.data ?? {});
        if (!ev) return;

        if (firstReal.current) {
          firstReal.current = false;
          setLiveEvents([ev]);
        } else {
          setLiveEvents((prev) => [...prev.slice(-29), ev]);
        }
        setHasReal(true);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      } catch { /* ignore malformed */ }
    };

    return () => es.close();
  }, [isMock]);

  // Scroll to bottom when mock events update
  useEffect(() => {
    if (!isMock) return;
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, [isMock, mockEvents.length]);

  const events = isMock ? mockEvents : liveEvents;
  const denyCount   = events.filter(e => e.kind === "deny").length;
  const reviewCount = events.filter(e => e.kind === "human_review").length;
  const allowCount  = events.filter(e => e.kind === "allow").length;

  return (
    <aside className="w-[288px] shrink-0 flex flex-col bg-[#050b17] border-l border-white/[0.06]">

      {/* Header */}
      <div className="shrink-0 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(59,130,246,0.10)", border: "1px solid rgba(59,130,246,0.20)" }}>
              <Activity size={11} style={{ color: "#3b82f6" }} />
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-widest text-[#3a4060]">Live Feed</span>
            {isMock ? (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded"
                style={{ color: "#a78bfa", background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.22)" }}>
                mock
              </span>
            ) : !hasRealEvents && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded"
                style={{ color: "#3a4060", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                demo
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {isMock ? (
              <>
                <span style={{ width: 6, height: 6, borderRadius: "50%", display: "inline-block", background: "#a78bfa", boxShadow: "0 0 7px rgba(139,92,246,0.6)" }} />
                <span className="text-[9px] font-mono" style={{ color: "rgba(167,139,250,0.60)" }}>mock</span>
              </>
            ) : (
              <>
                <span
                  className={connected ? "animate-pulse" : ""}
                  style={{
                    width: 6, height: 6, borderRadius: "50%", display: "inline-block",
                    background: connected ? "#10d97c" : "#3a4060",
                    boxShadow: connected ? "0 0 7px rgba(16,217,124,0.6)" : "none",
                  }}
                />
                <span className="text-[9px] font-mono" style={{ color: connected ? "rgba(16,217,124,0.60)" : "#3a4060" }}>
                  {connected ? "live" : "offline"}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Mini stat strip */}
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { label: "allow",  value: allowCount,  color: "#10d97c", bg: "rgba(16,217,124,0.07)",  border: "rgba(16,217,124,0.18)" },
            { label: "deny",   value: denyCount,   color: "#f04747", bg: "rgba(240,71,71,0.08)",   border: "rgba(240,71,71,0.20)"  },
            { label: "review", value: reviewCount, color: "#f59e0b", bg: "rgba(245,158,11,0.07)",  border: "rgba(245,158,11,0.20)" },
          ].map((s) => (
            <div key={s.label}
              className="flex flex-col items-center py-2 rounded-lg text-center"
              style={{ background: s.bg, border: `1px solid ${s.border}` }}
            >
              <span className="text-lg font-bold font-mono tabular-nums leading-none" style={{ color: s.color, textShadow: `0 0 8px ${s.color}60` }}>
                {s.value}
              </span>
              <span className="text-[8px] uppercase tracking-wider mt-0.5" style={{ color: s.color, opacity: 0.65 }}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="h-px bg-white/[0.04] mx-3 shrink-0" />

      {/* Events */}
      <div className="flex-1 overflow-y-auto min-h-0 px-2 py-2 flex flex-col gap-1">
        {events.map((ev) => <EventRow key={ev.id} ev={ev} />)}
        <div ref={bottomRef} />
      </div>

      {/* Footer legend */}
      <div className="shrink-0 border-t border-white/[0.04] px-3 py-2 flex items-center gap-3">
        <span className="flex items-center gap-1 text-[9px] font-mono" style={{ color: "rgba(16,217,124,0.45)" }}>
          <Check size={8} style={{ color: "#10d97c" }} />allow
        </span>
        <span className="flex items-center gap-1 text-[9px] font-mono" style={{ color: "rgba(240,71,71,0.45)" }}>
          <ShieldX size={8} style={{ color: "#f04747" }} />deny
        </span>
        <span className="flex items-center gap-1 text-[9px] font-mono" style={{ color: "rgba(245,158,11,0.45)" }}>
          <Eye size={8} style={{ color: "#f59e0b" }} />review
        </span>
        <span className="flex items-center gap-1 text-[9px] font-mono" style={{ color: "rgba(34,211,238,0.40)" }}>
          <FileCode size={8} style={{ color: "#22d3ee" }} />policy
        </span>
      </div>

      <style jsx>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-8px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
      `}</style>
    </aside>
  );
}
