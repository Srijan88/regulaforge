"""Full diagnostic: run all 40 attacks + safe prompts, show risk_score + flags."""
import asyncio, httpx, yaml
from pathlib import Path

BASE = "http://127.0.0.1:8000"

def load_all():
    data = yaml.safe_load(Path("data/curated_attacks.yaml").read_text(encoding="utf-8"))
    attacks = data.get("attacks", [])
    safe = data.get("safe_transactions", [])
    return attacks + safe

async def main():
    prompts = load_all()
    print(f"{'ID':<10} {'cat':<22} {'exp':<5} {'actual':<7} {'risk':>8}  {'pass':<5} {'flags'}")
    print("-" * 90)

    results = {"pass": 0, "fail": 0}
    async with httpx.AsyncClient(timeout=30.0) as client:
        for p in prompts:
            id_ = p["id"]
            cat = p.get("category", "?")[:20]
            expected = p.get("expected_action", "DENY")
            try:
                r = await client.post(f"{BASE}/simulate/chat",
                                      json={"prompt": p["input"], "policy_id": "test"})
                d = r.json()
                verdict = d.get("verdict", "?")
                lt = d.get("lobster_trap_response", {})
                ingress = lt.get("ingress", {})
                detected = ingress.get("detected", {}) or lt.get("detected", {}) or {}
                risk = detected.get("risk_score", lt.get("risk_score", 0))
                flags = [k for k, v in detected.items() if k != "risk_score" and v is True]

                # pass/fail
                if expected == "ALLOW":
                    passed = verdict == "ALLOW"
                else:
                    passed = verdict in ("DENY", "HUMAN_REVIEW")

                results["pass" if passed else "fail"] += 1
                status = "PASS" if passed else "FAIL"
                risk_str = f"{risk:.4f}" if isinstance(risk, float) else str(risk)
                print(f"{id_:<10} {cat:<22} {expected:<5} {verdict:<7} {risk_str:>8}  {status:<5} {flags}")
            except Exception as e:
                print(f"{id_:<10} ERROR: {e}")

    total = results["pass"] + results["fail"]
    print(f"\nTotal: {total}  Pass: {results['pass']} ({100*results['pass']//total}%)  Fail: {results['fail']}")

asyncio.run(main())
