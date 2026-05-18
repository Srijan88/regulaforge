import asyncio, json, httpx, sys

RUN_ID = "run-22254f0b"

async def main():
    async with httpx.AsyncClient(timeout=120) as client:
        print(f"=== Step 3: HEAL run_id={RUN_ID} ===")
        r = await client.post(f"http://localhost:8000/heal/run/{RUN_ID}")
        if r.status_code != 200:
            print(f"FAIL: {r.status_code} {r.text[:300]}")
            return
        h = r.json()
        print(f"new_rule_count   : {h['new_rule_count']}")
        print(f"attacks_covered  : {len(h['addresses_attacks'])}")
        print(f"regression_passed: {h['regression_passed']}")
        print(f"reasoning        : {h['reasoning'][:200]}")
        print()
        for r2 in h.get("rule_details", []):
            print(f"  [{r2['action']}] {r2['name']}  condition={r2['condition']}")

        print()
        print("=== Step 4: APPLY patch ===")
        r2 = await client.post(f"http://localhost:8000/heal/apply/{RUN_ID}")
        if r2.status_code != 200:
            print(f"FAIL: {r2.status_code} {r2.text[:200]}")
            return
        a = r2.json()
        print(f"applied          : {a.get('applied')}")
        print(f"new_rule_count   : {a.get('new_rule_count')}")

asyncio.run(main())
