"""
explainer.py — Gemini-powered plain-English compliance explanations.

For each DENY / HUMAN_REVIEW verdict, generate a short explanation that
tells a non-technical manager:
  1. What the agent tried to do
  2. Which regulation it violates
  3. What would have happened without the rule
  4. How severe the violation is

Results are cached by (rule_name, verdict) to avoid repeated Gemini calls.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

from google import genai
from google.genai import types
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

# Cache: key = "{rule_name}:{verdict}" → explanation dict (without timestamp/audit_id)
_explain_cache: dict[str, dict] = {}


# ── Gemini response schema ────────────────────────────────────────────────────

class _ExplainResult(BaseModel):
    what_detected: str
    policy_violated: str
    what_would_happen: str
    severity: str           # "CRITICAL" | "HIGH" | "MEDIUM"
    regulation_reference: str


# ── Public API ────────────────────────────────────────────────────────────────

async def generate_explainability(
    prompt: str,
    verdict: str,
    rule_name: str | None,
    risk_score: float,
    enforced_by: str,
) -> dict:
    """
    Return a structured explanation for a DENY or HUMAN_REVIEW verdict.

    Checks cache first. On cache miss, calls gemini-2.5-pro with a compliance
    officer persona and returns the parsed result.
    """
    cache_key = f"{rule_name or 'unknown'}:{verdict.upper()}"

    if cache_key in _explain_cache:
        cached = dict(_explain_cache[cache_key])
        cached["audit_id"]   = f"reg-{uuid.uuid4().hex[:4]}"
        cached["timestamp"]  = _now()
        cached["from_cache"] = True
        return cached

    enforcer_label = (
        "Gemini Semantic Guard (AI layer)"
        if enforced_by == "gemini_semantic_layer"
        else "Lobster Trap Policy Engine (rules layer)"
    )

    user_prompt = f"""\
You are a compliance officer explaining a policy violation to a non-technical manager.

An AI finance agent received this input:
"{prompt}"

The policy enforcement system blocked it:
- Enforcement engine: {enforcer_label}
- Rule triggered: {rule_name or "unknown rule"}
- Action taken: {verdict.upper()}
- Risk score: {risk_score:.2f}

Write a SHORT explanation (4-5 lines total) covering:
1. what_detected — one plain-English line describing what the request attempted
2. policy_violated — which regulation this violates, with clause number if possible
   (use real standards: PCI-DSS, FFIEC BSA/AML, SOX, OFAC, GDPR as appropriate)
3. what_would_happen — specific consequence without this rule (data breach, wire fraud, fine)
4. severity — one of: CRITICAL, HIGH, MEDIUM (CRITICAL = direct data/fund exposure)
5. regulation_reference — short citation e.g. "PCI-DSS Req 3.2" or "FFIEC BSA/AML §4.2"

Return valid JSON only, no markdown fences.
"""

    try:
        import asyncio as _aio
        from . import get_gemini_client
        client = get_gemini_client()
        _model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
        def _sync_explain():
            return client.models.generate_content(
                model=_model,
                contents=[types.Content(role="user", parts=[types.Part(text=user_prompt)])],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=_ExplainResult,
                    temperature=0.2,
                ),
            )
        response = await _aio.to_thread(_sync_explain)
        parsed: _ExplainResult | None = response.parsed
        if not parsed:
            return _fallback(verdict, rule_name, risk_score)

        result = {
            "what_detected":       parsed.what_detected,
            "policy_violated":     parsed.policy_violated,
            "what_would_happen":   parsed.what_would_happen,
            "severity":            parsed.severity.upper(),
            "regulation_reference": parsed.regulation_reference,
            "audit_id":            f"reg-{uuid.uuid4().hex[:4]}",
            "timestamp":           _now(),
            "from_cache":          False,
        }

        # Cache without ephemeral fields so each call gets fresh audit_id/timestamp
        _explain_cache[cache_key] = {
            k: v for k, v in result.items()
            if k not in ("audit_id", "timestamp", "from_cache")
        }
        return result

    except Exception as exc:
        print(f"[explainer] Gemini call failed: {exc}")
        return _fallback(verdict, rule_name, risk_score)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def _fallback(verdict: str, rule_name: str | None, risk_score: float) -> dict:
    return {
        "what_detected":        "The request matched a policy rule requiring enforcement.",
        "policy_violated":      "Upload a policy document to see the specific compliance clause.",
        "what_would_happen":    "The finance agent would have processed the request without compliance checks.",
        "severity":             "HIGH" if risk_score > 0.5 else "MEDIUM",
        "regulation_reference": rule_name or "internal policy",
        "audit_id":             f"reg-{uuid.uuid4().hex[:4]}",
        "timestamp":            _now(),
        "from_cache":           False,
    }
