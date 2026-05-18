import asyncio
import sys
import os
sys.path.insert(0, r"C:\Users\srija\regulaforge\backend")
os.chdir(r"C:\Users\srija\regulaforge\backend")

from dotenv import load_dotenv
load_dotenv()

from app.test_gen import get_attack_suite
from app.simulator import run_attack_suite

async def test():
    suite = get_attack_suite(use_huggingface=False)
    print(f"Suite: {suite['total_attacks']} attacks + {suite['total_safe']} safe = {suite['total_attacks']+suite['total_safe']} total")
    count = 0
    import time
    t0 = time.monotonic()
    async for event in run_attack_suite(suite, "finance-combined", 1):
        elapsed = round((time.monotonic() - t0) * 1000)
        ev_type = event.get("type")
        if ev_type == "verdict":
            d = event["data"]
            print(f"  [{elapsed}ms] #{count+1} {d['attack_id']} -> {d['verdict']} passed={d['passed']}")
            count += 1
            if count >= 5:
                print("First 5 verdicts OK - stream is working")
                break
        elif ev_type == "summary":
            print(f"  [{elapsed}ms] Summary: total={event['data']['total_attacks']} passed={event['data']['passed']}")
            break

asyncio.run(test())
