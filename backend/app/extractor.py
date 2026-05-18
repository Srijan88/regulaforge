from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator

import asyncio

import fitz  # PyMuPDF
from google import genai
from google.genai import types
from pydantic import BaseModel
from dotenv import load_dotenv

from .schemas import ComplianceClause, ExtractionResult, PolicyRule, RuleAction

load_dotenv()

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_FALLBACK = os.getenv("GEMINI_FALLBACK", "gemini-2.5-flash")

# ---------------------------------------------------------------------------
# Boilerplate patterns to strip from every page (exact repeated headers/footers)
# ---------------------------------------------------------------------------
_BOILERPLATE = [
    re.compile(r"This Guide provides supplemental information[^.]+\.", re.IGNORECASE),
    re.compile(r"FFIEC BSA/AML Examination Manual\s*\d*\s*\d*/\d+/\d+\.V\d+", re.IGNORECASE),
    re.compile(r"PCI DSS Quick Reference Guide[^\n]*", re.IGNORECASE),
]


# ---------------------------------------------------------------------------
# Internal Gemini response schema
# ---------------------------------------------------------------------------

class _Clause(BaseModel):
    section: str   # e.g. "3.2" or "Funds Transfers Risk Factors"
    page: int
    text: str      # verbatim quote ≤ 120 chars


class _Rule(BaseModel):
    name: str       # snake_case  e.g. block_cvv_storage
    description: str
    action: str     # "deny" | "allow" | "audit"
    pattern: str    # valid Python regex
    severity: str   # "critical" | "high" | "medium" | "low"
    clauses: list[_Clause]


class _RuleList(BaseModel):
    rules: list[_Rule]


# ---------------------------------------------------------------------------
# Rich page extraction  (font-aware)
# ---------------------------------------------------------------------------

def _is_boilerplate(text: str) -> bool:
    return any(p.search(text) for p in _BOILERPLATE)


def _extract_pages_rich(pdf_path: str) -> list[dict]:
    """
    Extract pages using font metadata for structural awareness.

    Each returned dict has:
      page_num   : 1-indexed int
      text       : clean plain text (boilerplate stripped)
      annotated  : text with ## H1 / # H2 markers on headings (sent to Gemini)
      headings   : list of heading strings found on the page
    """
    doc = fitz.open(pdf_path)
    pages: list[dict] = []

    for i, page in enumerate(doc, start=1):
        raw_blocks = page.get_text("dict")["blocks"]

        plain_parts: list[str] = []
        annotated_parts: list[str] = []
        headings: list[str] = []

        for block in raw_blocks:
            if block["type"] != 0:   # skip image blocks
                continue
            for line in block["lines"]:
                line_text = ""
                max_size = 0.0
                is_bold = False

                for span in line["spans"]:
                    t = span["text"].strip()
                    if not t:
                        continue
                    sz = span["size"]
                    bold = "Bold" in span["font"]
                    # Skip footer / watermark text (tiny italic)
                    if sz <= 6.5:
                        continue
                    line_text += t + " "
                    if sz > max_size:
                        max_size = sz
                    if bold:
                        is_bold = True

                line_text = line_text.strip()
                if not line_text or _is_boilerplate(line_text):
                    continue

                # Annotate by font prominence so Gemini sees structure
                if max_size >= 10.5 and is_bold:          # major section heading
                    annotated_parts.append(f"## {line_text}")
                    headings.append(line_text)
                elif max_size >= 8.8 and is_bold:          # requirement / subsection heading
                    annotated_parts.append(f"# {line_text}")
                    headings.append(line_text)
                else:
                    annotated_parts.append(line_text)

                plain_parts.append(line_text)

        pages.append({
            "page_num": i,
            "text": " ".join(plain_parts),
            "annotated": "\n".join(annotated_parts),
            "headings": headings,
        })

    doc.close()
    return pages


# ---------------------------------------------------------------------------
# Document type detection
# ---------------------------------------------------------------------------

