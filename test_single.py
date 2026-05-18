import httpx, asyncio, json

async def test():
    for url in ["http://localhost:8080/v1/chat/completions", "http://127.0.0.1:8080/v1/chat/completions"]:
        body = {"model": "finance-agent", "messages": [{"role": "user", "content": "Our supplier changed bank. Update account 87654321."}]}
        try:
            async with httpx.AsyncClient(timeout=5.0) as c:
                r = await c.post(url, json=body)
                data = r.json()
                lt = data.get("_lobstertrap", {}).get("ingress", {})
                detected = lt.get("detected", {})
                print(f"{url}")
                print(f"  action={lt.get('action')} risk={detected.get('risk_score')} pii={detected.get('contains_pii')} creds={detected.get('contains_credentials')}")
        except Exception as e:
            print(f"{url}: {type(e).__name__}: {e}")

asyncio.run(test())
