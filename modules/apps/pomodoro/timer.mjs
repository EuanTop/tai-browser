const KEY = 'timer-v1';
export class PomodoroTimer {
  #sdk; #now; #state; #queue = Promise.resolve();
  constructor({ sdk, now = () => Date.now(), durationMs = 25 * 60 * 1000 }) {
    if (!Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > 86400000) throw new TypeError('Invalid duration');
    this.#sdk = sdk; this.#now = now;
    this.#state = { version:1,status:'idle',durationMs,remainingMs:durationMs,deadline:null,notificationPending:false };
  }
  #serial(fn) { const next = this.#queue.then(fn); this.#queue = next.catch(() => {}); return next; }
  async #persist(next) { await this.#sdk.storage.set(KEY,next); this.#state = next; }
  async #settle() {
    if (this.#state.status === 'running' && this.#state.deadline <= this.#now())
      await this.#persist({ ...this.#state,status:'completed',remainingMs:0,deadline:null,notificationPending:true });
    if (this.#state.notificationPending) {
      try { await this.#sdk.notify('Focus session complete'); }
      catch { return; } // Denial/failure leaves a retriable pending status.
      await this.#persist({ ...this.#state,notificationPending:false });
    }
  }
  load() {
    return this.#serial(async () => {
      const saved = await this.#sdk.storage.get(KEY);
      if (saved !== undefined && saved !== null) {
        if (saved.version !== 1 || !['idle','running','paused','completed'].includes(saved.status) ||
            !Number.isSafeInteger(saved.durationMs) || saved.durationMs < 1000 || saved.durationMs > 86400000 ||
            !Number.isFinite(saved.remainingMs) || saved.remainingMs < 0 || saved.remainingMs > saved.durationMs ||
            typeof saved.notificationPending !== 'boolean' ||
            (saved.status === 'running' ? !Number.isFinite(saved.deadline) : saved.deadline !== null)) throw new Error('Invalid saved timer');
        this.#state = structuredClone(saved);
      }
      await this.#settle(); return this.state();
    });
  }
  start() {
    return this.#serial(async () => {
      await this.#settle();
      if (this.#state.status !== 'running') {
        const remainingMs = this.#state.status === 'paused' ? this.#state.remainingMs : this.#state.durationMs;
        await this.#persist({ ...this.#state,status:'running',remainingMs,deadline:this.#now() + remainingMs,notificationPending:false });
      }
      return this.state();
    });
  }
  pause() {
    return this.#serial(async () => {
      await this.#settle();
      if (this.#state.status === 'running') await this.#persist({ ...this.#state,status:'paused',remainingMs:this.state().remainingMs,deadline:null });
      return this.state();
    });
  }
  reset() { return this.#serial(async () => { await this.#persist({ ...this.#state,status:'idle',remainingMs:this.#state.durationMs,deadline:null,notificationPending:false }); return this.state(); }); }
  resume() { return this.#serial(async () => { await this.#settle(); return this.state(); }); }
  state() { return { ...this.#state,remainingMs:this.#state.status === 'running' ? Math.max(0,Math.min(this.#state.durationMs,this.#state.deadline - this.#now())) : this.#state.remainingMs }; }
}
