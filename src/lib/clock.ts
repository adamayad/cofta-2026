/**
 * The clock, as pure maths.
 *
 * Nothing here ticks and nothing here writes. A match row carries an anchor
 * timestamp plus banked milliseconds; every phone derives the minute locally.
 * That is why hundreds of spectators cost nothing, why a refresh never loses
 * the clock, and why a phone going to sleep does not matter.
 */

export const HALF_MS = 20 * 60 * 1000; // 20-minute halves

export type MatchStatus =
  | 'scheduled' | 'first_half' | 'half_time' | 'second_half' | 'full_time';

export interface ClockState {
  status: MatchStatus;
  run: boolean;
  anchor: string | null;   // ISO timestamp from the server
  accum: number;           // banked milliseconds
}

/** Milliseconds played. `now` should already be server-corrected. */
export function elapsedMs(c: ClockState, now: number): number {
  if (!c.run || !c.anchor) return c.accum;
  return c.accum + Math.max(0, now - Date.parse(c.anchor));
}

/** "12", "20+2" — the number a spectator expects to see. */
export function minuteLabel(c: ClockState, now: number, halfMs = HALF_MS): string {
  const e = elapsedMs(c, now);
  if (c.status === 'first_half' && e > halfMs)
    return `${halfMs / 60000}+${Math.floor((e - halfMs) / 60000) + 1}`;
  if (c.status === 'second_half' && e > 2 * halfMs)
    return `${(halfMs / 60000) * 2}+${Math.floor((e - 2 * halfMs) / 60000) + 1}`;
  return String(Math.floor(e / 60000) + 1);
}

export function mmss(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** What the badge should read: "HT", "FT", "34'", or the kick-off time. */
export function displayClock(
  c: ClockState, now: number, kickoff: string, halfMs = HALF_MS
): string {
  switch (c.status) {
    case 'scheduled':  return kickoff;
    case 'half_time':  return 'HT';
    case 'full_time':  return 'FT';
    default:           return `${minuteLabel(c, now, halfMs)}'`;
  }
}

/** Which actions the organiser may take right now. Mirrors the SQL guard. */
export function allowedActions(status: MatchStatus, running: boolean): string[] {
  switch (status) {
    case 'scheduled':   return ['start'];
    case 'first_half':  return [running ? 'pause' : 'resume', 'half_time', 'full_time'];
    case 'half_time':   return ['second_half'];
    case 'second_half': return [running ? 'pause' : 'resume', 'full_time'];
    default:            return [];
  }
}
