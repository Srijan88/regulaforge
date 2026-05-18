from __future__ import annotations

"""
compiler.py — Convert ExtractionResult → Lobster Trap YAML policy pack.

Pure Python, no LLM calls. Maps PolicyRule semantic content to the
Lobster Trap condition schema (boolean inspector fields + risk_score
thresholds). Priority is assigned by severity and source document.

Lobster Trap condition fields used:
  Boolean: contains_credentials, contains_pii, contains_pii_request,
           contains_injection_patterns, contains_exfiltration,
           contains_phishing_patterns, contains_system_commands,
           contains_obfuscation, contains_role_impersonation,
           contains_harm_patterns, contains_malware_request
  Numeric: risk_score (0.0-1.0)
  String:  intent_category (exact match)
"""

import re
from typing import Any

import yaml

from .schemas import ExtractionResult, PolicyRule, RuleAction

# ---------------------------------------------------------------------------
# Semantic field mapping
# Each entry: (keyword_fragments_to_check, lobster_trap_field)
# Checked against the rule name + description (lowercased, underscore-split).
# First match wins — order matters: more specific entries go first.
# ---------------------------------------------------------------------------
_FIELD_MAP: list[tuple[list[str], str]] = [
    # Card sensitive authentication data — always credentials
    (["cvv", "cvc", "cid", "cvv2", "cvc2", "pin", "track_data", "track data",
      "sensitive_auth", "authentication_data"], "contains_credentials"),

    # PAN / cardholder data requests
    (["pan_display", "pan_request", "full_pan", "bulk_pan", "pan_retrieval",
      "reveal", "display", "disclose", "what_is_the_card"], "contains_pii_request"),

    # PAN storage / logging
    (["pan", "cardholder", "card_number", "account_number", "unencrypted_pan",
      "pan_log", "pan_storage"], "contains_pii"),

    # Credentials / passwords / auth
    (["credential", "password", "passphrase", "default_account",
      "shared_account", "generic_id", "default_credential",
      "cleartext_password", "weak_password", "mfa", "admin_access"], "contains_credentials"),

    # Prompt / code injection
    (["injection", "jailbreak", "ignore_instructions", "system_tag",
      "override_policy", "bypass_filter"], "contains_injection_patterns"),

    # Data exfiltration / payment info stripping
    (["exfil", "strip", "omit", "delete_info", "alter_payment",
      "payment_info", "info_stripping"], "contains_exfiltration"),

    # Phishing / fraud / IVTS / informal value transfer
    (["phish", "fraud", "fake_invoice", "lookalike", "ivts",
      "informal_value", "hawala", "money_launder"], "contains_phishing_patterns"),

    # System commands / tampering / disabling controls
    (["tamper", "disable", "bypass_network", "system_command", "sudo",
      "exec", "shell", "alter_log", "log_tampering", "audit_trail",
      "intrusion_detection", "vulnerability_scan", "database_quer",
      "direct_query"], "contains_system_commands"),

    # Obfuscation / encoding
    (["obfuscat", "encod", "base64", "cipher", "obfuscation"], "contains_obfuscation"),

    # Role / authority impersonation
    (["role_impersonat", "authority_impersonat", "cfo", "ceo",
      "executive", "impersonat"], "contains_role_impersonation"),

    # Harm / malware / exploits
    (["malware", "exploit", "ransomware", "harm", "weapon"], "contains_malware_request"),

    # Firewall / network access (system administration)
    (["firewall", "network_access", "public_access", "direct_public",
      "untrusted_network"], "contains_system_commands"),

    # Physical media / unsecured media
    (["media", "physical_access", "unsecured_media"], "contains_system_commands"),
]

# ---------------------------------------------------------------------------
# Priority table: (severity, action) → base priority
# Critical rules are in the 90s, high in the 70s, etc.
# PCI DSS rules get +5 over FFIEC for same severity (more specific).
# ---------------------------------------------------------------------------
_PRIORITY_BASE: dict[tuple[str, str], int] = {
    ("critical", "deny"):  93,
    ("critical", "audit"): 60,
    ("high",     "deny"):  73,
    ("high",     "audit"): 50,
    ("medium",   "deny"):  53,
    ("medium",   "audit"): 40,
    ("low",      "deny"):  33,
    ("low",      "audit"): 20,
}

