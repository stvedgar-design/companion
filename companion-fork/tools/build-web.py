#!/usr/bin/env python3
"""Stage only app assets for Capacitor without copying repo metadata or dependencies."""

from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "www"

WEB_DIR.mkdir(exist_ok=True)
shutil.copy2(ROOT / "index.html", WEB_DIR / "index.html")
shutil.copytree(ROOT / "styles", WEB_DIR / "styles", dirs_exist_ok=True)
shutil.copytree(ROOT / "src", WEB_DIR / "src", dirs_exist_ok=True)
print(f"Web assets staged in {WEB_DIR}")
