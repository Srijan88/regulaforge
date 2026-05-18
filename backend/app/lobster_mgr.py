from __future__ import annotations

"""
lobster_mgr.py — Single chokepoint for all Lobster Trap subprocess interactions.

All simulator, healer, and red-team code must go through this module.
No scattered subprocess calls or direct httpx calls to Lobster Trap elsewhere.

Architecture notes:
  - Policy reload on Windows = stop + restart (no SIGHUP available).
  - Audit log is tailed from a file; --audit-log path must be specified at startup.
  - proxy_request handles ConnectError gracefully: if Lobster Trap passes a prompt
    through but the backend LLM is unavailable, we treat it as ALLOW verdict.
"""

import asyncio
import json
import os
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from typing import AsyncIterator, Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Configuration (from .env)
# ---------------------------------------------------------------------------

_BINARY_PATH = Path(os.getenv("LOBSTER_TRAP_PATH", "../lobstertrap.exe"))
_PORT = int(os.getenv("LOBSTER_TRAP_PORT", "8080"))
_AUDIT_LOG = Path(__file__).parent / "audit.jsonl"
_DEFAULT_POLICY = Path(__file__).parents[2] / "policies" / "finance_combined_policy.yaml"


# ---------------------------------------------------------------------------
# Manager
# ---------------------------------------------------------------------------

