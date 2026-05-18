"""Quick test of Vertex AI key"""
import os, sys, asyncio
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / "backend" / ".env")

from google import genai
from google.genai import types

api_key = os.getenv("VERTEX_AI_API_KEY", "")
print(f"Key prefix: {api_key[:12]}...")

PROJECT = "126532739664"  # derived from API key's GCP project

async def test():
    # Try 1: Vertex AI with project + api_key + us-central1
    for location in ["us-central1", "us-east4", "europe-west4"]:
        try:
            client = genai.Client(
                vertexai=True,
                project=PROJECT,
                location=location,
                api_key=api_key,
            )
            resp = await client.aio.models.generate_content(
                model="gemini-2.5-pro",
                contents=[types.Content(role="user", parts=[types.Part(text="Say hi in 3 words.")])],
            )
            print(f"[vertexai project={PROJECT} location={location}] OK: {resp.text}")
            return
        except Exception as e:
            print(f"[vertexai location={location}] FAIL: {str(e)[:150]}")

    # Try 2: vertexai=True, api_key only (Express mode)
    try:
        client2 = genai.Client(
            vertexai=True,
            api_key=api_key,
        )
        resp2 = await client2.aio.models.generate_content(
            model="gemini-2.5-pro",
            contents=[types.Content(role="user", parts=[types.Part(text="Say hi in 3 words.")])],
        )
        print(f"[vertexai express] OK: {resp2.text}")
    except Exception as e:
        print(f"[vertexai express] FAIL: {str(e)[:150]}")

asyncio.run(test())
