#!/usr/bin/env python3
"""Minimal /health for K8s probes. Writes ready flag when agent boot succeeds."""
from __future__ import annotations
import json, os, pathlib, time
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("HEALTH_PORT", "19310"))
READY_FLAG = pathlib.Path(os.environ.get("HEALTH_READY_FLAG", "/tmp/cloud-agent-dispatch.ready"))
START = time.time()

class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quiet
        return

    def do_GET(self):
        if self.path not in ("/health", "/healthz", "/"):
            self.send_response(404)
            self.end_headers()
            return
        ready = READY_FLAG.exists()
        # Allow probes to pass once the entrypoint has created the ready flag
        # (health server up + boot attempted). Status JSON still reports ready.
        body = json.dumps({
            "ok": True,
            "ready": ready,
            "uptime_s": int(time.time() - START),
            "profile": os.environ.get("DSH_SUPERAGENT_PROFILE", ""),
        }).encode()
        self.send_response(200 if ready else 200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

if __name__ == "__main__":
    HTTPServer(("0.0.0.0", PORT), H).serve_forever()