class LobsterTrapManager:
    """
    Single chokepoint for all Lobster Trap subprocess interactions.

    Lifecycle:
      manager.start()                  — launch process with policy
      await manager.proxy_request(...) — evaluate a prompt
      manager.reload_policy(yaml_str)  — swap policy (stop + restart)
      async for e in manager.tail_audit_log(): ...  — live event stream
      manager.stop()                   — terminate process

    Use the module-level `manager` singleton in all routers.
    """

    # Restart LT every N proxy requests to prevent goroutine wedge on Windows
    _RESTART_EVERY = 25

    def __init__(self) -> None:
        self._process: Optional[subprocess.Popen] = None
        self._policy_path: Optional[Path] = None
        self._tmp_policy: Optional[Path] = None   # temp file from reload_policy
        self._base_url = f"http://localhost:{_PORT}"
        self._audit_log_path: Path = _AUDIT_LOG
        self._req_count: int = 0

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self, policy_yaml_path: Optional[Path] = None) -> None:
        """
        Launch the lobstertrap.exe proxy server.

        Waits up to 10 seconds for the process to bind its port before
        returning. Raises if the binary is not found or the port doesn't
        open within the timeout.

        Args:
            policy_yaml_path: Path to a Lobster Trap YAML policy file.
                              Defaults to policies/finance_combined_policy.yaml.
        """
        if self.is_running:
            # LT already running (from previous backend run or external start).
            # Set _policy_path so heal/reload can find the active policy file.
            if self._policy_path is None:
                p = (policy_yaml_path or _DEFAULT_POLICY).resolve()
                if p.exists():
                    self._policy_path = p
                    print(f"[lobster_mgr] Detected external LT — policy path set to {p}")
            return

        binary = _BINARY_PATH.resolve()
        if not binary.exists():
            raise FileNotFoundError(
                f"Lobster Trap binary not found at {binary}. "
                "Move lobstertrap.exe into the regulaforge/ project root."
            )

        self._policy_path = (policy_yaml_path or _DEFAULT_POLICY).resolve()
        if not self._policy_path.exists():
            raise FileNotFoundError(f"Policy file not found: {self._policy_path}")

        # Ensure audit log directory exists
        self._audit_log_path.parent.mkdir(parents=True, exist_ok=True)

        backend_url = os.getenv("LOBSTER_TRAP_BACKEND", "http://localhost:8000")
        cmd = [
            str(binary), "serve",
            "--policy", str(self._policy_path),
            "--listen", f":{_PORT}",
            "--audit-log", str(self._audit_log_path),
            "--backend", backend_url,
        ]

        self._process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            cwd=str(binary.parent),
        )

        self._wait_for_port(timeout=10.0)

    def stop(self) -> None:
        """Terminate the lobstertrap.exe process gracefully."""
        if self._process and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait()
        self._process = None

        # Clean up any temp policy file from reload_policy()
        if self._tmp_policy and self._tmp_policy.exists():
            try:
                self._tmp_policy.unlink()
            except OSError:
                pass
            self._tmp_policy = None

    def reload_policy(self, yaml_str: str) -> None:
        """
        Swap the active policy without losing continuity.

        Writes yaml_str to a new temp file, stops the running process,
        then restarts with the new policy. The swap takes ~1 second.

        Args:
            yaml_str: Complete Lobster Trap YAML policy string.
        """
        tmp = Path(tempfile.mktemp(suffix=".yaml", dir=_AUDIT_LOG.parent))
        tmp.write_text(yaml_str, encoding="utf-8")

        old_tmp = self._tmp_policy

        # Detach _tmp_policy BEFORE calling stop() so stop() doesn't delete
        # the file we just wrote.
        self._tmp_policy = None
        self.stop()

        # Now assign and start with the new policy
        self._tmp_policy = tmp
        self.start(tmp)

        # Clean up the previous temp file after successful start
        if old_tmp and old_tmp.exists():
            try:
                old_tmp.unlink()
            except OSError:
                pass

    # ------------------------------------------------------------------
    # Readiness check
    # ------------------------------------------------------------------

    def _wait_for_port(self, timeout: float = 10.0) -> None:
        """Block until the process binds _PORT or timeout expires."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            # Check the process hasn't already crashed
            if self._process and self._process.poll() is not None:
                stderr = ""
                if self._process.stderr:
                    stderr = self._process.stderr.read().decode(errors="replace")
                raise RuntimeError(
                    f"Lobster Trap exited immediately (code {self._process.returncode}). "
                    f"stderr: {stderr[:400]}"
                )
            # TCP probe
            try:
                with socket.create_connection(("127.0.0.1", _PORT), timeout=0.5):
                    return
            except OSError:
                time.sleep(0.2)

        self.stop()
        raise TimeoutError(f"Lobster Trap did not bind port {_PORT} within {timeout}s")

    # ------------------------------------------------------------------
    # Proxy
    # ------------------------------------------------------------------

    async def proxy_request(self, prompt: str) -> dict:
        """POST a prompt through Lobster Trap; proactively restarts LT every
        _RESTART_EVERY requests to prevent the goroutine-pool wedge on Windows.
        """
        # Proactive restart before the wedge threshold.
        # Run synchronous stop/start in a thread so we don't block the event loop.
        if self.is_running and self._req_count >= self._RESTART_EVERY:
            self._req_count = 0
            policy = self._policy_path
            saved_tmp = self._tmp_policy
            self._tmp_policy = None   # prevent stop() from deleting temp policy

            def _restart():
                self.stop()
                self._tmp_policy = saved_tmp
                self.start(policy)

            await asyncio.to_thread(_restart)

        self._req_count += 1
        return await self._do_proxy(prompt)

    async def _do_proxy(self, prompt: str) -> dict:
        """
        POST a prompt to the Lobster Trap proxy and return a normalised verdict dict.

        Sends an OpenAI-compatible chat/completions request. Parses the
        _lobstertrap field for the verdict and matched rule.

        DENY:  Lobster Trap returns immediately with deny_message — no backend needed.
        ALLOW: Lobster Trap forwards to backend. If backend is unavailable (ConnectError
               or 5xx from backend), we still surface the ALLOW verdict from the
               _lobstertrap field before the backend hop.

        Returns:
            {
              "verdict":               "ALLOW" | "DENY" | "HUMAN_REVIEW",
              "rule_name":             str | None,
              "deny_message":          str,
              "detected":              dict,   # PromptMetadata
              "lobster_trap_response": dict,   # raw _lobstertrap field
              "latency_ms":            float,
            }
        """
        body = {
            "model": "finance-agent",
            "messages": [{"role": "user", "content": prompt}],
        }
        t0 = asyncio.get_event_loop().time()

        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                resp = await client.post(
                    f"{self._base_url}/v1/chat/completions",
                    json=body,
                )
                latency = (asyncio.get_event_loop().time() - t0) * 1000

                # Lobster Trap may return plain text or empty body on DENY
                # depending on how the deny_message is formatted
                raw_text = resp.text.strip()
                if not raw_text:
                    # Empty body — treat as ALLOW (backend response swallowed)
                    return {
                        "verdict":               "ALLOW",
                        "rule_name":             None,
                        "deny_message":          "",
                        "detected":              {},
                        "lobster_trap_response": {"verdict": "ALLOW", "note": "empty_body"},
                        "latency_ms":            round(latency, 2),
                    }

                try:
                    data = json.loads(raw_text)
                except json.JSONDecodeError:
                    # Plain-text deny message (non-JSON response from proxy)
                    return {
                        "verdict":               "DENY",
                        "rule_name":             None,
                        "deny_message":          raw_text[:500],
                        "detected":              {},
                        "lobster_trap_response": {"raw": raw_text[:200]},
                        "latency_ms":            round(latency, 2),
                    }

                lt = data.get("_lobstertrap", {})
                ingress = lt.get("ingress", {})
                content = ""
                if data.get("choices"):
                    content = data["choices"][0].get("message", {}).get("content", "")

                # Infer verdict from ingress action if top-level verdict missing
                verdict = lt.get("verdict") or ingress.get("action", "ALLOW")
                if verdict not in ("ALLOW", "DENY", "HUMAN_REVIEW", "ERROR"):
                    verdict = "DENY" if resp.status_code >= 400 else "ALLOW"

                return {
                    "verdict":               verdict,
                    "rule_name":             ingress.get("rule_name"),
                    "deny_message":          content,
                    "detected":              ingress.get("detected", {}),
                    "lobster_trap_response": lt,
                    "latency_ms":            round(latency, 2),
                }

            except httpx.ConnectError:
                # Process not running or not yet bound
                latency = (asyncio.get_event_loop().time() - t0) * 1000
                return {
                    "verdict":               "ERROR",
                    "rule_name":             None,
                    "deny_message":          "Lobster Trap proxy is not reachable",
                    "detected":              {},
                    "lobster_trap_response": {},
                    "latency_ms":            round(latency, 2),
                }

            except httpx.RemoteProtocolError:
                # Backend forwarding failed AFTER Lobster Trap already passed the
                # request — which means verdict was ALLOW. Extract _lobstertrap if
                # available in partial response headers, else treat as ALLOW.
                latency = (asyncio.get_event_loop().time() - t0) * 1000
                return {
                    "verdict":               "ALLOW",
                    "rule_name":             None,
                    "deny_message":          "",
                    "detected":              {},
                    "lobster_trap_response": {"verdict": "ALLOW", "note": "backend_unavailable"},
                    "latency_ms":            round(latency, 2),
                }

            except httpx.ReadTimeout:
                # Lobster Trap forwarded to upstream LLM which doesn't exist — timeout.
                # The fact that it forwarded means it issued an ALLOW verdict.
                latency = (asyncio.get_event_loop().time() - t0) * 1000
                return {
                    "verdict":               "ALLOW",
                    "rule_name":             None,
                    "deny_message":          "",
                    "detected":              {},
                    "lobster_trap_response": {"verdict": "ALLOW", "note": "upstream_timeout"},
                    "latency_ms":            round(latency, 2),
                }

            except Exception as exc:
                latency = (asyncio.get_event_loop().time() - t0) * 1000
                return {
                    "verdict":               "ERROR",
                    "rule_name":             None,
                    "deny_message":          str(exc),
                    "detected":              {},
                    "lobster_trap_response": {},
                    "latency_ms":            round(latency, 2),
                }

    # ------------------------------------------------------------------
    # Audit log tail
    # ------------------------------------------------------------------

    async def tail_audit_log(self) -> AsyncIterator[dict]:
        """
        Yield parsed audit log entries as they are written by Lobster Trap.

        Seeks to the current end-of-file on first call, then polls every
        50ms for new lines. Yields one dict per JSON line.

        Used by the ObservabilityPanel SSE endpoint.
        """
        self._audit_log_path.touch(exist_ok=True)

        with open(self._audit_log_path, "r", encoding="utf-8") as fh:
            fh.seek(0, 2)   # jump to current end — don't replay history
            while True:
                line = fh.readline()
                if line:
                    line = line.strip()
                    if line:
                        try:
                            yield json.loads(line)
                        except json.JSONDecodeError:
                            pass
                else:
                    await asyncio.sleep(0.05)

    async def recent_audit_events(self, n: int = 50) -> list[dict]:
        """
        Return the last n lines from the audit log as parsed dicts.
        Used on initial page load before the live SSE stream connects.
        """
        if not self._audit_log_path.exists():
            return []

        lines = self._audit_log_path.read_text(encoding="utf-8").splitlines()
        events: list[dict] = []
        for line in lines[-n:]:
            line = line.strip()
            if line:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        return events

    # ------------------------------------------------------------------
    # Dashboard API passthrough
    # ------------------------------------------------------------------

    async def get_stats(self) -> dict:
        """Return Lobster Trap stats snapshot from the dashboard API."""
        async with httpx.AsyncClient(timeout=5.0) as client:
            try:
                resp = await client.get(f"{self._base_url}/_lobstertrap/api/stats")
                return resp.json()
            except Exception as exc:
                return {"error": str(exc)}

    async def get_recent_events(self) -> list[dict]:
        """Return recent events from the Lobster Trap dashboard API."""
        async with httpx.AsyncClient(timeout=5.0) as client:
            try:
                resp = await client.get(f"{self._base_url}/_lobstertrap/api/events")
                return resp.json() if isinstance(resp.json(), list) else []
            except Exception:
                return []

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def is_running(self) -> bool:
        """True if LT subprocess is alive OR if the port is already bound (externally started)."""
        if self._process is not None and self._process.poll() is None:
            return True
        # Fallback: TCP probe — detects LT started by a previous backend instance
        try:
            with socket.create_connection(("127.0.0.1", _PORT), timeout=0.5):
                return True
        except OSError:
            return False

    @property
    def active_policy_path(self) -> Optional[Path]:
        return self._policy_path

    def __repr__(self) -> str:
        if self._process is not None and self._process.poll() is None:
            status = f"pid={self._process.pid}"
        elif self.is_running:
            status = f"external:port={_PORT}"
        else:
            status = "stopped"
        return f"LobsterTrapManager({status}, port={_PORT})"


# ---------------------------------------------------------------------------
# Module-level singleton — import `manager` in all routers
# ---------------------------------------------------------------------------
manager = LobsterTrapManager()
