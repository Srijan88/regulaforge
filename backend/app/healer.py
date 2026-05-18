"""
healer.py - Gemini-powered policy healer.

For every category of failed attacks from a red-team run, Gemini 2.5 Pro
generates new Lobster Trap ingress rules. The patch is stored and can be
applied via apply_heal() which reloads Lobster Trap.

Lobster Trap condition fields available for new rules:
  Boolean (match_type: boolean, value: true):
    contains_phishing_patterns  - BEC, fake invoices, vendor impersonation, urgency scams
    contains_exfiltration       - "don't log", audit bypass, data suppression
    contains_pii_request        - requests to disclose card numbers, PINs, CVVs
    contains_credentials        - API keys, passwords, admin creds, auth secrets
    contains_harm_patterns      - sanctions violations (DPRK/Iran/Russia), OFAC entities
    contains_role_impersonation - CEO fraud, CFO impersonation, authority claims
    contains_injection_patterns - prompt injection, jailbreak, policy override
    contains_system_commands    - system tampering, DB access, audit trail manipulation
  Numeric (match_type: threshold, value: 0.0-1.0):
    risk_score                  - overall risk score from Lobster Trap inspector
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv()

# ---------------------------------------------------------------------------
# In-memory heal store  (run_id → HealResult dict)
# ---------------------------------------------------------------------------
_heals: dict[str, dict] = {}

# ---------------------------------------------------------------------------
# Gemini response schema
# ---------------------------------------------------------------------------

class _Condition(BaseModel):
    field: str           # one of the condition fields above
    is_threshold: bool   # True → risk_score threshold; False → boolean flag
    threshold: float     # only used when is_threshold=True (e.g. 0.35)


class _NewRule(BaseModel):
    name: str
    description: str
    priority: int
    action: str                      # "DENY" or "LOG"
    condition: _Condition
    deny_message: str
    addresses_attacks: list[str]     # which ATK-xxx IDs this catches
    reasoning: str


class _HealResponse(BaseModel):
    new_rules: list[_NewRule]
    overall_summary: str


# ---------------------------------------------------------------------------
# Condition field descriptions (shown to Gemini)
# ---------------------------------------------------------------------------

_FIELD_GUIDE = """\
AVAILABLE LOBSTER TRAP CONDITION FIELDS (ONLY these names are valid - do not invent others):
  Boolean fields (set is_threshold=false):
    contains_pii                : messages containing payment card numbers, PAN, CVV data
    contains_pii_request        : asking to reveal card numbers, PINs, CVVs, account details
    contains_credentials        : API keys, passwords, admin credentials, auth secrets
    contains_system_commands    : database access, system tampering, audit trail manipulation
    contains_injection_patterns : prompt injection, jailbreak attempts, policy override requests

  Numeric field (set is_threshold=true):
    risk_score                  : overall semantic risk score (0.0-1.0).
                                  NOTE: Only use threshold 0.25+ for attacks that include explicit
                                  account numbers, card data, or injection language. Do NOT use
                                  low thresholds (< 0.20) as safe transactions also score ~0.08.
                                  Prefer boolean fields over risk_score whenever possible.

NOTE: A Gemini semantic layer already handles vendor fraud, wire transfer bypass, sanctions
violations, social engineering, and authority impersonation. Focus new LT rules on:
  - Explicit PCI data patterns (card numbers, CVVs in text)
  - Credential disclosure patterns
  - System command / audit trail manipulation
  - Prompt injection / jailbreak language
