/**
 * Phones are not synchronised. A device two minutes fast would show a
 * two-minute-wrong match clock, so we measure the offset once and correct
 * for it everywhere. Round-trip is halved out, the usual NTP trick.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

let offsetMs = 0;
let synced = false;

export async function syncServerTime(sb: SupabaseClient): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const { data, error } = await sb.rpc('server_time');
    const t1 = Date.now();
    if (error || !data) continue;
    const server = Date.parse(data as string);
    samples.push(server + (t1 - t0) / 2 - t1);
  }
  if (samples.length) {
    samples.sort((a, b) => a - b);
    offsetMs = samples[Math.floor(samples.length / 2)]; // median beats mean here
    synced = true;
  }
  return offsetMs;
}

/** Server-corrected clock. Use this everywhere instead of Date.now(). */
export const now = (): number => Date.now() + offsetMs;
export const isSynced = (): boolean => synced;
export const getOffset = (): number => offsetMs;
