import httpx, asyncio, time

async def t():
    print("=== Direct to FastAPI port 8000 ===")
    for i in range(5):
        async with httpx.AsyncClient(timeout=3.0) as c:
            t0 = time.monotonic()
            try:
                r = await c.post("http://127.0.0.1:8000/v1/chat/completions",
                    json={"model":"t","messages":[{"role":"user","content":"hi"}]})
                print(f"  {i}: {r.status_code} {(time.monotonic()-t0)*1000:.0f}ms")
            except Exception as e:
                print(f"  {i}: ERR {type(e).__name__}")

    print("=== Via Lobster Trap port 8080 ===")
    for i in range(5):
        async with httpx.AsyncClient(timeout=5.0) as c:
            t0 = time.monotonic()
            try:
                r = await c.post("http://127.0.0.1:8080/v1/chat/completions",
                    json={"model":"t","messages":[{"role":"user","content":"hello world"}]})
                print(f"  {i}: {r.status_code} {(time.monotonic()-t0)*1000:.0f}ms")
            except Exception as e:
                print(f"  {i}: ERR {type(e).__name__} {(time.monotonic()-t0)*1000:.0f}ms")

asyncio.run(t())
