#!/usr/bin/env python3
"""Allow the Android app's native HTTP bridge to reach a user-configured KoboldCpp server."""

from pathlib import Path
import re

manifest = Path(__file__).resolve().parent.parent / "android/app/src/main/AndroidManifest.xml"
if not manifest.is_file():
    raise SystemExit("Android platform is missing. Run `npx cap add android` first.")

source = manifest.read_text(encoding="utf-8")
attribute = 'android:usesCleartextTraffic="true"'
if re.search(r'android:usesCleartextTraffic\s*=\s*"[^"]*"', source):
    updated, count = re.subn(
        r'android:usesCleartextTraffic\s*=\s*"[^"]*"', attribute, source, count=1
    )
else:
    updated, count = re.subn(r"<application\b", f"<application {attribute}", source, count=1)

if count != 1:
    raise SystemExit("Could not update the Android application manifest for local HTTP.")

manifest.write_text(updated, encoding="utf-8")
print("Android app can now connect to the HTTP server selected in Connection settings.")
