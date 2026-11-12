#!/usr/bin/env python3
"""Capture static REA evidence from an explicitly selected installed macOS app."""
import argparse
import datetime
import json
from pathlib import Path
import subprocess

from workspace_paths import ROOT
REA = ROOT / "tools/rea/node_modules/.bin/rea"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path, help="Explicit .app path; does not inspect user profiles")
    parser.add_argument("output", type=Path, help="New evidence directory; existing paths are refused")
    args = parser.parse_args()
    app = args.app.resolve()
    if app.suffix != ".app" or not (app / "Contents/Info.plist").is_file():
        parser.error("Select an existing macOS .app bundle")
    if not REA.exists():
        parser.error("Install the pinned dependency with npm ci --prefix tools/rea --ignore-scripts")
    version = subprocess.check_output([str(REA), "--version"], text=True).strip()
    if "6.5.0" not in version:
        parser.error(f"Expected REA 6.5.0, found {version}")
    output = args.output.resolve()
    if output.exists():
        parser.error("Output already exists; select a new directory to retain previous evidence")
    output.mkdir(parents=True)
    # Metadata/archives only. No debugger attach, browser launch, profile reads or client setup.
    commands = [
        ("artifact", ["inspect-artifact", str(app)]),
        ("macho", ["inspect-macho", str(app)]),
        ("plist", ["inspect-plist", str(app)]),
        ("signature", ["inspect-signature", str(app)]),
        ("dylib", ["trace-dylib-resolution", str(app)]),
        ("interface-builder", ["decode-interface-builder", str(app), "--max-documents", "12",
                               "--max-objects", "5000", "--max-connections", "10000"]),
        ("assets", ["inspect-asset-catalog", str(app), "--offset", "0", "--limit", "80"]),
    ]
    records = []
    for name, arguments in commands:
        command = [str(REA), *arguments, "--json"]
        stdout_path = output / f"{name}.json"
        stderr_path = output / f"{name}.stderr.txt"
        record = {"name": name, "command": command, "stdout": stdout_path.name,
                  "stderr": stderr_path.name}
        try:
            with stdout_path.open("w") as stdout, stderr_path.open("w") as stderr:
                run = subprocess.run(command, stdout=stdout, stderr=stderr, timeout=180, check=False)
            record["exit_code"] = run.returncode
            data = json.loads(stdout_path.read_text())
            record.update({"evidence_id": data.get("evidence_id"), "error": data.get("message"),
                           "limitations": data.get("limitations", [])})
            record["status"] = "observed" if run.returncode == 0 and data.get("evidence_id") else "failed"
        except (subprocess.TimeoutExpired, OSError, json.JSONDecodeError) as error:
            record.update({"status": "failed", "error": str(error)})
        records.append(record)
        print(f"{name}: {record['status']}", flush=True)
    manifest = {"rea_version": version, "app": str(app),
                "captured_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "scope": "Static installed-app inspection, not runtime behavior verification",
                "records": records}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return int(any(record["status"] == "failed" for record in records))


if __name__ == "__main__":
    raise SystemExit(main())