# FFIEC rules are broader guidance — slightly lower priority than PCI
_DOC_TYPE_OFFSET: dict[str, int] = {
    "pci_dss": 2,
    "ffiec":   0,
    "generic": 0,
}

# ---------------------------------------------------------------------------
# Egress rule candidates: rule names whose primary risk is in the LLM OUTPUT
# (model revealing sensitive data) rather than the incoming prompt.
# ---------------------------------------------------------------------------
_EGRESS_RULE_NAMES = {
    "prevent_full_pan_display",
    "prevent_unencrypted_pan_logging",
    "prohibit_storage_of_cvv",
    "prohibit_storage_of_pin",
    "prohibit_storage_of_track_data",
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _pick_condition(rule: PolicyRule) -> dict[str, Any]:
    """
    Return the best Lobster Trap match condition for a PolicyRule.

    Two-pass strategy:
      1. Check rule NAME only — the snake_case name is a precise semantic tag.
         This avoids false hits where a description mentions broad terms like
         "cardholder data" inside a rule about system access.
      2. Fall back to full text (name + description) if name gives no match.
    Falls back to risk_score threshold calibrated to severity.
    """
    name_only = rule.name.lower()
    full_text = name_only + " " + rule.description.lower()

    for needle in (name_only, full_text):
        for keywords, field in _FIELD_MAP:
            if any(kw in needle for kw in keywords):
                return {"field": field, "match_type": "boolean", "value": True}

    # Wire transfer / FFIEC rules that didn't match above
    if rule.metadata.get("doc_type") == "ffiec":
        return {"field": "contains_pii_request", "match_type": "boolean", "value": True}

    # Generic fallback: risk_score threshold scaled by severity
    thresholds = {"critical": 0.5, "high": 0.55, "medium": 0.6, "low": 0.65}
    return {
        "field": "risk_score",
        "match_type": "threshold",
        "value": thresholds.get(rule.severity, 0.6),
    }


def _maybe_extra_condition(rule: PolicyRule, primary: dict) -> dict | None:
    """
    Add a risk_score threshold as a second AND-condition for critical rules
    where the primary boolean field is broad (pii, credentials).

    This reduces false positives on benign messages that happen to mention
    a card number in an educational context.
    """
    if rule.severity != "critical":
        return None
    if primary["field"] == "risk_score":
        return None
    # Only add when primary is pii/credentials — those are broad
    if primary["field"] not in ("contains_pii", "contains_credentials",
                                "contains_pii_request"):
        return None
    return {"field": "risk_score", "match_type": "threshold", "value": 0.4}


def _build_deny_message(rule: PolicyRule) -> str:
    """Build a regulator-readable deny message with clause traceability."""
    clause_ref = ""
    if rule.source_clauses:
        sc = rule.source_clauses[0]
        clause_ref = f" [{sc.source_doc} §{sc.section}]"
    return f"[REGULAFORGE] BLOCKED: {rule.description}.{clause_ref}"


def _priority(rule: PolicyRule, index: int) -> int:
    """Compute final priority: base + doc_type offset - tie-break by index."""
    action_key = rule.action.value  # "deny" | "audit" | "allow"
    base = _PRIORITY_BASE.get((rule.severity, action_key), 25)
    doc_type = rule.metadata.get("doc_type", "generic")
    offset = _DOC_TYPE_OFFSET.get(doc_type, 0)
    # Subtract small index value so earlier rules (more specific) rank higher
    return base + offset - (index % 10)


def _lt_action(rule: PolicyRule) -> str:
    """Map RuleAction to Lobster Trap action string."""
    return {
        RuleAction.DENY:         "DENY",
        RuleAction.AUDIT:        "LOG",
        RuleAction.ALLOW:        "ALLOW",
        RuleAction.HUMAN_REVIEW: "LOG",
    }.get(rule.action, "LOG")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def rule_to_lobster_dict(rule: PolicyRule, index: int = 0) -> dict[str, Any]:
    """
    Convert a single PolicyRule to a Lobster Trap rule dict.

    Args:
        rule:  Extracted compliance rule.
        index: Position in the rule list (used for priority tie-breaking).

    Returns:
        Dict matching the Lobster Trap GuardRule schema.
    """
    primary = _pick_condition(rule)
    extra = _maybe_extra_condition(rule, primary)

    conditions = [primary]
    if extra:
        conditions.append(extra)

    lt_rule: dict[str, Any] = {
        "name": rule.name,
        "description": rule.description,
        "priority": _priority(rule, index),
        "action": _lt_action(rule),
        "conditions": conditions,
    }

    if rule.action == RuleAction.DENY:
        lt_rule["deny_message"] = _build_deny_message(rule)

    return lt_rule


def compile_to_lobster_trap(
    result: ExtractionResult,
    policy_name: str | None = None,
) -> str:
    """
    Convert an ExtractionResult into a Lobster Trap policy YAML string.

    Splits rules into ingress_rules (prompt evaluation) and egress_rules
    (LLM output evaluation). Assigns priorities by severity and doc_type.
    Adds rate limits and filesystem deny-list appropriate for a finance agent.

    Args:
        result:      Structured extraction result from extractor.py.
        policy_name: Override for the policy_name field (defaults to policy_id).

    Returns:
        YAML string ready to be written to disk and loaded by
        LobsterTrapManager.reload_policy().
    """
    ingress: list[dict] = []
    egress: list[dict] = []

    for idx, rule in enumerate(result.rules):
        lt = rule_to_lobster_dict(rule, idx)
        if rule.name in _EGRESS_RULE_NAMES:
            egress.append(lt)
        else:
            ingress.append(lt)

    # Sort by descending priority so the YAML is readable top-to-bottom
    ingress.sort(key=lambda r: r["priority"], reverse=True)
    egress.sort(key=lambda r: r["priority"], reverse=True)

    # Sensible finance-agent rate limits (conservative)
    rate_limits = {
        "requests_per_minute": 60,
        "requests_per_hour": 500,
        "burst_threshold": 10,
    }

    # Finance agent should never touch system paths
    filesystem = {
        "denied_paths": [
            "/etc/**", "/root/**", "**/.ssh/**", "**/.env",
            "**/*secret*", "**/*password*", "**/*credential*",
        ]
    }

    policy: dict[str, Any] = {
        "version": "1.0",
        "policy_name": policy_name or result.policy_id,
        "default_action": "ALLOW",
        "ingress_rules": ingress,
        "egress_rules": egress,
        "rate_limits": rate_limits,
        "filesystem": filesystem,
    }

    # yaml.dump with custom settings: readable block style, preserved key order
    return yaml.dump(
        policy,
        default_flow_style=False,
        sort_keys=False,
        allow_unicode=True,
        width=100,
    )


def compile_combined(
    pci_result: ExtractionResult,
    ffiec_result: ExtractionResult,
) -> str:
    """
    Merge PCI DSS and FFIEC rules into a single combined enforcement pack.

    Deduplicates by rule name. PCI DSS rules take priority in conflicts.
    Used to produce the 'finance_combined' policy pack for the demo.

    Args:
        pci_result:   ExtractionResult from PCI DSS PDF.
        ffiec_result: ExtractionResult from FFIEC PDF.

    Returns:
        Combined Lobster Trap YAML string.
    """
    seen: set[str] = set()
    merged_rules: list[PolicyRule] = []

    for rule in pci_result.rules:
        seen.add(rule.name)
        merged_rules.append(rule)

    for rule in ffiec_result.rules:
        if rule.name not in seen:
            seen.add(rule.name)
            merged_rules.append(rule)

    from .schemas import ExtractionResult as ER
    from datetime import datetime, timezone

    combined = ER(
        policy_id="finance-combined",
        source_document=f"{pci_result.source_document} + {ffiec_result.source_document}",
        rules=merged_rules,
        extracted_at=datetime.now(timezone.utc).isoformat(),
    )

    return compile_to_lobster_trap(combined, policy_name="finance_combined")
