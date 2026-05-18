# RegulaForge

Enterprise compliance policy compiler and enforcement engine. Compiles finance regulation PDFs (PCI-DSS, FFIEC, OFAC) into deployable Veea Lobster Trap enforcement packs, red-teams them with 40 adversarial attacks, auto-heals failing rules using Gemini 2.5 Pro, and generates regulator-readable audit PDFs with full source-clause traceability.

Built for the lablab.ai "Transforming Enterprise Through AI" hackathon.

---

## Architecture

```
PDF → [Extractor] → PolicyRules → [Compiler] → Lobster Trap YAML
                                                      ↓
                                              [LobsterTrapManager]
                                                      ↓
Attacks → [Simulator] → Verdicts → [Healer] → Patched YAML → [Reporter] → audit.pdf
```

**7 backend modules:**
- `extractor.py` — PyMuPDF + Gemini structured output → PolicyRule objects
- `compiler.py` — PolicyRules → Lobster Trap YAML (pure Python)
- `test_gen.py` — curated attacks + Gemini variant generator
- `simulator.py` — httpx → Lobster Trap proxy → verdict recorder
- `healer.py` — Gemini structured output → YAML patch + regression check
- `reporter.py` — WeasyPrint → audit PDF
- `lobster_mgr.py` — single chokepoint for all Lobster Trap subprocess calls

---

## Setup

### Prerequisites
- Python 3.11
- Node.js 20 LTS
- `lobstertrap.exe` in the project root (build from [veeainc/lobstertrap](https://github.com/veeainc/lobstertrap))

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
cp .env.example .env          # then fill in your keys
uvicorn app.main:app --reload
```

Backend runs on http://localhost:8000

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on http://localhost:3000. Works with mock data without backend.

---

## Environment Variables

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Google Gemini 2.5 Pro API key |
| `LOBSTER_TRAP_PATH` | Path to lobstertrap.exe (default: `../lobstertrap.exe`) |
| `LOBSTER_TRAP_PORT` | Port Lobster Trap proxy listens on (default: `8080`) |
| `DATABASE_URL` | SQLite connection string (default: `sqlite:///./regulaforge.db`) |

---

## Project Structure

```
regulaforge/
├── backend/app/         # FastAPI + 7 modules
├── frontend/            # Next.js 14 App Router
├── data/                # Attack scenarios + golden rules
├── policies/            # Drop PDF files here
├── prompts/             # Gemini prompt templates
└── lobstertrap.exe      # Veea enforcement binary
```

---

## Screens

| Screen | Route | Description |
|---|---|---|
| Compile | `/compile` | Upload PDF → stream extracted rules |
| Simulate | `/simulate` | Chat with fake finance agent → see verdicts |
| Red Team | `/redteam` | Run 40 attacks → live pass/fail table |
| Heal | `/heal` | YAML diff viewer + Gemini reasoning |
| Audit | `/audit` | PDF preview + download |
