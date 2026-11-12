#!/usr/bin/env python3
"""Summarize saved research evidence without re-running REA or modifying target apps."""
import hashlib
import json
from pathlib import Path
import re

from workspace_paths import ROOT
EVIDENCE = ROOT / "research/evidence"
CAPTURES = (
    "arc-artifact", "arc-inventory", "arc-apple-graph", "arc-macho", "arc-plist",
    "arc-signature", "arc-dylib-resolution", "arc-dispatch", "arc-interface-builder",
    "arc-interface-builder-expanded", "arc-assets", "arccore-plist", "chrome-plist",
    "chrome-macho", "arc-macho-view", "arc-window-class-names",
)


def read(name):
    return json.loads((EVIDENCE / f"{name}.json").read_text())


def main():
    records = []
    for name in CAPTURES:
        path = EVIDENCE / f"{name}.json"
        data = read(name)
        observed = bool(data.get("evidence_id")) and "error" not in data
        if observed:
            for required in ("subject", "operation", "normalized_result", "limitations"):
                if required not in data:
                    raise ValueError(f"Missing {required} in {path.name}")
        records.append({"file": path.name, "status": "observed" if observed else "failed",
                        "evidence_id": data.get("evidence_id"), "operation": data.get("operation"),
                        "file_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                        "failure": data.get("message"), "limitations": data.get("limitations", [])})
    inventory = read("arc-inventory")["normalized_result"]
    macho = read("arc-macho")["normalized_result"]
    ui = read("arc-interface-builder-expanded")["normalized_result"]
    selectors = sorted({node["name"] for node in ui["graph"]["nodes"]
                        if node["kind"] == "objc_selector"
                        and "Contents/Resources/Base.lproj/MainMenu.nib" in node["id"]
                        and re.search(r"space|sidebar|profile|folder|pinned|archive", node["name"], re.I)})
    upstream = []
    for manifest_path in sorted((ROOT / "research/upstream").glob("*/manifest.json")):
        manifest = json.loads(manifest_path.read_text())
        for source in manifest["files"]:
            if source["status"] != "downloaded":
                continue
            actual = hashlib.sha256((manifest_path.parent / source["path"]).read_bytes()).hexdigest()
            if actual != source["sha256"]:
                raise ValueError(f"Upstream source changed: {source['path']}")
        upstream.append({"revision": manifest["revision"],
                         "verified_files": sum(f["status"] == "downloaded" for f in manifest["files"]),
                         "unavailable": [f["path"] for f in manifest["files"] if f["status"] != "downloaded"]})
    summary = {
        "scope": "Static artifacts and selected source files; no native browser prototype has been built",
        "versions": {name: read(name)["normalized_result"]["bundle"] for name in
                     ("arc-plist", "arccore-plist", "chrome-plist")},
        "records": records,
        "arc_inventory_manifest": inventory["manifest"],
        "arc_dependencies": macho["dependencies"],
        "arc_core_import_candidates": [item for item in macho["imports"]["items"] if item.get("source") == "ArcCore"],
        "arc_import_coverage": {key: macho["imports"].get(key) for key in ("exhaustive", "limitations")},
        "ui_selectors": selectors,
        "ui_coverage": ui["graph"]["coverage"],
        "ui_truncated": ui["graph"]["truncated"],
        "assets": {key: read("arc-assets")["normalized_result"][key] for key in
                   ("total_records", "offset", "limit", "next_offset", "truncated", "limitations")},
        "upstream": upstream,
        "validation_scope": "JSON shape and SHA-256 of saved files; not independent authentication of REA claims",
    }
    (EVIDENCE / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"observed_records": sum(r["status"] == "observed" for r in records),
                      "failed_operations": [r["file"] for r in records if r["status"] == "failed"],
                      "selectors": selectors, "ui_truncated": summary["ui_truncated"], "upstream": upstream},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
