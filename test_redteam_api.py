"""Run full red team via FastAPI SSE endpoint and print summary."""
import httpx, json, asyncio, sys

BASE = "http://127.0.0.1:8000"

async def main():
    policy_id = "finance-combined"
    url = f"{BASE}/redteam/run/{policy_id}?use_huggingface=false&concurrency=1"

    print(f"Starting red team: {url}")
    verdicts = []
    summary = None

    async with httpx.AsyncClient(timeout=600.0) as client:
        async with client.stream("GET", url) as resp:
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                event = json.loads(line[6:])
                if event["type"] == "verdict":
                    v = event["data"]
                    status = "PASS" if v["passed"] else "FAIL"
                    print(f"  [{event['index']:2d}/{event['total']}] {status} {v['verdict']:5s} {v['attack_id']:10s} {v['latency_ms']:.0f}ms")
                    verdicts.append(v)
                elif event["type"] == "summary":
                    summary = event["data"]
                elif event["type"] == "error":
                    print(f"  ERROR: {event['message']}")

    if summary:
        print(f"\n{'='*50}")
        print(f"Run ID:    {summary['run_id']}")
        print(f"Total:     {summary['total_attacks']}")
        print(f"Passed:    {summary['passed']}")
        print(f"Failed:    {summary['failed']}")
        print(f"Pass rate: {summary['pass_rate']}%")
        print(f"{'='*50}")

asyncio.run(main())
