/**
 * The only way the app writes anything.
 *
 * Clock changes carry the version the client believed it was acting on. If
 * another organiser has moved the match on, the server rejects the write
 * rather than overwriting them, and we refetch instead of guessing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { WriteQueue } from './queue';
import { elapsedMs, minuteLabel, HALF_MS, type ClockState } from './clock';
import { now } from './serverTime';

const uuid = () =>
  (crypto.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`);

export type ClockAction =
  'start' | 'pause' | 'resume' | 'half_time' | 'second_half' | 'full_time';

export class MatchApi {
  readonly queue: WriteQueue;
  constructor(private sb: SupabaseClient) { this.queue = new WriteQueue(sb); }

  /**
   * Clock actions are NOT queued offline. A "half time" that lands ten
   * minutes late would bank the wrong elapsed time, because the server
   * stamps now() when it runs. Better to fail loudly and let the organiser
   * retry than to write a silently wrong clock.
   */
  async clock(matchId: string, action: ClockAction, expectedVersion: number) {
    const { data, error } = await this.sb.rpc('set_clock', {
      p_match: matchId,
      p_action: action,
      p_expected_version: expectedVersion,
      p_half_ms: HALF_MS,
    });
    if (error) {
      if (error.message?.includes('stale_version')) {
        throw new Error('Someone else is running this match. Refreshing.');
      }
      throw error;
    }
    return data;
  }

  /** Events ARE queued: a goal is still a goal whenever it syncs. */
  async logEvent(opts: {
    matchId: string;
    type: 'goal' | 'own_goal' | 'yellow' | 'red' | 'motm' | 'note';
    side?: 'home' | 'away';
    playerId?: string | null;
    clock: ClockState;
  }) {
    const id = uuid();
    const ms = elapsedMs(opts.clock, now());
    await this.queue.push({
      id,
      fn: 'log_event',
      args: {
        p_id: id,
        p_match: opts.matchId,
        p_type: opts.type,
        p_side: opts.side ?? null,
        p_player: opts.playerId ?? null,
        p_elapsed: ms,
        p_minute: minuteLabel(opts.clock, now()),
      },
    });
    return id; // optimistic UI uses this, and undo needs it
  }

  async undo(eventId: string) {
    await this.queue.push({ id: uuid(), fn: 'void_event', args: { p_id: eventId } });
  }

  async shootout(matchId: string, home: number, away: number, decided: boolean) {
    const { error } = await this.sb.rpc('set_shootout', {
      p_match: matchId, p_home: home, p_away: away, p_decided: decided,
    });
    if (error) throw error;
  }

  async forfeit(matchId: string, side: 'home' | 'away' | null) {
    const { error } = await this.sb.rpc('set_forfeit', { p_match: matchId, p_side: side });
    if (error) throw error;
  }

  async disqualify(teamId: string, value: boolean) {
    const { error } = await this.sb.rpc('set_disqualified', { p_team: teamId, p_value: value });
    if (error) throw error;
  }

  async setSlot(slot: string, teamId: string | null) {
    const { error } = await this.sb.rpc('set_slot', { p_slot: slot, p_team: teamId });
    if (error) throw error;
  }
}
