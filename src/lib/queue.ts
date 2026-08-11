/**
 * Durable write queue.
 *
 * The venue is a school field. Signal drops. An organiser taps "goal" and
 * nothing appears to happen, so they tap again — and without this, that is
 * a 2-0. Every write is therefore:
 *
 *   1. given a stable id up front, so a retry is a no-op server-side
 *   2. persisted before it is sent, so a dead battery loses nothing
 *   3. applied to the UI immediately, then reconciled
 *
 * Order is preserved: the queue drains oldest-first and stops on the first
 * failure, because logging a goal before the match has started would be
 * rejected by the SQL transition guard.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const KEY = 'cofta.queue.v1';
const MAX_ATTEMPTS = 8;

export interface QueuedWrite {
  id: string;            // uuid, also the idempotency key for events
  fn: string;            // rpc name
  args: Record<string, unknown>;
  queuedAt: number;
  attempts: number;
  lastError?: string;
}

type Listener = (q: QueuedWrite[]) => void;

export class WriteQueue {
  private q: QueuedWrite[] = [];
  private draining = false;
  private listeners = new Set<Listener>();

  constructor(private sb: SupabaseClient) {
    this.load();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.drain());
      setInterval(() => this.drain(), 4000);
    }
  }

  private load() {
    try { this.q = JSON.parse(localStorage.getItem(KEY) ?? '[]'); }
    catch { this.q = []; }
  }
  private persist() {
    try { localStorage.setItem(KEY, JSON.stringify(this.q)); } catch { /* full or private mode */ }
    this.listeners.forEach(l => l([...this.q]));
  }

  subscribe(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  pending() { return [...this.q]; }
  get depth() { return this.q.length; }

  /** Enqueue and try immediately. Resolves once queued, not once sent. */
  async push(w: Omit<QueuedWrite, 'queuedAt' | 'attempts'>) {
    if (this.q.some(x => x.id === w.id && x.fn === w.fn)) return; // double tap
    this.q.push({ ...w, queuedAt: Date.now(), attempts: 0 });
    this.persist();
    this.drain();
  }

  async drain(): Promise<void> {
    if (this.draining || !this.q.length) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    this.draining = true;
    try {
      while (this.q.length) {
        const w = this.q[0];
        const { error } = await this.sb.rpc(w.fn, w.args);

        if (!error) { this.q.shift(); this.persist(); continue; }

        // Stale version: the row moved on under us. Retrying blindly would
        // fight the other admin, so surface it and drop the write.
        if (error.message?.includes('stale_version')) {
          this.q.shift(); this.persist();
          this.listeners.forEach(l => l([...this.q]));
          throw new StaleVersionError(w, error.message);
        }

        // Permanent rejections: no point retrying these forever.
        if (/not_authorised|bad_transition|no_such_match|shootout_level/.test(error.message ?? '')) {
          this.q.shift(); this.persist();
          continue;
        }

        // Transient (offline, timeout). Back off and stop draining.
        w.attempts++; w.lastError = error.message;
        if (w.attempts >= MAX_ATTEMPTS) { this.q.shift(); }
        this.persist();
        break;
      }
    } finally {
      this.draining = false;
    }
  }
}

export class StaleVersionError extends Error {
  constructor(public write: QueuedWrite, msg: string) {
    super(msg); this.name = 'StaleVersionError';
  }
}