def _detect_doc_type(pages: list[dict]) -> str:
    """Return 'pci_dss' | 'ffiec' | 'generic' based on first-page content."""
    first_text = pages[0]["text"].lower() if pages else ""
    if "pci" in first_text or "payment card industry" in first_text:
        return "pci_dss"
    if "ffiec" in first_text or "bsa/aml" in first_text or "funds transfer" in first_text:
        return "ffiec"
    return "generic"


# ---------------------------------------------------------------------------
# Chunking strategies
# ---------------------------------------------------------------------------

# PCI DSS: "Requirement 3:" appears as sz=9.0 Bold — also visible as plain text
_PCI_REQ = re.compile(r"Requirement\s+(\d+):", re.IGNORECASE)


def _chunk_pci_dss(pages: list[dict]) -> list[dict]:
    """
    Chunk PCI DSS pages by Requirement boundary.

    Uses heading annotations first; falls back to plain-text regex.
    Skips front-matter pages (no requirement headings in first 8 pages).
    """
    chunks: list[dict] = []
    current: dict | None = None

    for page in pages:
        # Detect requirement boundaries via headings detected from font metadata
        found_req = False
        for heading in page["headings"]:
            m = _PCI_REQ.search(heading)
            if m:
                req_num = int(m.group(1))
                if current:
                    chunks.append(current)
                current = {
                    "label": f"Requirement {req_num}",
                    "req_num": req_num,
                    "pages": [page["page_num"]],
                    "annotated": page["annotated"],
                }
                found_req = True
                break

        if not found_req and current:
            current["pages"].append(page["page_num"])
            current["annotated"] += "\n\n" + page["annotated"]

    if current:
        chunks.append(current)

    if not chunks:  # fallback
        all_text = "\n\n".join(p["annotated"] for p in pages)
        chunks = [{"label": "Full document", "req_num": 0,
                   "pages": [p["page_num"] for p in pages], "annotated": all_text}]
    return chunks


def _chunk_ffiec(pages: list[dict]) -> list[dict]:
    """
    Chunk FFIEC document by bold section headings (no Requirement N: format).

    Groups 2-3 pages per chunk to keep context tight but calls manageable.
    """
    chunks: list[dict] = []
    current: dict | None = None

    for page in pages:
        section_heading = next(
            (h for h in page["headings"] if len(h) > 8 and not h[:3].isdigit()),
            None,
        )

        if section_heading and current and len(current["pages"]) >= 2:
            # Start new chunk at significant heading after at least 2 pages
            chunks.append(current)
            current = {
                "label": section_heading,
                "req_num": 0,
                "pages": [page["page_num"]],
                "annotated": page["annotated"],
            }
        elif current:
            current["pages"].append(page["page_num"])
            current["annotated"] += "\n\n" + page["annotated"]
        else:
            current = {
                "label": section_heading or f"Page {page['page_num']}",
                "req_num": 0,
                "pages": [page["page_num"]],
                "annotated": page["annotated"],
            }

    if current:
        chunks.append(current)
    return chunks


def _chunk_generic(pages: list[dict]) -> list[dict]:
    """Fallback: one chunk per 4 pages."""
    chunks: list[dict] = []
    for i in range(0, len(pages), 4):
        group = pages[i : i + 4]
        chunks.append({
            "label": f"Pages {group[0]['page_num']}-{group[-1]['page_num']}",
            "req_num": 0,
            "pages": [p["page_num"] for p in group],
            "annotated": "\n\n".join(p["annotated"] for p in group),
        })
    return chunks


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

