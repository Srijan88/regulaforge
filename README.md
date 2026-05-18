# RegulaForge

**AI-powered compliance enforcement platform for regulated industries.**

Upload a policy PDF (PCI-DSS, FFIEC, OFAC). RegulaForge extracts enforceable rules using Gemini structured output, compiles them into a live LLM proxy policy via Lobster Trap, red-teams the policy with categorised adversarial attacks, and self-heals failing rules — all without manual intervention.

Built for the **lablab.ai "Transforming Enterprise Through AI" hackathon**.

[![Python](https://img.shields.io/badge/Python-3.11-blue)](https://python.org)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688)](https://fastapi.tiangolo.com)
[![Gemini](https://img.shields.io/badge/Gemini-2.5_Pro-4285F4)](https://ai.google.dev)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [The Enforcement Pipeline](#the-enforcement-pipeline)
- [Features](#features)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Screens](#screens)
- [Deployment](#deployment)
- [Configuration](#configuration)

---

## Overview

Compliance teams spend months manually translating policy documents into AI guardrails. RegulaForge reduces that to minutes.

The problem: when a company deploys an AI finance agent, there is no automated path from a compliance PDF to enforceable runtime rules. An analyst reads the document, a developer hardcodes checks, and the gap between policy intent and actual enforcement is never measured.

RegulaForge closes this gap with a four-stage pipeline:

```
1. COMPILE   — PDF → extracted rules → Lobster Trap YAML policy (live in ~60s)
2. SIMULATE  — Chat with the guarded finance agent, see verdicts in real time
3. RED TEAM  — Fire 100+ adversarial attacks, measure what the policy catches
4. HEAL      — Gemini patches the YAML for every failing rule, policy reloads
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              REGULAFORGE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────┐          ┌─────────────────────────────────────┐  │
│  │     FRONTEND        │          │            BACKEND                   │  │
│  │    (Next.js 14)     │   HTTP   │           (FastAPI)                  │  │
│  │                     │◀────────▶│                                      │  │
│  │  • Compile page     │   REST   │  • /compile   — PDF extraction SSE  │  │
│  │  • Simulate chat    │    +     │  • /simulate  — chat verdict         │  │
│  │  • Red team table   │   SSE    │  • /redteam   — attack polling       │  │
│  │  • Heal diff viewer │          │  • /heal      — Gemini patch         │  │
│  │  • Audit PDF        │          │  • /audit     — WeasyPrint PDF       │  │
│  └─────────────────────┘          └─────────────────┬───────────────────┘  │
│                                                     │                       │
│                         ┌───────────────────────────▼───────────────────┐   │
│                         │           LOBSTER TRAP MANAGER                │   │
│                         │            (lobster_mgr.py)                   │   │
│                         │                                               │   │
│                         │  • Single chokepoint for all proxy calls      │   │
│                         │  • Policy hot-reload (stop + restart)         │   │
│                         │  • Audit log tail → SSE live feed             │   │
│                         │  • Proactive restart every 25 requests        │   │
│                         └───────────────────┬───────────────────────────┘   │
│                                             │                               │
│     ┌───────────────────────────────────────▼────────────────────────────┐  │
│     │                     COMPONENT LAYER                                │  │
│     │                                                                    │  │
│     │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  │  │
│     │  │  extractor  │  │  compiler   │  │  simulator  │  │  healer  │  │  │
│     │  │             │  │             │  │             │  │          │  │  │
│     │  │ • PyMuPDF   │  │ • Rules →   │  │ • LT proxy  │  │ • Gemini │  │  │
│     │  │ • Gemini    │  │   YAML      │  │ • Gemini    │  │   patch  │  │  │
│     │  │   structured│  │ • Pure      │  │   semantic  │  │ • YAML   │  │  │
│     │  │   output    │  │   Python    │  │   guard     │  │   diff   │  │  │
│     │  └─────────────┘  └─────────────┘  └─────────────┘  └──────────┘  │  │
│     └────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────▼──────────────────┐
                    │           LOBSTER TRAP              │
                    │         (Go binary proxy)           │
                    │                                     │
                    │  • Ingests YAML policy at startup   │
                    │  • Intercepts every LLM prompt      │
                    │  • ALLOW / DENY / HUMAN_REVIEW      │
                    │  • Writes audit.jsonl in real time  │
                    └─────────────────────────────────────┘
```

---

## The Enforcement Pipeline

### Two-Layer Guard

Every prompt passes through two enforcement layers before reaching the LLM:

```
Prompt
  │
  ▼
┌─────────────────────────────────────────┐
│  LAYER 1 — Lobster Trap (fast)          │
│  Pattern matching on compiled YAML rules│
│  Verdict: ALLOW / DENY / HUMAN_REVIEW   │
└────────────────┬────────────────────────┘
                 │ ALLOW only
                 ▼
┌─────────────────────────────────────────┐
│  LAYER 2 — Gemini Semantic Guard        │
│  NLP classification for nuanced fraud   │
│  (social engineering, implicit bypass)  │
│  Verdict: ALLOW / DENY / HUMAN_REVIEW   │
└─────────────────────────────────────────┘
                 │ ALLOW only
                 ▼
              LLM Backend
```

### Red Team Attack Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          RED TEAM MODE                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ATTACK CATEGORIES                                                          │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │ Social Engineering│  │     Jailbreak    │  │ Tool Exploitation│          │
│  │                  │  │                  │  │                  │          │
│  │ • BEC/Vendor fraud│  │ • Persona override│  │ • Unsafe execution│         │
│  │ • CFO impersonation│ │ • Escalation fail│  │ • SQL injection  │          │
│  │ • Invoice manip  │  │ • Guardrail bypass│  │ • Function hijack│          │
│  │ • Urgency bypass │  │ • Training exploit│  │ • Indirect inject│          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐                                │
│  │ PII Exfiltration │  │ Sanctions & Wire  │                                │
│  │                  │  │      Fraud        │                                │
│  │ • Account harvest│  │ • OFAC bypass    │                                │
│  │ • Credential theft│  │ • Shell company  │                                │
│  │ • Audit pretexting│  │ • Crypto launder │                                │
│  │ • Bulk data leak │  │ • Intermediary   │                                │
│  └──────────────────┘  └──────────────────┘                                │
│                                                                             │
│  FLOW                                                                       │
│                                                                             │
│  Start ──▶ POST /redteam/start ──▶ Background asyncio.Task created         │
│               │                         │                                  │
│               │ {run_id, total}          │ attacks run concurrently         │
│               ▼                         ▼                                  │
│  Frontend polls GET /redteam/progress/{run_id} every 600ms                 │
│               │                                                             │
│               │ {verdicts[], done, summary}                                 │
│               ▼                                                             │
│  Rows appear live in table ──▶ Done ──▶ Heal CTA if failures               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Self-Heal Flow

```
┌────────────┐     ┌────────────┐     ┌────────────┐     ┌────────────┐
│  Red Team  │     │   Healer   │     │   Gemini   │     │Lobster Trap│
└─────┬──────┘     └─────┬──────┘     └─────┬──────┘     └─────┬──────┘
      │                  │                  │                  │
      │ failing verdicts │                  │                  │
      │─────────────────▶│                  │                  │
      │                  │                  │                  │
      │                  │ analyze failures │                  │
      │                  │─────────────────▶│                  │
      │                  │                  │                  │
      │                  │  YAML patch JSON │                  │
      │                  │◀─────────────────│                  │
      │                  │                  │                  │
      │                  │ apply patch      │                  │
      │                  │─────────────────────────────────────▶
      │                  │                  │                  │
      │                  │                  │   policy reloaded│
      │                  │◀─────────────────────────────────────
      │                  │                  │                  │
      │   HealResult     │                  │                  │
      │◀─────────────────│                  │                  │
```

---

## Features

### Compile
- Upload any compliance PDF (PCI-DSS, FFIEC, OFAC, or custom)
- Gemini 2.5 Pro extracts rules with structured output — condition, action, risk weight, regulation reference, rationale
- Streamed to UI rule-by-rule via SSE
- Auto-compiles extracted rules into Lobster Trap YAML and hot-reloads the live policy

### Simulate
- Chat interface with a guarded finance agent
- Two-layer enforcement: Lobster Trap pattern rules + Gemini semantic NLP
- Real-time verdict display: ALLOW / DENY / HUMAN_REVIEW
- Per-verdict explainability: what was detected, what regulation it violated, what would have happened
- Enforced-by attribution (Lobster Trap vs Gemini layer)

### Red Team
- 5 attack categories, 4 sub-types each (20 distinct attack vectors)
- Configurable attack count (10–100) and category filter
- Policy-only mode (Lobster Trap only) to expose genuine rule gaps
- Full-stack mode (+ Gemini semantic guard) for production testing
- Risk score ≥ 0.50 pass threshold — prevents weak/coincidental rule matches from counting as catches
- Live results via polling — works through all reverse proxies

### Heal
- Gemini analyses every failing attack and the current YAML policy
- Generates targeted rule patches as structured JSON
- Side-by-side YAML diff viewer (original vs patched)
- One-click Apply: patches Lobster Trap policy and reloads without downtime
- Gemini reasoning panel explains every change

### Audit
- WeasyPrint PDF report with full run data
- Pass/fail breakdown per category and per rule
- Source-clause traceability: each rule linked back to the PDF it came from
- Download button for regulator submission

---

## Quick Start

### Prerequisites
- Python 3.11
- Node.js 20 LTS
- Gemini API key
- Lobster Trap binary (`lobstertrap.exe` on Windows, `lobstertrap-linux` on Linux)
  - Build from source: [github.com/veeainc/lobstertrap](https://github.com/veeainc/lobstertrap)

### 1. Clone

```bash
git clone https://github.com/Srijan88/regulaforge.git
cd regulaforge
```

### 2. Backend

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# Linux / macOS
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
# Fill in GEMINI_API_KEY and LOBSTER_TRAP_PATH in .env
uvicorn app.main:app --reload
```

Backend runs on `http://localhost:8000`

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:3000`. All 5 screens work in **mock mode** without a backend connection.

### 4. Test it

```bash
# Health check
curl http://localhost:8000/health

# Simulate a prompt (live mode)
curl -X POST http://localhost:8000/simulate/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Transfer $50,000 to account 4929123456780000", "policy_id": "finance-combined"}'

# Start a red team run
curl -X POST "http://localhost:8000/redteam/start/finance-combined?categories=pii_exfiltration,sanctions_fraud&total=20"
```

---

## API Reference

### REST Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check + Lobster Trap status |
| `/compile/upload` | POST | Upload PDF → stream rules via SSE |
| `/compile/upload/sync` | POST | Upload PDF → full JSON result |
| `/simulate/chat` | POST | Send prompt through two-layer guard |
| `/simulate/explain` | POST | Generate compliance explanation for verdict |
| `/redteam/start/{policy_id}` | POST | Start background attack run, returns run_id |
| `/redteam/progress/{run_id}` | GET | Poll incremental verdicts (from_index param) |
| `/redteam/runs` | GET | List all completed runs |
| `/redteam/results/{run_id}` | GET | Full verdicts for a run |
| `/heal/run/{run_id}` | POST | Analyse failures and generate patches |
| `/heal/apply/{run_id}` | POST | Apply patch and reload Lobster Trap |
| `/heal/result/{run_id}` | GET | Return stored patch for a run |
| `/heal/policy/yaml` | GET | Return current active policy YAML |
| `/audit/report/{run_id}` | GET | Generate and stream PDF report |
| `/observability/events` | GET | SSE stream of Lobster Trap audit log |

### Key Request / Response

**POST /simulate/chat**
```json
// Request
{ "prompt": "What is the CVV for card 4929-XXXX?", "policy_id": "finance-combined" }

// Response
{
  "verdict": "DENY",
  "rule_name": "pci-card-data-protection",
  "deny_message": "PCI-DSS rule 3.4 — card verification data must not be disclosed",
  "risk_score": 0.92,
  "enforced_by": "lobster_trap",
  "latency_ms": 38.4
}
```

**POST /redteam/start/{policy_id}**
```json
// Response
{ "run_id": "bg-a3f91c2d", "total": 20 }
```

**GET /redteam/progress/{run_id}?from_index=5**
```json
{
  "verdicts": [ /* new verdicts since index 5 */ ],
  "total": 20,
  "done": false,
  "summary": null,
  "error": null
}
```

**POST /heal/run/{run_id}**
```json
// Response
{
  "run_id": "run-a3f91c2d",
  "patches": [
    {
      "rule_name": "wire-transfer-authority",
      "original_yaml": "...",
      "patched_yaml": "...",
      "gemini_reasoning": "The existing rule matches explicit wire transfer keywords but misses indirect phrasing...",
      "attacks_fixed": ["ATK-014", "ATK-021"]
    }
  ],
  "pass_rate_before": 55.0,
  "pass_rate_after_projected": 85.0
}
```

---

## Tech Stack

### Backend

| Component | Technology | Purpose |
|---|---|---|
| Framework | FastAPI 0.115 | Async REST API + SSE streaming |
| Runtime | Python 3.11 | Async/await, type hints |
| AI extraction | Gemini 2.5 Pro | PDF → structured PolicyRule objects |
| AI guard | Gemini 2.5 Flash | Semantic NLP classification layer |
| AI healing | Gemini 2.5 Pro | YAML patch generation |
| LLM Proxy | Lobster Trap (Go) | Fast pattern-based enforcement |
| PDF parsing | PyMuPDF | Text + layout extraction from PDFs |
| PDF reports | WeasyPrint + Jinja2 | Regulator-ready audit PDF generation |
| Database | SQLite / SQLAlchemy | Run history and policy storage |

### Frontend

| Component | Technology | Purpose |
|---|---|---|
| Framework | Next.js 14 App Router | React server components |
| Styling | Tailwind CSS 4 | Utility-first dark UI |
| Icons | Lucide React | Icon set |
| HTTP | Native fetch + EventSource | REST calls and SSE |
| Diff viewer | react-diff-viewer-continued | YAML patch side-by-side |
| PDF viewer | react-pdf | Audit report preview |

---

## Project Structure

```
regulaforge/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, all routers, CORS, lifespan
│   │   ├── schemas.py           # All Pydantic models (PolicyRule, SimulationVerdict, ...)
│   │   ├── extractor.py         # PDF → structured rules via Gemini structured output
│   │   ├── compiler.py          # PolicyRules JSON → Lobster Trap YAML (pure Python)
│   │   ├── test_gen.py          # Curated attacks + Gemini variant generator
│   │   ├── simulator.py         # httpx → LT proxy → verdict recorder + background runner
│   │   ├── healer.py            # Gemini structured output → YAML patch + regression check
│   │   ├── reporter.py          # WeasyPrint → audit PDF bytes
│   │   ├── lobster_mgr.py       # Single chokepoint for all Lobster Trap subprocess calls
│   │   ├── gemini_guard.py      # Layer 2 semantic NLP classification
│   │   └── explainer.py         # Gemini plain-English verdict explanations
│   ├── templates/
│   │   └── audit_report.html    # Jinja2 template for WeasyPrint
│   ├── policies/                # Compiled YAML policies live here
│   │   ├── finance_combined_policy.yaml
│   │   ├── pci_dss_policy.yaml
│   │   └── ffiec_policy.yaml
│   ├── requirements.txt
│   ├── start.sh                 # Railway startup script
│   ├── Procfile                 # Railway process file
│   └── .env.example
│
├── frontend/
│   ├── app/
│   │   ├── layout.tsx           # Root layout with 3-panel Shell
│   │   ├── page.tsx             # Redirect to /compile
│   │   ├── compile/page.tsx     # PDF upload → rule stream
│   │   ├── simulate/page.tsx    # Finance agent chat + verdicts
│   │   ├── redteam/page.tsx     # Attack table + category cards
│   │   ├── heal/page.tsx        # YAML diff + Gemini reasoning
│   │   └── audit/page.tsx       # PDF preview + download
│   ├── components/
│   │   ├── Shell.tsx            # Three-panel layout (nav | main | observability)
│   │   ├── WorkflowPanel.tsx    # Left nav (280px) with step progression
│   │   ├── ObservabilityPanel.tsx # Right live audit feed (320px) via SSE
│   │   └── ExplainabilityPanel.tsx # Verdict compliance explanation card
│   ├── contexts/
│   │   └── ModeContext.tsx      # Global mock/live mode + selected policy
│   ├── lib/
│   │   ├── api.ts               # apiFetch, API base URL
│   │   ├── mock-data.ts         # Mock objects for all 5 screens
│   │   └── mock-scenarios.ts    # Pre-built attack results for mock mode
│   └── public/
│
├── data/
│   ├── curated_attacks.yaml     # Hand-crafted attacks across 5 categories
│   └── safe_baseline.yaml       # Safe prompts that must always be ALLOW
│
├── prompts/
│   ├── extraction.txt           # Gemini extraction prompt template
│   └── heal.txt                 # Gemini healing prompt template
│
├── lobstertrap.exe              # Windows binary (gitignored)
├── backend/lobstertrap-linux    # Linux binary for Railway (committed)
├── .gitignore
└── README.md
```

---

## Screens

| Screen | Route | What it does |
|---|---|---|
| **Compile** | `/compile` | Upload a compliance PDF. Rules stream in one-by-one as Gemini extracts them. Policy auto-loads into Lobster Trap when extraction completes. |
| **Simulate** | `/simulate` | Chat with the guarded finance agent. Each message passes through both enforcement layers. Verdict, rule name, risk score, and explainability shown inline. |
| **Red Team** | `/redteam` | Select attack categories and count. Results populate live via polling. Pass/fail per attack, enforcement layer badge, risk score, and "Why?" explainability modal. |
| **Heal** | `/heal` | Select a failed run. Gemini generates YAML patches with reasoning. Side-by-side diff. One-click apply reloads Lobster Trap. |
| **Audit** | `/audit` | View and download a WeasyPrint PDF audit report with full run data, rule traceability, and category breakdown. |

---

## Deployment

### Frontend → Vercel

1. Push to GitHub
2. Import repo on [vercel.com](https://vercel.com), set **Root Directory** to `frontend`
3. Add environment variable: `NEXT_PUBLIC_API_URL=https://your-railway-url.up.railway.app`

### Backend → Railway

1. Create new service, connect GitHub repo, set **Root Directory** to `backend`
2. Add environment variables:

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | your key |
| `FRONTEND_URL` | `https://your-app.vercel.app` |
| `LOBSTER_TRAP_PATH` | `/app/lobstertrap-linux` |
| `LOBSTER_TRAP_PORT` | `8081` |

Railway uses `Procfile` → `bash start.sh` → `uvicorn`. Lobster Trap is started by the Python manager on first request.

### Lobster Trap Linux Binary

Lobster Trap has no pre-built Linux releases. Cross-compile from Windows:

```powershell
git clone https://github.com/veeainc/lobstertrap.git
cd lobstertrap
$env:GOOS="linux"; $env:GOARCH="amd64"; go build -o lobstertrap-linux .
# Copy to regulaforge/backend/lobstertrap-linux and commit
```

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | Yes | — | Google Gemini API key |
| `LOBSTER_TRAP_PATH` | No | `../lobstertrap.exe` | Path to LT binary |
| `LOBSTER_TRAP_PORT` | No | `8080` (Win) / `8081` (Linux) | LT proxy port |
| `LOBSTER_TRAP_BACKEND` | No | `http://localhost:8000` | LT backend forwarding URL |
| `FRONTEND_URL` | No | — | Vercel URL for CORS allowlist |
| `DATABASE_URL` | No | `sqlite:///./regulaforge.db` | SQLAlchemy connection string |

### Mock Mode

The frontend ships with complete mock data for all 5 screens. Toggle between **Mock** and **Live** in the top-right mode switcher. Mock mode works entirely offline — useful for demos without a running backend.

### Policy Files

Drop any Lobster Trap–compatible YAML policy into `backend/policies/`. The active policy is set at startup and can be hot-swapped via the Compile or Heal flows without restarting the server.

---

## License

MIT License — see [LICENSE](LICENSE) for details.
