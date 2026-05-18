"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { API, apiFetch } from "@/lib/api";
import { useMode } from "@/contexts/ModeContext";
import { FileText, Download, CheckCircle2, XCircle, Sparkles } from "lucide-react";

interface Summary {
  run_id: string;
  policy_id: string;
  total_attacks: number;
  passed: number;
  failed: number;
  pass_rate: number;
  created_at: string;
}

interface RunData {
  summary: Summary;
}

// Pre-built mock audit summaries per policy
const MOCK_SUMMARIES: Record<string, Summary> = {
  "pci-dss": {
    run_id:        "mock-pci-dss-a1b2c3",
    policy_id:     "pci-dss",
    total_attacks: 22,
    passed:        19,
    failed:        3,
    pass_rate:     86,
    created_at:    new Date(Date.now() - 3600 * 1000).toISOString(),
  },
  "ffiec": {
    run_id:        "mock-ffiec-d4e5f6",
    policy_id:     "ffiec",
    total_attacks: 18,
    passed:        16,
    failed:        2,
    pass_rate:     89,
    created_at:    new Date(Date.now() - 7200 * 1000).toISOString(),
  },
  "ofac": {
    run_id:        "mock-ofac-g7h8i9",
    policy_id:     "ofac",
    total_attacks: 15,
    passed:        14,
    failed:        1,
    pass_rate:     93,
    created_at:    new Date(Date.now() - 1800 * 1000).toISOString(),
  },
};

