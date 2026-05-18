from __future__ import annotations

from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


class RuleAction(str, Enum):
    ALLOW = "allow"
    DENY = "deny"
    AUDIT = "audit"
    HUMAN_REVIEW = "human_review"
    ERROR = "error"


class ComplianceClause(BaseModel):
    source_doc: str
    section: str
    page: int
    text: str


class PolicyRule(BaseModel):
    id: str
    name: str
    description: str
    action: RuleAction
    pattern: str
    severity: str = Field(default="high")
    source_clauses: list[ComplianceClause] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)


class ExtractionResult(BaseModel):
    policy_id: str
    source_document: str
    rules: list[PolicyRule]
    extracted_at: str


class AttackCategory(str, Enum):
    VENDOR_FRAUD = "vendor_fraud"
    PCI_DATA_LEAK = "pci_data_leak"
    WIRE_TRANSFER_BYPASS = "wire_transfer_bypass"
    SANCTIONED_JURISDICTION = "sanctioned_jurisdiction"
    INDIRECT_PROMPT_INJECTION = "indirect_prompt_injection"
    CREDENTIAL_EXFILTRATION = "credential_exfiltration"
    AUTHORITY_IMPERSONATION = "authority_impersonation"
    SAFE_BASELINE = "safe_baseline"


class AttackScenario(BaseModel):
    id: str
    category: AttackCategory
    prompt: str
    expected_verdict: RuleAction
    description: str
    is_generated: bool = False


class SimulationVerdict(BaseModel):
    attack_id: str
    prompt: str
    verdict: RuleAction
    expected: RuleAction
    passed: bool
    matched_rule: Optional[str] = None
    lobster_trap_response: dict = Field(default_factory=dict)
    latency_ms: float = 0.0
    enforced_by: str = "lobster_trap"   # "lobster_trap" | "gemini_semantic_layer"
    risk_score: float = 0.0
    category: Optional[str] = None
    category_label: Optional[str] = None


class HealPatch(BaseModel):
    rule_id: str
    original_yaml: str
    patched_yaml: str
    diff: str
    gemini_reasoning: str
    regression_passed: bool
    regression_results: list[SimulationVerdict] = Field(default_factory=list)


class RunSummary(BaseModel):
    run_id: str
    policy_id: str
    total_attacks: int
    passed: int
    failed: int
    pass_rate: float
    created_at: str


class AuditReport(BaseModel):
    run_id: str
    policy_id: str
    source_document: str
    summary: RunSummary
    rules: list[PolicyRule]
    verdicts: list[SimulationVerdict]
    patches: list[HealPatch]
    generated_at: str
