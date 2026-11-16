"""Loopback-only Ember bridge for the Focos global globe and local Qwen."""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

SYSTEM = (
    "You are Ember, the concise guide to Focos's Global VIIRS Globe. "
    "Reply in plain text, at most three short sentences and 80 words. "
    "The globe displays recent NASA FIRMS VIIRS NOAA-20 and NOAA-21 thermal detections, "
    "grouped in 0.5-degree grid cells and replayed over a 24-hour observation window. "
    "A taller column means more satellite detections in that cell, not a taller flame, "
    "confirmed wildfire, fire perimeter, or continuous spread. The feed may be a dated snapshot. "
    "Use only the supplied viewer evidence for specific counts, coordinates, times, or patterns. "
    "If evidence is missing, say so. Do not invent live fire status, accuracy, or forecasts. "
    "The historical GWIS burned-area calendar is a different measure from recent FIRMS detections."
)


def model_reply(payload: dict) -> str | None:
    url = os.environ.get("EMBER_MODEL_URL", "").strip()
    if not url:
        return None
    message = payload.get("message")
    if not isinstance(message, str) or not 1 <= len(message.strip()) <= 800:
        return None
    history = payload.get("history")
    turns = [{"role": "system", "content": SYSTEM}]
    context = payload.get("context")
    if isinstance(context, dict):
        safe = {k: str(context[k])[:100] for k in ("view", "mode", "feed_status", "replay_hour") if k in context}
        if isinstance(context.get("evidence"), str):
            safe["evidence"] = context["evidence"][:800]
        turns.append({"role": "system", "content": f"Browser selection (unverified): {json.dumps(safe)}"})
    if isinstance(history, list):
        for item in history[-6:]:
            if isinstance(item, dict) and item.get("role") in ("user", "assistant") and isinstance(item.get("content"), str):
                turns.append({"role": item["role"], "content": item["content"][:800]})
    turns.append({"role": "user", "content": message})
    request_data = {"model": os.environ.get("EMBER_MODEL_NAME", "Qwen/Qwen3.5-9B"),
                    "messages": turns, "temperature": 0.2}
    # OpenRouter follows max_tokens; Cascade's original local Qwen service uses
    # max_completion_tokens. Keep both providers compatible without extra flags.
    native_ollama = urlparse(url).path == "/api/chat"
    if native_ollama:
        request_data.pop("temperature")
        request_data.update({"stream": False, "think": False, "options": {"temperature": 0.1, "num_predict": 140}})
    elif urlparse(url).hostname == "openrouter.ai":
        request_data["max_tokens"] = 280
    else:
        request_data["max_completion_tokens"] = 280
    body = json.dumps(request_data).encode()
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    key = os.environ.get("EMBER_MODEL_API_KEY", "").strip()
    if not key and (key_file := os.environ.get("EMBER_MODEL_API_KEY_FILE")):
        try:
            key = open(key_file, encoding="utf-8").read().strip()
        except OSError:
            return None
    if key:
        headers["Authorization"] = f"Bearer {key}"
    try:
        with urlopen(Request(url, data=body, headers=headers, method="POST"), timeout=90) as response:
            result = json.load(response)
        content = result["message"]["content"] if native_ollama else result["choices"][0]["message"]["content"]
        return content.strip()[:2500] if isinstance(content, str) and content.strip() else None
    except (OSError, URLError, ValueError, KeyError, IndexError, TypeError):
        return None


class Handler(BaseHTTPRequestHandler):
    def _origin(self) -> str | None:
        origin = self.headers.get("Origin", "")
        allowed = set(os.environ.get("EMBER_ALLOWED_ORIGINS", "http://127.0.0.1:5185,http://localhost:5185").split(","))
        return origin if origin in allowed else None

    def _send(self, status: int, data: dict) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        if origin := self._origin():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        if self.path != "/api/ember/chat" or not self._origin():
            self._send(403, {"error": "Origin not allowed"})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self._origin())
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self) -> None:
        if self.path != "/api/ember/chat" or not self._origin():
            self._send(403, {"error": "Origin not allowed"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 6000:
                raise ValueError("bad size")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError("bad body")
        except (ValueError, json.JSONDecodeError):
            self._send(400, {"error": "Invalid request"})
            return
        reply = model_reply(payload)
        self._send(200, {"mode": "model" if reply else "guide", "reply": reply})


if __name__ == "__main__":
    port = int(os.environ.get("EMBER_PORT", "8021"))
    print(f"Ember bridge listening on http://127.0.0.1:{port}; model {'configured' if os.environ.get('EMBER_MODEL_URL') else 'not configured'}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
