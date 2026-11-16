"""Loopback-only Ember bridge for the Focos global globe and local Qwen."""

from __future__ import annotations

import json
import os
import stat
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

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


LANGUAGE = {
    "en": "English",
    "es": "Rioplatense Spanish as spoken in Argentina, using vos",
    "jam": (
        "Jamaican Patwa (Jamaican Creole English), written the way Jamaicans write it every day; "
        "keep technical terms such as hotspot, satellite, VIIRS and NASA FIRMS in English"
    ),
}
# Output ceilings are generous runaway guards, not length limits (SYSTEM asks for three sentences).
# A reply stopped by the ceiling is asked for once more with the higher one; if that is cut off
# too, the browser keeps its own deterministic answer instead of showing a truncated one.
OUTPUT_CEILINGS = (1200, 3000)
OLLAMA_CEILINGS = (600, 1500)
MAX_REPLY_CHARS = 4000


class _NoRedirect(HTTPRedirectHandler):
    """Treat any redirect as a failure, so the API key never travels to another address."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = build_opener(_NoRedirect)


def warn_if_key_file_shared() -> None:
    """Print a warning (names and path only, never the key) when the key file is readable by others."""
    path = os.environ.get("EMBER_MODEL_API_KEY_FILE")
    if not path:
        return
    try:
        mode = os.stat(path).st_mode
    except OSError:
        return
    if mode & (stat.S_IRWXG | stat.S_IRWXO):
        print(
            f"Warning: EMBER_MODEL_API_KEY_FILE ({path}) can be read by group or others; "
            f"restrict it with: chmod 600 {path}",
            file=sys.stderr,
        )


def _ask(
    url: str, request_data: dict, headers: dict, native_ollama: bool, ceiling: int
) -> tuple[str | None, bool]:
    """One request to the model: the reply text, and whether the ceiling stopped it."""
    data = dict(request_data)
    if native_ollama:
        data["options"] = {**data["options"], "num_predict": ceiling}
    elif urlparse(url).hostname == "openrouter.ai":
        data["max_tokens"] = ceiling
    else:
        data["max_completion_tokens"] = ceiling
    request = Request(url, data=json.dumps(data).encode(), headers=headers, method="POST")
    with _OPENER.open(request, timeout=90) as response:
        result = json.load(response)
    if native_ollama:
        content, cut = result["message"]["content"], result.get("done_reason") == "length"
    else:
        choice = result["choices"][0]
        content, cut = choice["message"]["content"], choice.get("finish_reason") == "length"
    return (content.strip() if isinstance(content, str) else None), cut


def model_reply(payload: dict) -> str | None:
    url = os.environ.get("EMBER_MODEL_URL", "").strip()
    if not url:
        return None
    message = payload.get("message")
    if not isinstance(message, str) or not 1 <= len(message.strip()) <= 800:
        return None
    history = payload.get("history")
    language = LANGUAGE.get(payload.get("lang"), LANGUAGE["en"])
    turns = [{"role": "system", "content": f"{SYSTEM} Answer in {language}."}]
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
    # max_completion_tokens; Ollama's native API uses num_predict (set per attempt in _ask).
    native_ollama = urlparse(url).path == "/api/chat"
    if native_ollama:
        request_data.pop("temperature")
        request_data.update({"stream": False, "think": False, "options": {"temperature": 0.1}})
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    key = os.environ.get("EMBER_MODEL_API_KEY", "").strip()
    if not key and (key_file := os.environ.get("EMBER_MODEL_API_KEY_FILE")):
        try:
            with open(key_file, encoding="utf-8") as f:
                key = f.read().strip()
        except OSError:
            return None
    if key:
        headers["Authorization"] = f"Bearer {key}"
    try:
        for ceiling in OLLAMA_CEILINGS if native_ollama else OUTPUT_CEILINGS:
            content, cut = _ask(url, request_data, headers, native_ollama, ceiling)
            if cut:
                continue
            return content if content and len(content) <= MAX_REPLY_CHARS else None
        return None
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
    warn_if_key_file_shared()
    port = int(os.environ.get("EMBER_PORT", "8021"))
    print(f"Ember bridge listening on http://127.0.0.1:{port}; model {'configured' if os.environ.get('EMBER_MODEL_URL') else 'not configured'}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