_BASE_SYSTEM = """\
You are a compliance rule extraction engine for a finance AI policy enforcement system.
Your output will be loaded directly into a Lobster Trap policy engine that intercepts
and evaluates natural-language messages sent to a finance AI agent.

EXTRACTION RULES:
1. Extract operationally enforceable rules from ALL of the following signal types:

   A. EXPLICIT PROHIBITIONS ("must not", "never", "prohibited", "shall not")
      → action: "deny"
   B. MANDATORY REQUIREMENTS ("must", "shall", "required to", "are required")
      → action: "deny" (blocking) or "audit" (monitoring)
   C. RISK STATEMENTS ("poses heightened risk", "high risk", "elevated risk",
      "risk factors include", "red flags", "warning signs")
      → action: "human_review"
   D. RECOMMENDED PRACTICES ("should", "banks should", "it is recommended")
      → action: "audit"
   E. MONITORING REQUIREMENTS ("monitor for", "detect", "identify", "watch for",
      "banks need to monitor", "review transactions")
      → action: "audit"
   F. IMPLIED PROHIBITIONS (sanctions lists, OFAC requirements, fraud indicators
      where context makes the prohibition clear even without explicit "must not")
      → action: "deny"

2. Write `pattern` as a Python regex that matches a finance-agent message violating the rule.
   - DENY rules: match the specific violation (PAN disclosure, wire to sanctioned country)
   - HUMAN_REVIEW rules: match the risk trigger (large foreign wire, unusual transaction)
   - AUDIT rules: match the monitored activity (sub-threshold transfers, new payee)
   Patterns must target specific finance operations: card data (PAN, CVV, track), wire
   amounts, account numbers, OFAC jurisdictions (Iran, DPRK, Cuba, Russia, Syria),
   authentication credentials, threshold amounts, urgency language.
   Be specific enough to avoid false positives on safe messages.

3. Cite exact section/requirement numbers and include a verbatim quote ≤ 120 chars.

4. Skip purely administrative/documentation obligations with no runtime enforcement value
   (e.g. "maintain records for 7 years", "submit annual report").

5. severity levels:
   - critical → direct cardholder / payment data exposure (PAN, CVV, full track data)
   - high     → authentication, access control, sanctions, or wire transfer violations
   - medium   → policy gaps, monitoring failures, risk indicators
   - low      → procedural or record-keeping obligations

6. Aim for 5-10 rules per chunk by inferring from risk language, NOT just explicit mandates.
   Risk factor descriptions → HUMAN_REVIEW rules.
   Monitoring requirement sections → AUDIT rules.

7. rule `name` must be snake_case and descriptive:
   block_cvv_disclosure, require_ofac_screening, flag_high_value_foreign_wire,
   monitor_structuring_patterns, block_incomplete_wire_message
"""

_SECOND_PASS_ADDENDUM = """
SECOND EXTRACTION PASS — focus exclusively on inferred and implied rules.

The first pass already extracted explicit "must/must not" rules. Your task NOW is to find
rules that were MISSED because they use softer language:

1. Any sentence containing risk language: "risk", "heightened", "red flag", "suspicious",
   "warning", "concern", "elevated", "unusual" → create a HUMAN_REVIEW rule
2. Any "should" recommendation → create an AUDIT rule
3. Any monitoring requirement ("monitor", "detect", "identify patterns") → create AUDIT rule
4. Any list of risk factors or red flags → one HUMAN_REVIEW rule per distinct risk category
5. Any mention of a specific jurisdiction, entity type, or transaction type as risky
   → HUMAN_REVIEW rule for that specific trigger

DO NOT repeat rules already extracted. Focus only on risk statements, soft requirements,
and monitoring language that was likely skipped in the first pass.
"""

_PCI_ADDENDUM = """
DOCUMENT CONTEXT: PCI DSS v3.2.1 Quick Reference Guide
Focus areas: card data storage (PAN, CVV, track data), encryption in transit,
access control, authentication, audit logging. Finance agent context: agents that
process payment card transactions, lookup cardholder data, or handle card credentials.
"""

_FFIEC_ADDENDUM = """
DOCUMENT CONTEXT: FFIEC BSA/AML Wire Transfer Guidance
Focus areas: OFAC sanctions screening, suspicious activity monitoring, wire transfer
transparency (originator/beneficiary info), informal value transfer systems (IVTS),
threshold limits, incomplete payment messages, correspondent banking due diligence.
Finance agent context: agents that initiate, approve, or query wire transfers.
"""