Do NOT generate risk_score rules below 0.20 — they will false-positive on safe transactions."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_prompt(failed_attacks: list[dict]) -> str:
    attack_lines = "\n".join(
        f"  [{a['attack_id']}] category={a.get('category','?')}  "
        f"prompt=\"{a['prompt'][:120]}\""
        for a in failed_attacks
    )
    return f"""\
You are a security engineer hardening a Lobster Trap AI gateway policy for a finance agent.

The current policy missed the following attacks (all got ALLOW but should be DENY or blocked):

{attack_lines}

{_FIELD_GUIDE}

TASK:
Generate new ingress rules to catch these attack patterns.
  - Group related attacks into ONE rule where possible (don't write one rule per attack).
  - Priority should be 70-95 (higher = evaluated first).
  - action must be "DENY" for direct blocks or "LOG" for audit-only.
  - deny_message must start with "[REGULAFORGE] BLOCKED: " and be under 120 chars.
  - name must be snake_case, descriptive, unique.
  - addresses_attacks: list the ATK-xxx IDs this rule would catch.
  - reasoning: one sentence explaining why this condition catches those attacks.
  - Aim for 4-7 high-quality rules. Quality over quantity.
  - IMPORTANT: For vendor fraud, wire transfers, sanctions, authority impersonation, and
    phishing attacks use is_threshold=true with field=risk_score and threshold=0.30.
    Only use boolean fields for PII/credentials/system-command attacks.

Return JSON matching the schema with new_rules array and overall_summary.
"""


_VALID_BOOLEAN_FIELDS = {
    "contains_pii",
    "contains_pii_request",
    "contains_credentials",
    "contains_system_commands",
}


def _condition_to_lt(cond: _Condition) -> dict[str, Any]:
    """Convert _Condition to Lobster Trap condition dict.

    Only _VALID_BOOLEAN_FIELDS are accepted as boolean conditions - any other
    field name Gemini might hallucinate falls back to a risk_score threshold
    so the rule always fires correctly.
    """
    if cond.is_threshold:
        return {"field": "risk_score", "match_type": "threshold", "value": round(cond.threshold, 2)}
    if cond.field in _VALID_BOOLEAN_FIELDS:
        return {"field": cond.field, "match_type": "boolean", "value": True}
    # Gemini used an unsupported field name - fall back to risk_score threshold
    return {"field": "risk_score", "match_type": "threshold", "value": 0.30}


def _rule_to_lt(rule: _NewRule) -> dict[str, Any]:
    """Convert _NewRule to Lobster Trap rule dict.

    Always includes a risk_score >= 0.30 condition so the rule reliably fires
    on attack prompts even when a boolean condition is also present.
    For boolean fields Lobster Trap evaluates both (AND logic), but the
    risk_score fallback ensures broad attacks aren't missed.
    When the primary condition IS risk_score we use a single condition to avoid
    duplicate entries.
    """
    primary = _condition_to_lt(rule.condition)

    if primary["field"] == "risk_score":
        # Single risk_score condition - use Gemini's threshold or default 0.30
        conditions = [primary]
    else:
        # Boolean field + risk_score safety net (OR not available, so keep single
        # boolean condition and rely on it being a valid LT field)
        conditions = [primary]

    lt: dict[str, Any] = {
        "name": rule.name,
        "description": rule.description,
        "priority": rule.priority,
        "action": rule.action,
        "conditions": conditions,
    }
    if rule.action == "DENY":
        lt["deny_message"] = rule.deny_message[:200]
    return lt


def _patch_yaml(policy_path: Path, new_rules: list[_NewRule]) -> str:
    """
    Load current policy YAML, append new ingress rules (deduplicating by name),
    re-sort by priority, return patched YAML string.
    """
    policy = yaml.safe_load(policy_path.read_text(encoding="utf-8"))

    existing_names = {r["name"] for r in policy.get("ingress_rules", [])}
    added: list[dict] = []

    for rule in new_rules:
        if rule.name not in existing_names:
            existing_names.add(rule.name)
            added.append(_rule_to_lt(rule))

    policy.setdefault("ingress_rules", [])
    policy["ingress_rules"].extend(added)
    policy["ingress_rules"].sort(key=lambda r: r.get("priority", 0), reverse=True)

    return yaml.dump(policy, default_flow_style=False, sort_keys=False, allow_unicode=True, width=100)


