from __future__ import annotations

import argparse
import http.server
import socket
import socketserver
from pathlib import Path


ROOT = Path(__file__).resolve().parent / "web"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class ReusableTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


def local_ip() -> str:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        try:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
        except OSError:
            return "127.0.0.1"


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve the local Health Base prototype on the LAN.")
    parser.add_argument("--host", default="0.0.0.0", help="Bind host. Default: 0.0.0.0")
    parser.add_argument("--port", type=int, default=5173, help="Port. Default: 5173")
    args = parser.parse_args()

    with ReusableTCPServer((args.host, args.port), Handler) as httpd:
        print(f"Serving {ROOT}", flush=True)
        print(f"PC:      http://localhost:{args.port}/", flush=True)
        print(f"iPhone:  http://{local_ip()}:{args.port}/", flush=True)
        print("Press Ctrl+C to stop.", flush=True)
        httpd.serve_forever()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
