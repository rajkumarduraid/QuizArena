#!/usr/bin/env python3
"""
Quiz Arena relay server (Python edition)
========================================
Identical in behaviour to server.js — use whichever runtime you already have.

Serves index.html and carries the game between devices over ordinary HTTP
long-polling. Nothing but plain web requests, so networks that block WebRTC
and peer-to-peer traffic still work.

    python3 server.py            # port 8080
    python3 server.py 3000       # or pick your own

Python 3.7 or newer. Standard library only, nothing to install.
"""

import json
import os
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8080))
HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, "index.html")

HOLD_S = 25.0                 # how long a poll waits before answering empty
MAX_BODY = 256 * 1024         # per message
KEEP_MSGS = 200               # per room backlog
MAX_ROOMS = 200
ROOM_TTL_S = 6 * 60 * 60

_lock = threading.Condition()
_rooms = {}                   # code -> {"seq": int, "msgs": [(seq, obj)], "touched": float}


def _valid(code):
    return len(code) == 6 and all(c.isdigit() or ("A" <= c <= "Z") for c in code)


def _room(code):
    """Caller must hold _lock."""
    r = _rooms.get(code)
    if r is None:
        if len(_rooms) >= MAX_ROOMS:
            _sweep()
        r = {"seq": 0, "msgs": [], "touched": time.time()}
        _rooms[code] = r
    r["touched"] = time.time()
    return r


def _sweep():
    """Caller must hold _lock."""
    cutoff = time.time() - ROOM_TTL_S
    for code in [c for c, r in _rooms.items() if r["touched"] < cutoff]:
        del _rooms[code]
    if len(_rooms) >= MAX_ROOMS:
        oldest = min(_rooms, key=lambda c: _rooms[c]["touched"])
        del _rooms[oldest]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "QuizArena"

    def log_message(self, *args):
        pass                                   # keep the console readable

    # ------------------------------------------------------------- helpers
    def _json(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _route(self):
        parsed = urlparse(self.path)
        path = parsed.path
        idx = path.find("/__qa/")
        route = "__qa/" + path[idx + 6:] if idx >= 0 else path
        return route, parse_qs(parsed.query)

    def _code(self, query):
        return (query.get("room", [""])[0] or "").upper()

    # ----------------------------------------------------------------- GET
    def do_GET(self, body=True):
        route, query = self._route()

        if route == "__qa/ping":
            with _lock:
                n = len(_rooms)
            self._json(200, {"quizarena": 1, "rooms": n})
            return

        if route == "__qa/poll":
            code = self._code(query)
            if not _valid(code):
                self._json(400, {"error": "bad room code"})
                return
            try:
                since = int(query.get("since", ["-1"])[0])
            except ValueError:
                since = -1

            deadline = time.time() + HOLD_S
            with _lock:
                r = _room(code)
                # since < 0 means "just tell me where we are" — a joiner does
                # not want the backlog replayed at it, only what comes next.
                if since < 0:
                    self._json(200, {"seq": r["seq"], "msgs": []})
                    return
                while r["seq"] <= since:
                    remaining = deadline - time.time()
                    if remaining <= 0:
                        break
                    _lock.wait(remaining)
                    r = _rooms.get(code) or _room(code)
                msgs = [m for (s, m) in r["msgs"] if s > since]
                self._json(200, {"seq": r["seq"], "msgs": msgs})
            return

        self._serve_page(body)

    def do_HEAD(self):
        self.do_GET(body=False)

    # ---------------------------------------------------------------- POST
    def do_POST(self):
        route, query = self._route()
        if route != "__qa/send":
            self._json(404, {"error": "not found"})
            return

        code = self._code(query)
        if not _valid(code):
            self._json(400, {"error": "bad room code"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self._json(400, {"error": "bad body"})
            return
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self._json(400, {"error": "bad body"})
            return

        with _lock:
            r = _room(code)
            r["seq"] += 1
            r["msgs"].append((r["seq"], data))
            if len(r["msgs"]) > KEEP_MSGS:
                del r["msgs"][:len(r["msgs"]) - KEEP_MSGS]
            seq = r["seq"]
            _lock.notify_all()
        self._json(200, {"ok": True, "seq": seq})

    # ---------------------------------------------------------------- page
    def _serve_page(self, body=True):
        try:
            with open(PAGE, "rb") as fh:
                buf = fh.read()
        except OSError:
            msg = b"index.html not found next to server.py"
            self.send_response(500)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(buf)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if body:
            self.wfile.write(buf)


def addresses():
    out = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))          # no packets sent; picks the route
        out.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in out:
                out.append(ip)
    except OSError:
        pass
    return out


def main():
    if not os.path.exists(PAGE):
        print("\n  Could not find index.html next to server.py.")
        print("  Keep both files in the same folder.\n")
        sys.exit(1)

    httpd = ThreadingHTTPServer(("", PORT), Handler)
    httpd.daemon_threads = True
    print("\n  ⚡ Quiz Arena is running\n")
    print("  On this computer:   http://localhost:%d" % PORT)
    ips = addresses()
    if ips:
        print("\n  Share ONE of these with your players:")
        for ip in ips:
            print("      http://%s:%d" % (ip, PORT))
        print("\n  They must be on the same network as this computer.")
    else:
        print("\n  No network address found — others will not be able to reach this.")
    print("\n  Leave this window open for the whole quiz. Ctrl+C to stop.\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.\n")


if __name__ == "__main__":
    main()
