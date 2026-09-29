/**
 * Deterministic ids and the day's clock.
 *
 * Every message an actor publishes is a pure function of what caused it: a beat of the day, or the
 * message it reacts to. The same cause always gives the same `message_id` and the same bytes, so a
 * beat played again, or a reaction to a redelivered message, is answered `200 duplicate` by the bus
 * and never reaches anyone twice. That is what lets a run stop at any moment and the next one carry on.
 */
import { createHash } from 'node:crypto';
import { stableUuid } from '../../executors/raise-flag-on-match/src/executor.js';

export { stableUuid };

/** A UUIDv8 (RFC 9562, custom) made from a hash of `parts`: the same parts, the same id. */
export function nameUuid(...parts: string[]): string {
  const b = createHash('sha256').update(['sombus-live-newsroom', ...parts].join('\n')).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x80;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A message id: time-ordered (UUIDv7 at `ms`), the rest from `parts`. */
export const messageUuid = (ms: number, ...parts: string[]) => stableUuid(ms, ['sombus-live-newsroom', ...parts]);

/** The story's `correlation_id`: one per story, whoever publishes about it. */
export const correlationOf = (storyId: string) => nameUuid('correlation', storyId);

/** A booked link of an asset to a destination: graphics books it, the snapshot lists it, playout ends it. */
export const linkIdOf = (storyId: string, assetId: string, destinationId: string) => nameUuid('link', storyId, assetId, destinationId);
/** The web CMS's own publication of a story, by the story's correlation id. */
export const webLinkIdOf = (correlationId: string) => nameUuid('web-link', correlationId);
/** The telling that follows a link. */
export const tellingIdOf = (linkId: string) => nameUuid('telling', linkId);

// ------------------------------------------------------------------ the day's clock

const partsFormat = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = partsFormat.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsFormat.set(tz, f);
  }
  return f;
}

function wall(ms: number, tz: string) {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second) };
}

/** How far `tz` is ahead of UTC at `ms`. */
function offsetMs(ms: number, tz: string): number {
  const w = wall(ms, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
}

/** The local date at `ms` in `tz`, `YYYY-MM-DD`. */
export function localDay(ms: number, tz: string): string {
  const w = wall(ms, tz);
  return `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
}

/** The instant of local time `hhmm` on `day` in `tz`. */
export function zonedInstant(day: string, hhmm: string, tz: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetMs(guess, tz);
  const second = guess - offsetMs(first, tz);
  return second;
}

/** The previous calendar day. */
export function dayBefore(day: string): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

export const iso = (ms: number) => new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
