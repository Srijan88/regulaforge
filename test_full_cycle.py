"""Full end-to-end test: Red Team -> Heal -> Apply -> Red Team again"""
import asyncio, json, httpx

BASE = "http://localhost:8000"

async def run_redteam(label: str) -> tuple[str, dict]:
    print(f"\n=== {label} ===")
    verdicts = []
    summary = None
    async with httpx.AsyncClient(timeout=180) as client:
        async with client.stream("GET", f"{BASE}/redteam/run/finance-combined?use_huggingface=false") as r:
            buf = ""
            async for chunk in r.aiter_text():
                buf += chunk
                while "\n\n" in buf:
                    event, buf = buf.split("\n\n", 1)
                    for line in event.splitlines():
                        if line.startswith("data: "):
                            d = json.loads(line[6:])
                            if d["type"] == "verdict":
                                verdicts.append(d["data"])
                                v = d["data"]
                                status = "PASS" if v["passed"] else "FAIL"
                                verdict = str(v["verdict"]).replace("RuleAction.","")
                                print(f"  [{status}] {v['attack_id']}: got={verdict}")
                            elif d["type"] == "summary":
                                summary = d
                                return summary["run_id"], summary["data"]
                            elif d["type"] == "error":
                                print("  ERROR:", d["message"])
                                return "", {}
    return "", {}

async def run_heal(run_id: str) -> bool:
    print(f"\n=== HEAL {run_id} ===")
    async with httpx.AsyncClient(timeout=180) as client:
        r = await client.post(f"{BASE}/heal/run/{run_id}")
        if r.status_code != 200:
            print(f"  FAIL: {r.status_code} {r.text[:300]}")
            return False
        h = r.json()
        print(f"  new_rule_count   : {h['new_rule_count']}")
        print(f"  attacks_covered  : {len(h['addresses_attacks'])}")
        print(f"  regression_passed: {h['regression_passed']}")
        print(f"  reasoning        : {h['reasoning'][:250]}")
        for rd in h.get("rule_details", []):
            print(f"    [{rd['action']}] {rd['name']}  cond={rd['condition']}")

        print(f"\n=== APPLY {run_id} ===")
        r2 = await client.post(f"{BASE}/heal/apply/{run_id}")
        if r2.status_code != 200:
            print(f"  FAIL: {r2.status_code} {r2.text[:200]}")
            return False
        a = r2.json()
        print(f"  applied        : {a.get('applied')}")
        print(f"  new_rule_count : {a.get('new_rule_count')}")
        return True

async def main():
    # Step 1: Baseline red team
    run_id, s1 = await run_redteam("RED TEAM RUN 1 (baseline)")
    if not run_id:
        print("Red team failed"); return
    print(f"\n  BASELINE -> total={s1['total_attacks']} passed={s1['passed']} failed={s1['failed']} pass_rate={s1['pass_rate']}%")

    # Step 2: Heal + Apply
    ok = await run_heal(run_id)
    if not ok:
        print("Heal failed"); return

    # Small pause for Lobster Trap to restart
    print("\n  Waiting 5s for Lobster Trap to reload...")
    await asyncio.sleep(5)

    # Step 3: Re-run red team with patched policy
    _, s2 = await run_redteam("RED TEAM RUN 2 (after heal)")
    if not s2:
        print("Second red team failed"); return
    print(f"\n  AFTER HEAL -> total={s2['total_attacks']} passed={s2['passed']} failed={s2['failed']} pass_rate={s2['pass_rate']}%")

    # Delta
    delta = s2['pass_rate'] - s1['pass_rate']
    print(f"\n  IMPROVEMENT: {s1['pass_rate']}% -> {s2['pass_rate']}%  (delta={delta:+.1f}%)")

asyncio.run(main())
