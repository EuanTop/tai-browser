import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export class ConnectionError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** Host-only launcher. Never accept executable/cwd/env from a page or model tool. */
export function launchCodex({ executable = 'codex', cwd, env }) {
  if (!cwd || !env) throw new TypeError('Host must supply cwd and environment');
  return spawn(executable, ['app-server', '--listen', 'stdio://'], {
    cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Codex uses JSON-RPC semantics with no jsonrpc field, one message per line. */
export class JsonlRpc extends EventEmitter {
  #child; #pending = new Map(); #next = 0; #closed = false;
  #buffer = ''; #decoder = new StringDecoder('utf8'); #serverRequests = new Map();
  constructor(child, { timeoutMs = 15000, maxLineBytes = 4 * 1024 * 1024 } = {}) {
    super(); this.#child = child; this.timeoutMs = timeoutMs;
    child.stdout.on('data', chunk => {
      this.#buffer += this.#decoder.write(chunk);
      let end;
      while ((end = this.#buffer.indexOf('\n')) !== -1) {
        const line = this.#buffer.slice(0, end); this.#buffer = this.#buffer.slice(end + 1);
        if (Buffer.byteLength(line) > maxLineBytes) return this.#fail('FRAME_TOO_LARGE');
        if (!line.trim()) continue;
        try { this.#receive(JSON.parse(line)); } catch { return this.#fail('INVALID_FRAME'); }
      }
      if (Buffer.byteLength(this.#buffer) > maxLineBytes) this.#fail('FRAME_TOO_LARGE');
    });
    // Diagnostics may contain paths or tokens; discard rather than relay to WebUI/logs.
    child.stderr?.resume();
    child.on('error', () => this.#fail('PROCESS_ERROR'));
    child.stdin.on('error', () => this.#fail('WRITE_FAILED'));
    child.on('exit', () => this.#fail('DISCONNECTED'));
    this.closed = new Promise(resolve => child.once('close', () => {
      this.#fail('DISCONNECTED'); this.emit('processExit'); resolve();
    }));
  }
  get isClosed() { return this.#closed; }
  #write(message) {
    if (this.#closed) throw new ConnectionError('DISCONNECTED');
    this.#child.stdin.write(JSON.stringify(message) + '\n');
  }
  #receive(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error();
    if ('method' in message) {
      if (typeof message.method !== 'string') throw new Error();
      if ('id' in message) {
        if (!['string', 'number'].includes(typeof message.id)) throw new Error();
        const key = JSON.stringify(message.id), existing = this.#serverRequests.get(key);
        if (existing) {
          if (existing.fingerprint !== JSON.stringify(message)) throw new Error();
          if (existing.response) this.#write(existing.response);
          return;
        }
        if (this.#serverRequests.size >= 256) {
          const answered = [...this.#serverRequests].find(([, entry]) => entry.response);
          if (!answered) return this.#fail('TOO_MANY_REQUESTS');
          this.#serverRequests.delete(answered[0]);
        }
        this.#serverRequests.set(key, { fingerprint: JSON.stringify(message) });
        this.emit('request', message);
      } else this.emit('notification', message);
    } else if ('id' in message) {
      const entry = this.#pending.get(message.id);
      if (!entry) return; // late response to a timed-out call; never repeat the mutation.
      if (!message.error && !('result' in message)) throw new Error();
      clearTimeout(entry.timer); this.#pending.delete(message.id);
      if (message.error) entry.reject(new ConnectionError('RPC_ERROR'));
      else if ('result' in message) entry.resolve(message.result);
      else throw new Error();
    } else throw new Error();
  }
  request(method, params = {}) {
    if (this.#closed) return Promise.reject(new ConnectionError('DISCONNECTED'));
    const id = `tai-${++this.#next}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id); reject(new ConnectionError('RPC_TIMEOUT_UNCERTAIN'));
      }, this.timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      try { this.#write({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.#pending.delete(id); reject(error); }
    });
  }
  notify(method, params = {}) { this.#write({ method, params }); }
  respond(id, result, error) {
    const entry = this.#serverRequests.get(JSON.stringify(id));
    if (!entry || entry.response) throw new ConnectionError('REQUEST_ALREADY_RESOLVED');
    const response = error ? { id, error } : { id, result };
    this.#write(response); entry.response = response;
  }
  #fail(code) {
    if (this.#closed) return;
    this.#closed = true;
    for (const entry of this.#pending.values()) {
      clearTimeout(entry.timer); entry.reject(new ConnectionError(code));
    }
    this.#pending.clear(); this.#serverRequests.clear(); this.#buffer = '';
    this.emit('disconnect', { code });
    this.#child.kill();
  }
  close() { this.#fail('CLOSED'); return this.closed; }
}
