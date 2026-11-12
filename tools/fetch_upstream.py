#!/usr/bin/env python3
"""Fetch a bounded, revision-pinned Chromium source sample for review."""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.request

from workspace_paths import ROOT
FILES = (
    "chrome/browser/ui/browser.h",
    "chrome/browser/ui/tabs/tab_strip_model.h",
    "chrome/browser/ui/tabs/tab_strip_model.cc",
    "chrome/browser/ui/views/frame/browser_view.h",
    "chrome/browser/ui/views/frame/browser_view.cc",
    "chrome/browser/ui/tabs/vertical_tab_strip_state_controller.h",
    "chrome/browser/profiles/profile.h",
    "content/public/browser/web_contents.h",
    "chrome/browser/ui/views/frame/vertical_tab_strip_region_view.h",
    "chrome/browser/ui/views/frame/vertical_tab_strip_region_view.cc",
)
MAX_FILE_BYTES = 1024 * 1024


def fetch_one(revision, relative, destination):
    url = f"https://raw.githubusercontent.com/chromium/chromium/{revision}/{relative}"
    try:
        with urllib.request.urlopen(url, timeout=40) as response:
            body = response.read(MAX_FILE_BYTES + 1)
        if len(body) > MAX_FILE_BYTES:
            raise ValueError("Source file exceeds the 1 MiB per-file budget")
        path = destination / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        return {"path": relative, "url": url, "status": "downloaded",
                "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        return {"path": relative, "url": url, "status": "unavailable", "error": str(error)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("revision", help="Exact 40-character Chromium Git commit")
    args = parser.parse_args()
    if len(args.revision) != 40 or any(c not in "0123456789abcdef" for c in args.revision):
        parser.error("Use an exact lowercase 40-character Git commit")
    destination = ROOT / "research" / "upstream" / args.revision
    if destination.exists():
        parser.error("Destination already exists; preserve the previous source sample")
    destination.mkdir(parents=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda path: fetch_one(args.revision, path, destination), FILES))
    manifest = {"repository": "https://github.com/chromium/chromium", "revision": args.revision,
                "scope": "Selected source files only; not a complete checkout or build baseline",
                "files": results}
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"revision": args.revision, "downloaded": sum(r["status"] == "downloaded" for r in results),
                      "unavailable": [r["path"] for r in results if r["status"] != "downloaded"],
                      "bytes": sum(r.get("bytes", 0) for r in results)}, indent=2))


if __name__ == "__main__":
    main()
