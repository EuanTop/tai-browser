import { EventEmitter } from 'node:events';
import { assertScope } from '../../contracts/v1/index.mjs';

const approvalMethods = new Set(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval']);
const clone = value => structuredClone(value);
const requiredId = id => { if (typeof id !== 'string' || !id) throw new TypeError('Missing provider ID'); return id; };

/** One owner, fixed task scope, no planner, no model loop, no automatic resume/retry. */
export class CodexSession extends EventEmitter {
  #rpc; #items = new Map(); #approvals = new Map(); #release; #acquire; #busy = false;
  #threadId; #turnId; #lastTurn; #endedTurns = new Set(); #binding; #state = 'disconnected';
  constructor(rpc, binding, { acquireThreadLease }) {
    super(); assertScope(binding);
    if (!binding.taskId || typeof acquireThreadLease !== 'function') throw new TypeError('Task binding and host lease required');
    this.#rpc = rpc; this.#binding = Object.freeze(clone(binding)); this.#acquire = acquireThreadLease;
    rpc.on('notification', event => this.#notification(event));
    rpc.on('request', request => this.#request(request));
    rpc.on('disconnect', () => {
      this.#state = 'disconnected'; this.#approvals.clear(); this.#emit();
    });
    // Do not grant another writer while our owned process may still be alive.
    rpc.on('processExit', () => { this.#release?.(); this.#release = undefined; });
  }
  get snapshot() {
    return clone({ channel: 'codex-app-server', state: this.#state, binding: this.#binding,
      threadId: this.#threadId, turnId: this.#turnId, lastTurn: this.#lastTurn, capabilities: {
        resume: true, liveAttach: false, concurrentWriters: false, schedules: false,
      }, items: [...this.#items.values()], approvals: [...this.#approvals.values()] });
  }
  #emit() { this.emit('change', this.snapshot); }
  async initialize() {
    if (this.#state !== 'disconnected' || this.#busy) throw new Error('Already initialized');
    this.#busy = true;
    try {
      await this.#rpc.request('initialize', { clientInfo: { name: 'tai_browser', title: 'TAi Browser', version: '0.1.0' } });
      this.#rpc.notify('initialized'); this.#state = 'ready'; this.#emit();
    } finally { this.#busy = false; }
  }
  async listThreads(cursor) {
    if (this.#state === 'disconnected') throw new Error('Disconnected');
    return this.#rpc.request('thread/list', { limit: 30, ...(cursor ? { cursor } : {}) });
  }
  async open({ threadId, takeover = false, settings = {} } = {}) {
    if (this.#busy || this.#state !== 'ready') throw new Error('Session already bound or not ready');
    if (threadId && !takeover) throw new Error('Explicit takeover required; resume is not live attach');
    // Host supplies configuration only. Do not accept permission/model overrides in WebUI messages.
    const allowed = ['cwd', 'model'];
    if (Object.keys(settings).some(key => !allowed.includes(key))) throw new TypeError('Unsupported session setting');
    this.#busy = true; let requestStarted = false;
    try {
      if (threadId) { requiredId(threadId); this.#release = await this.#acquire(threadId, this.#binding); }
      if (threadId && typeof this.#release !== 'function') throw new Error('Host lease refused');
      requestStarted = true;
      const response = await this.#rpc.request(threadId ? 'thread/resume' : 'thread/start',
        threadId ? { threadId, excludeTurns: true, ...settings } : settings);
      const id = requiredId(response.thread?.id);
      if (threadId && id !== threadId) throw new Error('Provider changed thread identity');
      if (!threadId) this.#release = await this.#acquire(id, this.#binding);
      if (typeof this.#release !== 'function') throw new Error('Host lease refused');
      if (this.#rpc.isClosed) {
        await this.#rpc.closed; this.#release?.(); this.#release = undefined;
        throw new Error('Disconnected during thread lease acquisition');
      }
      this.#threadId = id; this.#state = threadId ? 'resumed' : 'idle';
      this.#items.clear(); this.#approvals.clear(); this.#emit();
      return { threadId: id, sessionId: response.thread.sessionId, mode: threadId ? 'takeover' : 'new' };
    } catch (error) {
      // Failed/ambiguous start or resume must not allow a second writer or implicit fresh thread.
      if (requestStarted) this.#rpc.close();
      else { this.#release?.(); this.#release = undefined; }
      throw error;
    }
    finally { this.#busy = false; }
  }
  async history(cursor) {
    if (!this.#threadId || this.#state === 'disconnected') throw new Error('No connected thread');
    // History remains a separate page, never emitted as new live events.
    return this.#rpc.request('thread/turns/list', {
      threadId: this.#threadId, limit: 10, sortDirection: 'desc', itemsView: 'full', ...(cursor ? { cursor } : {}),
    });
  }
  async send(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 64000) throw new TypeError('Invalid message');
    if (this.#busy || !['idle', 'resumed'].includes(this.#state)) throw new Error('Thread is not idle');
    this.#busy = true; this.#state = 'starting'; this.#emit();
    try {
      const result = await this.#rpc.request('turn/start', { threadId: this.#threadId, input: [{ type: 'text', text }] });
      const id = requiredId(result.turn?.id);
      // A fast turn can complete before the start response arrives.
      if (!this.#endedTurns.has(id)) { this.#turnId = id; this.#state = this.#approvals.size ? 'awaiting-approval' : 'running'; }
      this.#emit(); return id;
    } catch (error) {
      // Delivery may have succeeded: require explicit reconciliation, never auto retry.
      if (this.#state !== 'disconnected') this.#state = 'uncertain'; this.#emit(); throw error;
    } finally { this.#busy = false; }
  }
  async cancel() {
    if (!this.#turnId || !['running', 'awaiting-approval'].includes(this.#state)) throw new Error('No active turn');
    const turnId = this.#turnId;
    this.#state = 'stopping'; this.#emit();
    try { await this.#rpc.request('turn/interrupt', { threadId: this.#threadId, turnId }); }
    catch (error) {
      if (!this.#endedTurns.has(turnId) && this.#state !== 'disconnected') this.#state = 'uncertain';
      this.#emit(); throw error;
    }
    // Cancellation acknowledged is not completed: wait for turn/completed.
    if (!this.#endedTurns.has(turnId)) this.#state = 'stopping';
    this.#emit();
  }
  approve(requestId, decision) {
    if (!['accept', 'decline', 'cancel'].includes(decision)) throw new TypeError('Unsupported approval decision');
    const key = JSON.stringify(requestId), approval = this.#approvals.get(key);
    if (!approval || approval.turnId !== this.#turnId || this.#state !== 'awaiting-approval') throw new Error('Expired approval');
    if (approval.availableDecisions && !approval.availableDecisions.includes(decision)) throw new Error('Decision unavailable');
    this.#rpc.respond(requestId, { decision }); this.#approvals.delete(key);
    this.#state = this.#approvals.size ? 'awaiting-approval' : 'running'; this.#emit();
  }
  #request({ id, method, params = {} }) {
    if (!approvalMethods.has(method) || params.threadId !== this.#threadId ||
        !params.turnId || this.#endedTurns.has(params.turnId) ||
        (this.#turnId && this.#turnId !== params.turnId)) {
      this.#rpc.respond(id, undefined, { code: -32601, message: 'Unsupported or out-of-scope request' }); return;
    }
    this.#turnId = params.turnId;
    this.#approvals.set(JSON.stringify(id), { ...clone(params), requestId: id, kind: method });
    this.#state = 'awaiting-approval'; this.#emit();
  }
  #notification({ method, params = {} }) {
    if (!this.#threadId || params.threadId !== this.#threadId) return;
    const turnId = params.turnId ?? params.turn?.id;
    if (method === 'turn/completed' && turnId) {
      if (!['completed','failed','interrupted'].includes(params.turn?.status)) return;
      this.#lastTurn = { id: turnId, status: params.turn.status };
      this.#endedTurns.add(turnId);
      if (this.#endedTurns.size > 256) this.#endedTurns.delete(this.#endedTurns.values().next().value);
      for (const [key, value] of this.#approvals) if (value.turnId === turnId) this.#approvals.delete(key);
      if (!this.#turnId || this.#turnId === turnId) { this.#turnId = undefined; this.#state = 'idle'; }
    } else if (method === 'turn/started' && turnId && !this.#endedTurns.has(turnId)) {
      if (this.#turnId && this.#turnId !== turnId) return;
      this.#turnId = turnId; this.#state = this.#approvals.size ? 'awaiting-approval' : 'running';
    } else if (method === 'serverRequest/resolved') {
      this.#approvals.delete(JSON.stringify(params.requestId));
      if (this.#state === 'awaiting-approval' && !this.#approvals.size) this.#state = 'running';
    } else if ((method === 'item/started' || method === 'item/completed') && params.item?.id) {
      const key = `${turnId}:${params.item.id}`, previous = this.#items.get(key);
      if (!previous?.final) this.#items.set(key, { ...clone(params.item), turnId,
        ...(method === 'item/started' && previous?.text ? { text: previous.text } : {}),
        final: method === 'item/completed' });
    } else if (method === 'item/agentMessage/delta' && params.itemId && typeof params.delta === 'string') {
      const key = `${turnId}:${params.itemId}`, previous = this.#items.get(key);
      if (!previous?.final) this.#items.set(key, { ...previous, id: params.itemId, turnId,
        type: 'agentMessage', text: (previous?.text ?? '') + params.delta, final: false });
    } else return;
    if (this.#items.size > 500) this.#items.delete(this.#items.keys().next().value);
    this.#emit();
  }
  close() { return this.#rpc.close(); }
}
