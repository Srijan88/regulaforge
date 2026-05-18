"""
Shared utilities for the RegulaForge backend.
"""
import os
from dotenv import load_dotenv

load_dotenv()


def get_gemini_client():
    from google import genai

    os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("VERTEX_AI_API_KEY", "")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not set")

    return genai.Client(api_key=api_key)
