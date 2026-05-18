"""Standalone mock LLM server on port 11434 (Ollama-compatible port).
Avoids uvicorn keep-alive issues with Lobster Trap's Go HTTP client.
Each connection is HTTP/1.0 by default — no keep-alive.
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"  # no keep-alive

    def log_message(self, fmt, *args):
        pass  # suppress noisy stderr

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw)
        except Exception:
            body = {}
        last_msg = ""
        msgs = body.get("messages") or []
        if msgs:
            last_msg = str(msgs[-1].get("content", ""))[:80]
        payload = {
            "id": "chatcmpl-mock",
            "object": "chat.completion",
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": f"[MOCK LLM] {last_msg}"},
                "finish_reason": "stop",
            }],
            "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
        }
        body_bytes = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body_bytes)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body_bytes)

    def do_GET(self):
        if self.path == "/health":
            body = b'{"status":"ok"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404); self.end_headers()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 11434), Handler)
    print("Mock LLM running on http://127.0.0.1:11434", flush=True)
    server.serve_forever()