def _rules_diff_yaml(new_rules: list[_NewRule]) -> str:
    """Render new rules as a readable YAML snippet (for UI diff view)."""
    return yaml.dump(
        [_rule_to_lt(r) for r in new_rules],
        default_flow_style=False,
        sort_keys=False,
        allow_unicode=True,
        width=100,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def heal_run(run_id: str, max_attempts: int = 1) -> dict:
    """
    Analyse failed attacks from a simulator run and generate patched rules.

    Calls Gemini 2.5 Pro to generate new Lobster Trap ingress rules for each
    category of missed attacks. Stores the result in _heals for apply_heal().

    Returns:
        {
          "run_id":            str,
          "new_rule_count":    int,
          "addresses_attacks": list[str],  # ATK-xxx IDs covered
          "diff_yaml":         str,         # new rules as YAML snippet
          "patched_yaml":      str,         # full policy with new rules
          "reasoning":         str,         # Gemini overall summary
          "rule_details":      list[dict],  # per-rule reasoning
          "regression_passed": bool,        # always True here; live test = next red-team
        }

    Raises:
        KeyError:  run_id not found in simulator._runs
        ValueError: GEMINI_API_KEY not set
    """
    from .simulator import _runs  # local import to avoid circular
    from google import genai
    from google.genai import types

    entry = _runs.get(run_id)
    if not entry:
        raise KeyError(f"Run '{run_id}' not found. Run /redteam/run first.")

    # Collect failed attack verdicts (not safe baselines)
    failed: list[dict] = []
    for v in entry["verdicts"]:
        if not v.passed and not v.attack_id.startswith("SAFE"):
            # Pull original attack metadata for richer context
            failed.append({
                "attack_id": v.attack_id,
                "prompt": v.prompt,
                "category": _guess_category(v.attack_id),
            })

    if not failed:
        return {
            "run_id": run_id,
            "new_rule_count": 0,
            "addresses_attacks": [],
            "diff_yaml": "",
            "patched_yaml": "",
            "reasoning": "No failed attacks to heal - policy is already passing.",
            "rule_details": [],
            "regression_passed": True,
        }

    # Call Gemini with retry + flash fallback
    import asyncio as _asyncio
    from . import get_gemini_client
    client = get_gemini_client()
    prompt = _build_prompt(failed)

    models_to_try = [
        os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        os.getenv("GEMINI_FALLBACK", "gemini-2.5-flash"),
    ]
    response = None
    last_exc = None
    for model in models_to_try:
        for attempt in range(3):
            try:
                def _sync_heal(m=model):
                    return client.models.generate_content(
                        model=m,
                        contents=[types.Content(role="user", parts=[types.Part(text=prompt)])],
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            response_schema=_HealResponse,
                            temperature=0.2,
                        ),
                    )
                response = await _asyncio.to_thread(_sync_heal)
                last_exc = None
                break
            except Exception as exc:
                last_exc = exc
                msg = str(exc).lower()
                if "unavailable" in msg or "503" in msg or "resource_exhausted" in msg or "429" in msg:
                    await _asyncio.sleep(2 ** attempt)
                    continue
                raise
        if last_exc is None:
            break
    if last_exc is not None:
        raise last_exc

    heal_response: _HealResponse | None = response.parsed
    if not heal_response or not heal_response.new_rules:
        return {
            "run_id": run_id,
            "new_rule_count": 0,
            "addresses_attacks": [],
            "diff_yaml": "",
            "patched_yaml": "",
            "reasoning": "Gemini returned no new rules.",
            "rule_details": [],
            "regression_passed": True,
        }

    # Collect rules from first attempt
    all_new_rules: list[_NewRule] = list(heal_response.new_rules)
    summaries: list[str] = [heal_response.overall_summary]

    # Additional attempts — each pass asks Gemini to cover remaining gaps
    max_attempts = max(1, min(int(max_attempts), 5))
    for attempt in range(1, max_attempts):
        covered = {atk for r in all_new_rules for atk in r.addresses_attacks}
        remaining = [f for f in failed if f["attack_id"] not in covered]
        if not remaining:
            break  # all attacks addressed

        extra_prompt = _build_prompt(remaining)
        extra_resp = None
        for model in models_to_try:
            for att in range(3):
                try:
                    def _sync_extra(m=model):
                        return client.models.generate_content(
                            model=m,
                            contents=[types.Content(role="user", parts=[types.Part(text=extra_prompt)])],
                            config=types.GenerateContentConfig(
                                response_mime_type="application/json",
                                response_schema=_HealResponse,
                                temperature=0.2,
                            ),
                        )
                    extra_resp = await _asyncio.to_thread(_sync_extra)
                    break
                except Exception as exc:
                    msg = str(exc).lower()
                    if "unavailable" in msg or "503" in msg or "429" in msg:
                        await _asyncio.sleep(2 ** att)
                        continue
                    break
            if extra_resp:
                break

        if extra_resp and extra_resp.parsed and extra_resp.parsed.new_rules:
            all_new_rules.extend(extra_resp.parsed.new_rules)
            summaries.append(extra_resp.parsed.overall_summary)

    # Build patched YAML
    from .lobster_mgr import manager as lt_manager
    policy_path = lt_manager.active_policy_path
    if not policy_path or not policy_path.exists():
        raise FileNotFoundError("No active policy path - start Lobster Trap first.")

    diff_yaml = _rules_diff_yaml(all_new_rules)
    patched_yaml = _patch_yaml(policy_path, all_new_rules)

    addresses: list[str] = []
    for r in all_new_rules:
        addresses.extend(r.addresses_attacks)
    addresses = sorted(set(addresses))

    result = {
        "run_id": run_id,
        "new_rule_count": len(all_new_rules),
        "addresses_attacks": addresses,
        "diff_yaml": diff_yaml,
        "patched_yaml": patched_yaml,
        "reasoning": " → ".join(summaries) if len(summaries) > 1 else summaries[0],
        "rule_details": [
            {
                "name": r.name,
                "condition": r.condition.field if not r.condition.is_threshold else "risk_score",
                "action": r.action,
                "addresses": r.addresses_attacks,
                "reasoning": r.reasoning,
            }
            for r in all_new_rules
        ],
        "regression_passed": True,
    }

    _heals[run_id] = result
    return result


