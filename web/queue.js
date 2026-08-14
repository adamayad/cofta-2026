/**
 * COFTA 2026 — durable write queue
 *
 * The venue is a school field. Signal drops. An organiser taps "goal", nothing
 * visibly happens, so they tap again — and without this, that is a 2-0.
 *
 * Every queued write is:
 *   1. given a stable id before sending, so a retry is a no-op server-side
 *   2. written to storage before it is sent, so a dead battery loses nothing
 *   3. drained oldest-first, because order matters (a goal cannot be logged
 *      before the match has started, and the SQL guard would reject it)
 *
 * Clock actions are deliberately NOT queued — see matchApi. The server stamps
 * now() when the write lands, so a half-time syncing ten minutes late would
 * bank ten minutes of football that never happened.
 */

const KEY = 'cofta.queue.v1';
const MAX_ATTEMPTS = 10;

/** Errors that will never succeed on retry, so the write is dropped. */
const PERMANENT = /not_authorised|bad_transition|no_such_match|shootout_level|no_shootout_in_groups|bad_side|no_such_event|squad_full|bad_minute/;

export class WriteQueue {
  constructor(send) {
    this.send = send;                 // async (fn, args) => result
    this.q = this.#load();
    this.draining = false;
    this.listeners = new Set();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.drain());
      setInterval(() => this.drain(), 4000);
    }
  }

  #load() {
    try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); }
    catch { return []; }
  }
  #save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.q)); } catch { /* private mode / full */ }
    this.listeners.forEach(l => l(this.status()));
  }

  subscribe(l) { this.listeners.add(l); l(this.status()); return () => this.listeners.delete(l); }

  status() {
    return {
      depth: this.q.length,
      oldest: this.q[0]?.queuedAt ?? null,
      failing: this.q[0]?.attempts >= 3,
      lastError: this.q[0]?.lastError ?? null,
    };
  }

  /** Queue a write and try immediately. Resolves once queued, not once sent. */
  add(id, fn, args) {
    if (this.q.some(w => w.id === id && w.fn === fn)) return;   // double tap
    this.q.push({ id, fn, args, queuedAt: Date.now(), attempts: 0 });
    this.#save();
    this.drain();
  }

  async drain() {
    if (this.draining || !this.q.length) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    this.draining = true;
    try {
      while (this.q.length) {
        const w = this.q[0];
        try {
          await this.send(w.fn, w.args);
          this.q.shift();
          this.#save();
        } catch (e) {
          const msg = e?.message ?? String(e);

          if (PERMANENT.test(msg)) {
            // Will never succeed. Drop it rather than blocking everything behind it.
            this.q.shift(); this.#save();
            continue;
          }

          // Transient: offline, timeout, 5xx. Back off and stop draining so
          // ordering is preserved.
          w.attempts++;
          w.lastError = msg;
          if (w.attempts >= MAX_ATTEMPTS) this.q.shift();
          this.#save();
          break;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  /** Used by the UI to show unsent goals optimistically. */
  pendingFor(matchId) {
    return this.q.filter(w => w.fn === 'log_event' && w.args.p_match === matchId);
  }

  clear() { this.q = []; this.#save(); }
}
