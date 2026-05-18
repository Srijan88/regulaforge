"""
Shared utilities for the RegulaForge backend.
"""
import os
from dotenv import load_dotenv

load_dotenv()


def get_gemini_client():
    """
    Return a google.genai.Client using Vertex AI Express mode (AQ. API key).
    Forcefully removes GOOGLE_APPLICATION_CREDENTIALS so ADC never interferes.
    AQ. key is region-locked to asia-southeast1; use gemini-2.5-flash (available there).
    """
    from google import genai

    # Remove ADC env var — if set to whitespace it causes DefaultCredentialsError
    os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)

    api_key = os.getenv("VERTEX_AI_API_KEY", "")
    if not api_key:
        raise ValueError("VERTEX_AI_API_KEY not set in backend/.env")

    return genai.Client(vertexai=True, api_key=api_key)
