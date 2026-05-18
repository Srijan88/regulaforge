from __future__ import annotations

import io
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

from . import simulator as _sim
from . import healer as _healer

# ---------------------------------------------------------------------------
# Colour palette
# ---------------------------------------------------------------------------
BLUE    = colors.HexColor("#1a3a6e")
GREEN   = colors.HexColor("#1a7a45")
RED     = colors.HexColor("#c0392b")
LGREY   = colors.HexColor("#f4f6fa")
DGREY   = colors.HexColor("#555555")
BORDER  = colors.HexColor("#c8d6e8")


def build_report_data(run_id: str) -> dict:
    run = _sim.get_run(run_id)
    if not run:
        raise KeyError(f"Run '{run_id}' not found")

    summary  = run.get("summary", {})
    verdicts = run.get("verdicts", [])
    heal     = _healer.get_heal(run_id) or {}

    passed = [v for v in verdicts if v.get("passed")]
    failed = [v for v in verdicts if not v.get("passed")]

    categories: dict[str, dict] = {}
    for v in verdicts:
        cat = v.get("attack_id", "?").split("-")[0]
        b = categories.setdefault(cat, {"total": 0, "passed": 0, "failed": 0})
        b["total"] += 1
        if v.get("passed"):
            b["passed"] += 1
        else:
            b["failed"] += 1

    return dict(
        run_id=run_id,
        policy_id=summary.get("policy_id", "finance-combined"),
        generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        summary=summary,
        verdicts=verdicts,
        passed=passed,
        failed=failed,
        categories=categories,
        heal=heal,
        has_heal=bool(heal),
    )


# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------

def _styles():
    base = getSampleStyleSheet()
    s = {}
    s["title"] = ParagraphStyle("title", fontSize=20, textColor=BLUE,
                                 spaceAfter=4, fontName="Helvetica-Bold")
    s["meta"]  = ParagraphStyle("meta",  fontSize=9,  textColor=DGREY, spaceAfter=12)
    s["h2"]    = ParagraphStyle("h2",    fontSize=13, textColor=BLUE,
                                 spaceBefore=18, spaceAfter=6, fontName="Helvetica-Bold")
    s["body"]  = ParagraphStyle("body",  fontSize=9,  textColor=colors.black, spaceAfter=4)
    s["small"] = ParagraphStyle("small", fontSize=8,  textColor=DGREY)
    s["mono"]  = ParagraphStyle("mono",  fontSize=8,  fontName="Courier",
                                 backColor=LGREY, leftIndent=6, rightIndent=6,
                                 spaceAfter=4)
    return s


# ---------------------------------------------------------------------------
# Table helpers
# ---------------------------------------------------------------------------

