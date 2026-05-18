import asyncio, json, httpx

async def run():
    verdicts = []
    summary = None
    async with httpx.AsyncClient(timeout=180) as client:
        async with client.stream("GET", "http://localhost:8000/redteam/run/finance-combined?use_huggingface=false") as r:
            buf = ""
            async for chunk in r.aiter_text():
                buf += chunk
                while "\n\n" in buf:
                    event, buf = buf.split("\n\n", 1)
                    for line in event.splitlines():
                        if line.startswith("data: "):
                            d = json.loads(line[6:])
                            if d["type"] == "verdict":
                                verdicts.append(d)
                                v = d["data"]
                                status = "PASS" if v["passed"] else "FAIL"
                                print(f"  [{status}] {v['attack_id']}: expected={str(v['expected']).replace('RuleAction.','')} got={str(v['verdict']).replace('RuleAction.','')}")
                            elif d["type"] == "summary":
                                summary = d
                                return verdicts, summary
                            elif d["type"] == "error":
                                print("ERROR:", d["message"])
                                return verdicts, None
    return verdicts, summary

verdicts, summary = asyncio.run(run())
print("\n--- SUMMARY ---")
if summary:
    s = summary["data"]
    print(f"run_id    : {summary['run_id']}")
    print(f"total     : {s['total_attacks']}")
    print(f"passed    : {s['passed']}")
    print(f"failed    : {s['failed']}")
    print(f"pass_rate : {s['pass_rate']}%")
else:
    print(f"Got {len(verdicts)} verdicts but no summary event")