def _build_prompt(chunk: dict, source_doc: str, doc_type: str, second_pass: bool = False) -> str:
    addendum = _PCI_ADDENDUM if doc_type == "pci_dss" else (
        _FFIEC_ADDENDUM if doc_type == "ffiec" else ""
    )
    if second_pass:
        addendum += _SECOND_PASS_ADDENDUM
    page_range = (
        f"page {chunk['pages'][0]}"
        if len(chunk["pages"]) == 1
        else f"pages {min(chunk['pages'])}-{max(chunk['pages'])}"
    )
    instruction = (
        "Extract ADDITIONAL inferred rules (risk statements, monitoring requirements, "
        "soft language). Do NOT repeat rules from the first pass. Return JSON with a 'rules' array."
        if second_pass else
        "Extract enforceable finance-agent policy rules. Return JSON with a 'rules' array."
    )
    return (
        _BASE_SYSTEM
        + addendum
        + f"\nSOURCE: {source_doc} | SECTION: {chunk['label']} ({page_range})\n\n"
        + "DOCUMENT TEXT (## = major heading, # = section heading):\n"
        + chunk["annotated"][:6500]
        + f"\n\n{instruction}"
    )


# ---------------------------------------------------------------------------
# Gemini call
# ---------------------------------------------------------------------------

async def _call_gemini(
    client: genai.Client,
    chunk: dict,
    source_doc: str,
    doc_type: str,
    second_pass: bool = False,
) -> list[PolicyRule]:
    prompt = _build_prompt(chunk, source_doc, doc_type, second_pass=second_pass)

    # Try primary model with retries, fall back to flash on persistent 503
    models_to_try = [GEMINI_MODEL, GEMINI_FALLBACK]
    last_exc: Exception | None = None

    for model in models_to_try:
        for attempt in range(3):
            try:
                # Use sync client wrapped in asyncio.to_thread — genai 0.8.0 async
                # path ignores api_key and falls back to ADC, sync path works correctly.
                def _sync_call():
                    return client.models.generate_content(
                        model=model,
                        contents=[types.Content(role="user", parts=[types.Part(text=prompt)])],
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            response_schema=_RuleList,
                            temperature=0.1,
                        ),
                    )
                response = await asyncio.to_thread(_sync_call)
                last_exc = None
                break  # success
            except Exception as exc:
                last_exc = exc
                msg = str(exc).lower()
                if "unavailable" in msg or "503" in msg or "resource_exhausted" in msg or "429" in msg:
                    await asyncio.sleep(2 ** attempt)  # 1s, 2s, 4s
                    continue
                raise  # non-retryable error
        if last_exc is None:
            break  # got a response, skip fallback model

    if last_exc is not None:
        raise last_exc

    rule_list: _RuleList | None = response.parsed
    if not rule_list or not rule_list.rules:
        return []

    results: list[PolicyRule] = []
    for r in rule_list.rules:
        try:
            action = RuleAction(r.action.lower())
        except ValueError:
            action = RuleAction.DENY

        results.append(
            PolicyRule(
                id=f"{doc_type[:4]}-{r.name}-{uuid.uuid4().hex[:6]}",
                name=r.name,
                description=r.description,
                action=action,
                pattern=r.pattern,
                severity=r.severity,
                source_clauses=[
                    ComplianceClause(
                        source_doc=source_doc,
                        section=c.section,
                        page=c.page,
                        text=c.text,
                    )
                    for c in r.clauses
                ],
                metadata={
                    "doc_type": doc_type,
                    "chunk_label": chunk["label"],
                    "source_pages": chunk["pages"],
                },
            )
        )
    return results


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class ProgressEvent:
    """Sentinel yielded by extract_rules_stream to signal progress between chunks."""
    __slots__ = ("message", "chunk_label", "chunk_index", "total_chunks", "pass_num")

    def __init__(self, message: str, chunk_label: str, chunk_index: int, total_chunks: int, pass_num: int = 1):
        self.message = message
        self.chunk_label = chunk_label
        self.chunk_index = chunk_index
        self.total_chunks = total_chunks
        self.pass_num = pass_num


async def extract_rules(pdf_path: str) -> AsyncGenerator[PolicyRule, None]:
    """
    Parse a compliance PDF and stream extracted PolicyRule objects.
    Yields only PolicyRule objects (no progress events). Use extract_rules_stream
    for the SSE endpoint which also needs progress events.
    """
    async for item in extract_rules_stream(pdf_path):
        if isinstance(item, PolicyRule):
            yield item