_TBL_HEADER = TableStyle([
    ("BACKGROUND",  (0,0), (-1,0), BLUE),
    ("TEXTCOLOR",   (0,0), (-1,0), colors.white),
    ("FONTNAME",    (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE",    (0,0), (-1,0), 8),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, LGREY]),
    ("FONTSIZE",    (0,1), (-1,-1), 8),
    ("GRID",        (0,0), (-1,-1), 0.4, BORDER),
    ("LEFTPADDING", (0,0), (-1,-1), 6),
    ("RIGHTPADDING",(0,0), (-1,-1), 6),
    ("TOPPADDING",  (0,0), (-1,-1), 4),
    ("BOTTOMPADDING",(0,0), (-1,-1), 4),
    ("VALIGN",      (0,0), (-1,-1), "TOP"),
])


def _verdict_str(v: dict, key: str) -> str:
    return str(v.get(key, "")).replace("RuleAction.", "").upper()


# ---------------------------------------------------------------------------
# PDF build
# ---------------------------------------------------------------------------

async def generate_report(run_id: str) -> bytes:
    data = build_report_data(run_id)
    s    = _styles()
    buf  = io.BytesIO()
    W, H = A4

    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=2*cm,  bottomMargin=2*cm,
    )

    story = []

    # ── Title ──────────────────────────────────────────────────────────────
    story.append(Paragraph("RegulaForge Compliance Audit Report", s["title"]))
    story.append(Paragraph(
        f"Run ID: <b>{data['run_id']}</b> &nbsp;|&nbsp; "
        f"Policy: <b>{data['policy_id']}</b> &nbsp;|&nbsp; "
        f"Generated: <b>{data['generated_at']}</b>",
        s["meta"],
    ))
    story.append(HRFlowable(width="100%", thickness=1, color=BORDER))
    story.append(Spacer(1, 8))

    # ── Summary stats ──────────────────────────────────────────────────────
    sm = data["summary"]
    stats_data = [
        ["Total Attacks", "Passed", "Failed", "Pass Rate"],
        [
            str(sm.get("total_attacks", 0)),
            str(sm.get("passed", 0)),
            str(sm.get("failed", 0)),
            f"{sm.get('pass_rate', 0)}%",
        ],
    ]
    stats_tbl = Table(stats_data, colWidths=[(W - 4*cm)/4]*4)
    stats_tbl.setStyle(TableStyle([
        ("BACKGROUND",  (0,0), (-1,0), BLUE),
        ("TEXTCOLOR",   (0,0), (-1,0), colors.white),
        ("FONTNAME",    (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE",    (0,0), (-1,0), 9),
        ("FONTNAME",    (0,1), (-1,1), "Helvetica-Bold"),
        ("FONTSIZE",    (0,1), (-1,1), 18),
        ("TEXTCOLOR",   (1,1), (1,1), GREEN),
        ("TEXTCOLOR",   (2,1), (2,1), RED),
        ("ALIGN",       (0,0), (-1,-1), "CENTER"),
        ("GRID",        (0,0), (-1,-1), 0.4, BORDER),
        ("TOPPADDING",  (0,1), (-1,-1), 10),
        ("BOTTOMPADDING",(0,1), (-1,-1), 10),
    ]))
    story.append(stats_tbl)
    story.append(Spacer(1, 12))

    # ── Category breakdown ─────────────────────────────────────────────────
    if data["categories"]:
        story.append(Paragraph("Results by Category", s["h2"]))
        rows = [["Category", "Total", "Passed", "Failed", "Pass Rate"]]
        for cat, c in data["categories"].items():
            pct = int(c["passed"]/c["total"]*100) if c["total"] else 0
            rows.append([cat, c["total"], c["passed"], c["failed"], f"{pct}%"])
        cat_tbl = Table(rows, colWidths=[6*cm, 2*cm, 2*cm, 2*cm, 2.5*cm])
        cat_tbl.setStyle(_TBL_HEADER)
        story.append(cat_tbl)
        story.append(Spacer(1, 8))

    # ── Failed attacks ─────────────────────────────────────────────────────
    if data["failed"]:
        story.append(Paragraph(f"Failed Attacks ({len(data['failed'])})", s["h2"]))
        rows = [["ID", "Prompt", "Expected", "Got"]]
        for v in data["failed"]:
            prompt = v.get("prompt", "")[:80] + ("…" if len(v.get("prompt","")) > 80 else "")
            rows.append([
                v.get("attack_id", ""),
                prompt,
                _verdict_str(v, "expected"),
                _verdict_str(v, "verdict"),
            ])
        col_w = W - 4*cm
        fail_tbl = Table(rows, colWidths=[2*cm, col_w-7*cm, 2.5*cm, 2.5*cm])
        fail_tbl.setStyle(_TBL_HEADER)
        story.append(fail_tbl)
        story.append(Spacer(1, 8))

    # ── Passed attacks ─────────────────────────────────────────────────────
    if data["passed"]:
        story.append(Paragraph(f"Passed Attacks ({len(data['passed'])})", s["h2"]))
        rows = [["ID", "Prompt", "Verdict", "Matched Rule"]]
        for v in data["passed"]:
            prompt = v.get("prompt", "")[:75] + ("…" if len(v.get("prompt","")) > 75 else "")
            rows.append([
                v.get("attack_id", ""),
                prompt,
                _verdict_str(v, "verdict"),
                v.get("matched_rule") or "—",
            ])
        col_w = W - 4*cm
        pass_tbl = Table(rows, colWidths=[2*cm, col_w-7.5*cm, 2.5*cm, 3*cm])
        pass_tbl.setStyle(_TBL_HEADER)
        story.append(pass_tbl)
        story.append(Spacer(1, 8))

    # ── Heal patch ─────────────────────────────────────────────────────────
    if data["has_heal"]:
        h = data["heal"]
        story.append(Paragraph("Gemini Heal Patch", s["h2"]))
        reg = "PASS" if h.get("regression_passed") else "FAIL"
        story.append(Paragraph(
            f"<b>{h.get('new_rule_count', 0)} new rules generated</b> — "
            f"Regression: <b>{reg}</b> — "
            f"Attacks covered: {len(h.get('addresses_attacks', []))}",
            s["body"],
        ))
        story.append(Paragraph(h.get("reasoning", ""), s["body"]))
        if h.get("diff_yaml"):
            for line in h["diff_yaml"].splitlines()[:40]:
                story.append(Paragraph(line or " ", s["mono"]))

    # ── Footer ─────────────────────────────────────────────────────────────
    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER))
    story.append(Paragraph(
        "Generated by RegulaForge &nbsp;|&nbsp; lablab.ai Hackathon 2026",
        s["small"],
    ))

    doc.build(story)
    return buf.getvalue()
