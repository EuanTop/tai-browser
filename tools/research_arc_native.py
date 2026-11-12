#!/usr/bin/env python3
"""Run a bounded Arc investigation in one owned, local REA MCP session.

No client registration changes, app launch, debugger attach, or user data access.
The input is the previously derived, digest-bound ARM64 research artifact.
"""
import hashlib
import argparse
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import threading
import time

from workspace_paths import ROOT, WORKSPACE
TARGET = ROOT / 'research/local/arc-arm64'
DIGEST = 'cb07a51b6d36fca64730ae73cfbaa2131d8b39d6d8cc6ac9c201389d80cdfa47'
OUTPUT = ROOT / 'research/local/arc-native-extended'
STARTUP_MS = 1200000
DISABLED_ANALYZERS = ['Decompiler Switch Analysis']


class Session:
    def __init__(self, log):
        environment = os.environ.copy()
        environment.update({
            'GHIDRA_INSTALL_DIR': str(WORKSPACE / 'toolchains/ghidra_12.1.4_PUBLIC'),
            'TMPDIR': str(WORKSPACE / 'tmp'),
            'REA_GHIDRA_STARTUP_TIMEOUT_MS': str(STARTUP_MS),
            'REA_GHIDRA_DISABLED_ANALYZERS': ','.join(DISABLED_ANALYZERS),
        })
        self.process = subprocess.Popen(
            [str(ROOT / 'tools/rea/node_modules/.bin/rea'), '--mcp'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log,
            text=True, env=environment)
        self.messages = queue.Queue()
        self.next_id = 0
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        try:
            for line in self.process.stdout:
                self.messages.put(json.loads(line))
        except Exception as error:
            self.messages.put(error)
        finally:
            self.messages.put(EOFError('Local REA server closed'))

    def notify(self, method):
        self.process.stdin.write(json.dumps({'jsonrpc': '2.0', 'method': method}) + '\n')
        self.process.stdin.flush()

    def call(self, method, parameters, timeout=1260):
        self.next_id += 1
        request_id = self.next_id
        self.process.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': request_id,
                                            'method': method, 'params': parameters}) + '\n')
        self.process.stdin.flush()
        deadline = time.monotonic() + timeout
        while True:
            message = self.messages.get(timeout=max(0, deadline - time.monotonic()))
            if isinstance(message, Exception):
                raise message
            if message.get('id') == request_id:
                return message

    def tool(self, name, arguments, filename, timeout=None):
        print('REA step:', name, flush=True)
        response = self.call('tools/call', {'name': name, 'arguments': arguments},
                             timeout=timeout if timeout is not None else STARTUP_MS / 1000 + 60)
        (OUTPUT / filename).write_text(json.dumps(response, ensure_ascii=False, indent=2) + '\n')
        if 'error' in response or response.get('result', {}).get('isError'):
            raise RuntimeError('REA tool failed; complete response saved in ' + filename)
        result = response.get('result', {})
        payload = result.get('structuredContent')
        if payload is None:
            texts = [item['text'] for item in result.get('content', []) if item.get('type') == 'text']
            if len(texts) == 1:
                try:
                    payload = json.loads(texts[0])
                except json.JSONDecodeError:
                    pass
        return payload

    def shutdown(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            self.process.wait(timeout=15)


def main():
    global OUTPUT, STARTUP_MS, DISABLED_ANALYZERS
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', default='arc-native-extended')
    parser.add_argument('--startup-timeout-seconds', type=int, default=1200)
    parser.add_argument('--skip-shared-return-calls', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9-]+', args.name) or not 60 <= args.startup_timeout_seconds <= 1800:
        parser.error('Use a simple investigation name and a 60–1800 second startup limit')
    OUTPUT = ROOT / 'research/local' / args.name
    STARTUP_MS = args.startup_timeout_seconds * 1000
    if args.skip_shared_return_calls:
        DISABLED_ANALYZERS.append('Shared Return Calls')
    if OUTPUT.exists():
        raise SystemExit('Preserve the previous investigation; use its saved results')
    if not TARGET.is_file() or hashlib.file_digest(TARGET.open('rb'), 'sha256').hexdigest() != DIGEST:
        raise SystemExit('Derived Arc artifact does not match its recorded digest')
    OUTPUT.mkdir()
    status = {'target': str(TARGET), 'sha256': DIGEST, 'status': 'running',
              'startup_timeout_ms': STARTUP_MS,
              'disabled_analyzers': DISABLED_ANALYZERS,
              'scope': 'Static native analysis, no app execution or user profiles'}
    status_path = OUTPUT / 'status.json'
    status_path.write_text(json.dumps(status, indent=2) + '\n')
    with (OUTPUT / 'server.stderr.log').open('w') as log:
        session = Session(log)
        opened = False
        try:
            initialized = session.call('initialize', {
                'protocolVersion': '2024-11-05', 'capabilities': {},
                'clientInfo': {'name': 'sidebar-browser-local-research', 'version': '0.1'},
            }, timeout=30)
            if 'error' in initialized:
                raise RuntimeError('REA initialization failed')
            session.notify('notifications/initialized')
            tools = session.call('tools/list', {}, timeout=30)
            names = {tool['name'] for tool in tools['result']['tools']}
            required = {'open_binary', 'close_binary', 'search_procedures',
                        'procedure_pseudo_code', 'export_evidence_bundle'}
            if not required <= names:
                raise RuntimeError('Installed server lacks required investigation tools')
            session.tool('open_binary', {'path': str(TARGET), 'provider_id': 'ghidra'}, 'open.json')
            opened = True
            search = session.tool('search_procedures', {
                'pattern': 'changeProfileForCurrentSpace|nextSpace|previousSpace|newSpace',
                'mode': 'regex', 'case_sensitive': False,
            }, 'procedures.json')
            if not isinstance(search, dict) or not isinstance(search.get('normalized_result'), list):
                raise RuntimeError('Unexpected procedure search payload; inspect saved response')
            matches = search['normalized_result']
            selected = [item for item in matches if 'changeProfileForCurrentSpace' in item['value']][:2]
            targets = {item['address']: item['value'] for item in selected[:1]}
            metadata_path = ROOT / 'research/local/arc-dispatch-decoder.json'
            if metadata_path.is_file():
                metadata = json.loads(metadata_path.read_text())
                if metadata.get('target_sha256') != DIGEST:
                    raise RuntimeError('Static entrypoint report belongs to a different artifact')
                for item in metadata['result']['objc_dispatch_implementations']:
                    if item['selector'] == 'changeProfileForCurrentSpace:':
                        targets[item['implementation_address']] = item['selector']
                # These destinations were read from the bounded instruction
                # windows retained in arc-handler-assembly/manifest.json.
                targets['0x10031d284'] = 'profile handler branch destination'
                targets['0x10014fa28'] = 'Space handler shared branch destination'
            for index, (address, purpose) in enumerate(list(targets.items())[:3]):
                session.tool('procedure_pseudo_code', {'procedure': address}, f'handler-{index}.json')
            status['procedure_matches'] = len(matches)
            status['profile_handlers_requested'] = selected
            status['decompiled_targets'] = targets
            session.tool('export_evidence_bundle', {'path': str(OUTPUT / 'evidence-bundle.json')}, 'export.json')
            status['status'] = 'completed'
        except Exception as error:
            status.update(status='failed', error=str(error))
        finally:
            if opened:
                try:
                    session.tool('close_binary', {'snapshot_path': str(OUTPUT / 'analysis.snapshot.json')}, 'close.json', timeout=45)
                except Exception as error:
                    status['cleanup_error'] = str(error)
                    status['status'] = 'failed'
            session.shutdown()
            status_path.write_text(json.dumps(status, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(status, ensure_ascii=False, indent=2))
    return 0 if status['status'] == 'completed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
