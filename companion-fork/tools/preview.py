#!/usr/bin/env python3
"""Serve the prototype from localhost so browser modules and IndexedDB work."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen
import webbrowser

PROJECT_DIR = Path(__file__).resolve().parent.parent
PORTS = range(4173, 4190)
PORT_FILE = PROJECT_DIR / "tools" / ".preview-port"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


handler = partial(QuietHandler, directory=str(PROJECT_DIR))
server = None
saved_port = None
if PORT_FILE.exists():
    try:
        saved_port = int(PORT_FILE.read_text(encoding="utf-8").strip())
    except ValueError:
        raise SystemExit("The saved preview port is invalid. Remove tools/.preview-port and run again.")

candidate_ports = [saved_port] if saved_port is not None else PORTS
for port in candidate_ports:
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), handler)
        break
    except OSError:
        if saved_port is not None:
            url = f"http://127.0.0.1:{saved_port}/"
            try:
                with urlopen(url, timeout=2) as response:
                    page = response.read(8192)
                if b"Companion" in page and response.status == 200:
                    print(f"Companion preview is already running: {url}", flush=True)
                    print("Reusing the same address keeps your local characters and chats available.", flush=True)
                    webbrowser.open(url)
                    raise SystemExit(0)
            except SystemExit:
                raise
            except Exception:
                pass
            raise SystemExit(f"Saved preview port {saved_port} is in use. Stop that server, then run this launcher again.")

if server is None:
    raise SystemExit("Could not find a free preview port between 4173 and 4189.")

if saved_port is None:
    PORT_FILE.write_text(str(server.server_port), encoding="utf-8")

url = f"http://127.0.0.1:{server.server_port}/"
print(f"Companion preview is ready: {url}", flush=True)
print("Keep this terminal window open. Press Ctrl+C to stop the preview.", flush=True)
webbrowser.open(url)
try:
    server.serve_forever()
except KeyboardInterrupt:
    print("\nCompanion preview stopped.", flush=True)
finally:
    server.server_close()