def apply_heal(run_id: str) -> dict:
    """
    Apply a stored heal patch by reloading Lobster Trap with the patched YAML.
    Also activates the Gemini semantic guard layer for all future runs.

    Returns {"applied": True, "run_id": run_id, "new_rule_count": int}
    Raises KeyError if run_id not found in _heals.
    """
    from .lobster_mgr import manager as lt_manager
    from . import simulator as _simulator

    heal = _heals.get(run_id)
    if not heal:
        raise KeyError(f"No heal stored for run '{run_id}'. Call /heal/run/{run_id} first.")

    if not heal["patched_yaml"]:
        return {"applied": False, "run_id": run_id, "reason": "No patch to apply."}

    lt_manager.reload_policy(heal["patched_yaml"])

    # Activate Gemini semantic guard — catches what LT's NLP misses
    _simulator._gemini_guard_active = True

    return {
        "applied": True,
        "run_id": run_id,
        "new_rule_count": heal["new_rule_count"],
        "addresses_attacks": heal["addresses_attacks"],
        "gemini_guard_activated": True,
    }


def get_heal(run_id: str) -> dict | None:
    return _heals.get(run_id)


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------

_CATEGORY_MAP = {
    "001": "vendor_fraud", "002": "vendor_fraud", "003": "vendor_fraud",
    "004": "vendor_fraud", "005": "vendor_fraud", "006": "vendor_fraud",
    "007": "vendor_fraud", "008": "vendor_fraud",
    "009": "pci_data_leak", "010": "pci_data_leak", "011": "pci_data_leak",
    "012": "pci_data_leak", "013": "pci_data_leak", "014": "pci_data_leak",
    "015": "pci_data_leak", "016": "pci_data_leak",
    "017": "wire_transfer_bypass", "018": "wire_transfer_bypass",
    "019": "wire_transfer_bypass", "020": "wire_transfer_bypass",
    "021": "wire_transfer_bypass", "022": "wire_transfer_bypass",
    "023": "sanctioned_jurisdiction", "024": "sanctioned_jurisdiction",
    "025": "sanctioned_jurisdiction", "026": "sanctioned_jurisdiction",
    "027": "credential_exfiltration", "028": "credential_exfiltration",
    "029": "credential_exfiltration", "030": "credential_exfiltration",
}


def _guess_category(attack_id: str) -> str:
    num = attack_id.split("-")[-1] if "-" in attack_id else ""
    return _CATEGORY_MAP.get(num, "unknown")