async def extract_rules_stream(pdf_path: str):
    """
    Parse a compliance PDF and stream both ProgressEvent and PolicyRule objects.

    Pipeline:
      1. PyMuPDF font-aware extraction — strips boilerplate, annotates headings
      2. Document-type detection (pci_dss / ffiec / generic)
      3. Type-appropriate chunking strategy
      4. ALL chunks sent to Gemini concurrently (semaphore=5) — results stream as they land
      5. Deduplication by rule name before yielding

    Yields ProgressEvent then PolicyRule objects as each chunk completes.
    """
    from . import get_gemini_client
    client = get_gemini_client()
    source_doc = os.path.basename(pdf_path)

    pages = _extract_pages_rich(pdf_path)
    doc_type = _detect_doc_type(pages)

    if doc_type == "pci_dss":
        chunks = _chunk_pci_dss(pages)
    elif doc_type == "ffiec":
        chunks = _chunk_ffiec(pages)
    else:
        chunks = _chunk_generic(pages)

    total = len(chunks)
    seen_names: set[str] = set()

    # --- Concurrent pass: fire all chunks simultaneously, yield as they complete ---
    sem = asyncio.Semaphore(5)  # max 5 parallel Gemini calls

    async def _fetch(chunk: dict, idx: int) -> tuple[int, dict, list]:
        async with sem:
            rules = await _call_gemini(client, chunk, source_doc, doc_type)
            return idx, chunk, rules

    tasks = [asyncio.create_task(_fetch(chunk, i)) for i, chunk in enumerate(chunks, start=1)]

    # Emit an initial progress event so the UI knows work has started
    yield ProgressEvent(
        message=f"Analysing {total} sections in parallel…",
        chunk_label="all",
        chunk_index=0,
        total_chunks=total,
        pass_num=1,
    )

    completed = 0
    for coro in asyncio.as_completed(tasks):
        idx, chunk, rules = await coro
        completed += 1
        yield ProgressEvent(
            message=f"Completed {chunk['label']}",
            chunk_label=chunk["label"],
            chunk_index=completed,
            total_chunks=total,
            pass_num=1,
        )
        for rule in rules:
            if rule.name in seen_names:
                continue
            seen_names.add(rule.name)
            yield rule

    # Second pass only if very few rules found — runs concurrently too
    if len(seen_names) < 8:
        print(f"[extractor] Only {len(seen_names)} rules — running second pass")

        async def _fetch2(chunk: dict, idx: int) -> tuple[int, dict, list]:
            async with sem:
                rules = await _call_gemini(client, chunk, source_doc, doc_type, second_pass=True)
                return idx, chunk, rules

        tasks2 = [asyncio.create_task(_fetch2(chunk, i)) for i, chunk in enumerate(chunks, start=1)]
        completed2 = 0
        for coro in asyncio.as_completed(tasks2):
            idx, chunk, rules = await coro
            completed2 += 1
            yield ProgressEvent(
                message=f"Deep scan {chunk['label']}",
                chunk_label=chunk["label"],
                chunk_index=completed2,
                total_chunks=total,
                pass_num=2,
            )
            for rule in rules:
                if rule.name in seen_names:
                    continue
                seen_names.add(rule.name)
                yield rule


async def extract_to_result(pdf_path: str) -> ExtractionResult:
    """
    Collect all streamed rules into a single ExtractionResult.
    Used by compiler.py, tests, and the non-streaming compile endpoint.
    """
    source_doc = os.path.basename(pdf_path)
    policy_id = re.sub(r"[^a-z0-9]+", "-", source_doc.lower().removesuffix(".pdf"))

    rules: list[PolicyRule] = []
    async for rule in extract_rules(pdf_path):
        rules.append(rule)

    return ExtractionResult(
        policy_id=policy_id,
        source_document=source_doc,
        rules=rules,
        extracted_at=datetime.now(timezone.utc).isoformat(),
    )