export default function AuditPage() {
  const { mode, selectedPolicy } = useMode();
  const isMock = mode === "mock" && !!selectedPolicy;

  const [runId, setRunId] = useState("");
  const [data, setData]   = useState<RunData | null>(null);
  const [loading, setLoading]     = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  // In mock mode: auto-load the mock summary for the selected policy
  useEffect(() => {
    if (!isMock) return;
    const ms = MOCK_SUMMARIES[selectedPolicy!.id] ?? MOCK_SUMMARIES["pci-dss"];
    setRunId(ms.run_id);
    setData({ summary: ms });
    setError("");
  }, [isMock, selectedPolicy]);

  // In live mode: restore last run_id and load
  useEffect(() => {
    if (isMock) return;
    const saved = localStorage.getItem("last_run_id") ?? "";
    setRunId(saved);
    if (saved) loadReport(saved);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMock]);

  const loadReport = async (id: string) => {
    if (!id.trim()) return;
    setLoading(true);
    setError("");
    try {
      const d = await apiFetch<RunData>(`/audit/report/${id}`);
      setData(d);
    } catch (e) {
      setError(String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const downloadPdf = async () => {
    if (isMock) {
      // In mock mode — generate a simple text "PDF" download
      const s = data?.summary;
      if (!s) return;
      const content = `REGULAFORGE AUDIT REPORT (DEMO)\n${"=".repeat(40)}\nRun ID:      ${s.run_id}\nPolicy:      ${s.policy_id}\nTotal Tests: ${s.total_attacks}\nPassed:      ${s.passed}\nFailed:      ${s.failed}\nPass Rate:   ${s.pass_rate}%\nGenerated:   ${new Date(s.created_at).toLocaleString()}\n\nThis is a pre-computed demo report.\nSwitch to Live Mode to generate a real PDF audit.`;
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-demo-${s.policy_id}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (!runId.trim()) return;
    setDownloading(true);
    setError("");
    try {
      const res = await fetch(`${API}/audit/report/${runId}/pdf`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-${runId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e));
    } finally {
      setDownloading(false);
    }
  };

  const s = data?.summary;

  return (
    <Shell activeTab="audit">
      <div className="p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.25)", boxShadow: "0 0 14px rgba(59,130,246,0.15)" }}>
              <FileText size={18} style={{ color: "#3b82f6" }} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#eef1f8]">Audit Report</h2>
              <p className="text-xs text-[#3a4060] mt-0.5">Compliance run summary & PDF export</p>
            </div>
          </div>
          <button
            onClick={downloadPdf}
            disabled={downloading || (!isMock && !runId.trim())}
            className="flex items-center gap-2 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-40"
            style={{ background: "linear-gradient(to right, #2563eb, #4f46e5)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 20px rgba(79,70,229,0.45)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "none"; }}
          >
            <Download size={13} />
            {downloading ? "Generating…" : isMock ? "Download Demo" : "Download PDF"}
          </button>
        </div>

        {/* Mock mode banner */}
        {isMock && selectedPolicy && (
          <div className="mb-5 flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{ background: "rgba(139,92,246,0.07)", border: "1px solid rgba(139,92,246,0.22)" }}>
            <span className="text-xl">{selectedPolicy.icon}</span>
            <div>
              <p className="text-xs font-semibold" style={{ color: "#a78bfa" }}>
                <Sparkles size={11} className="inline mr-1" />Mock Mode — {selectedPolicy.name}
              </p>
              <p className="text-[10px] text-[#3a4060] mt-0.5">Pre-computed audit summary. Switch to Live Mode for a real PDF from a Red Team run.</p>
            </div>
          </div>
        )}

        {/* Run ID input — live mode only */}
        {!isMock && (
          <div className="flex gap-3 mb-5">
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
            <button
              onClick={() => loadReport(runId)}
              disabled={loading || !runId.trim()}
              className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-40"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", color: "#8892a8" }}
            >
              {loading ? "Loading…" : "Load"}
            </button>
          </div>
        )}

        {error && (
          <div className="text-xs rounded-xl px-4 py-3 mb-4 font-mono"
            style={{ color: "#f87171", background: "rgba(240,71,71,0.08)", border: "1px solid rgba(240,71,71,0.22)" }}>
            {error}
          </div>
        )}

        {/* Summary */}
        {s && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { label: "Run ID",    value: s.run_id },
                { label: "Policy",    value: s.policy_id },
                { label: "Pass Rate", value: `${s.pass_rate}%` },
                { label: "Generated", value: s.created_at ? new Date(s.created_at).toLocaleString() : "—" },
              ].map((item) => (
                <div key={item.label} className="bg-[#091120] border border-white/[0.07] rounded-2xl p-4">
                  <p className="text-[10px] text-[#3a4060] uppercase tracking-widest">{item.label}</p>
                  <p className="font-mono text-sm text-[#eef1f8] mt-1 truncate">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { label: "Total",  value: s.total_attacks, color: "#eef1f8",  shadow: "rgba(238,241,248,0.15)", topBorder: "#3b82f6" },
                { label: "Passed", value: s.passed,        color: "#10d97c",  shadow: "rgba(16,217,124,0.30)",  topBorder: "#10d97c" },
                { label: "Failed", value: s.failed,        color: "#f04747",  shadow: "rgba(240,71,71,0.30)",   topBorder: "#f04747" },
              ].map((item) => (
                <div key={item.label} className="bg-[#091120] border border-white/[0.07] rounded-2xl p-4 text-center"
                  style={{ borderTop: `2px solid ${item.topBorder}` }}>
                  <p className="text-[10px] text-[#3a4060] uppercase tracking-widest mb-1">{item.label}</p>
                  <p className="text-3xl font-bold font-mono" style={{ color: item.color, textShadow: `0 0 12px ${item.shadow}` }}>
                    {item.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Pass rate bar */}
            <div className="bg-[#091120] border border-white/[0.07] rounded-2xl p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-widest text-[#3a4060]">Pass Rate</span>
                <span className="text-sm font-bold font-mono" style={{
                  color: s.pass_rate >= 90 ? "#10d97c" : s.pass_rate >= 75 ? "#f59e0b" : "#f04747",
                  textShadow: s.pass_rate >= 90 ? "0 0 10px rgba(16,217,124,0.50)" : "none",
                }}>
                  {s.pass_rate}%
                </span>
              </div>
              <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${s.pass_rate}%`,
                    background: s.pass_rate >= 90
                      ? "linear-gradient(to right, #10d97c, #22d3ee)"
                      : s.pass_rate >= 75
                      ? "linear-gradient(to right, #f59e0b, #10d97c)"
                      : "linear-gradient(to right, #f04747, #f59e0b)",
                  }}
                />
              </div>
            </div>

            {/* Status */}
            <div className="flex items-center gap-2 px-4 py-3 rounded-2xl"
              style={s.pass_rate >= 90 ? {
                background: "rgba(16,217,124,0.06)", border: "1px solid rgba(16,217,124,0.20)"
              } : {
                background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.20)"
              }}>
              {s.pass_rate >= 90
                ? <CheckCircle2 size={14} style={{ color: "#10d97c" }} />
                : <XCircle size={14} style={{ color: "#f59e0b" }} />
              }
              <span className="text-xs font-medium" style={{ color: s.pass_rate >= 90 ? "#10d97c" : "#f59e0b" }}>
                {s.pass_rate >= 90
                  ? `Policy is performing well — ${s.failed} rule${s.failed !== 1 ? "s" : ""} need attention`
                  : `${s.failed} rule${s.failed !== 1 ? "s" : ""} failing — run Heal to generate patches`
                }
              </span>
            </div>
          </>
        )}

        {!s && !loading && !error && (
          <div className="rounded-2xl border border-white/[0.05] min-h-[300px] flex items-center justify-center"
            style={{ background: "#091120" }}>
            <div className="text-center">
              <FileText size={32} style={{ color: "rgba(59,130,246,0.25)" }} className="mx-auto mb-3" />
              <p className="text-sm text-[#8892a8]">No report loaded</p>
              <p className="text-xs text-[#3a4060] mt-1">Run Red Team first, then come back here to download the PDF</p>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
