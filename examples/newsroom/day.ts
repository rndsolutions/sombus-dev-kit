/**
 * The live day: what the two scripted actors play, and when, in the newsroom's local time.
 *
 * Two stories and a tip-line clip, all synthetic. The hurricane story is the published SOM 1.0
 * hurricane run (upstream/som-1.0/examples/hurricane-run), with its names made neutral and its times
 * moved onto the day; the court story is written here. One snapshot per beat.
 *
 *   06:10  mam  the tip-line clip, filed as an orphan story (source UNVERIFIED)
 *   06:45  ncs  the hurricane story breaks (sequence 1); the media store and the NCS react (2)
 *   08:35 … 12:15  ncs  the story develops (3 to 7); 7 carries the outage lower third
 *   11:40  ncs  the court story (sequence 1); media again (2)
 *   14:05  ncs  landfall, the figure confirmed (8)
 *   14:45  ncs  the court story's headline fixed (3)
 *   16:10  ncs  a correction, as a newer snapshot (9)
 *   18:10  ncs  the hurricane story is killed (10)
 *
 * Sequence 2 of each NCS story is left for the snapshot that attaches the media (a reaction). If that
 * media comes only after sequence 3 went out, the bus refuses the late snapshot as not newer: the
 * next beats carry the asset anyway.
 */
import h01 from '../../upstream/som-1.0/examples/hurricane-run/hurricane-01.json' with { type: 'json' };
import h02 from '../../upstream/som-1.0/examples/hurricane-run/hurricane-02.json' with { type: 'json' };
import h03 from '../../upstream/som-1.0/examples/hurricane-run/hurricane-03.json' with { type: 'json' };
import h04 from '../../upstream/som-1.0/examples/hurricane-run/hurricane-04.json' with { type: 'json' };
import h05 from '../../upstream/som-1.0/examples/hurricane-run/hurricane-05.json' with { type: 'json' };
import h06 from '../../upstream/som-1.0/examples/hurricane-run/hurricane-06.json' with { type: 'json' };
import h07 from '../../upstream/som-1.0/examples/hurricane-run/hurricane-07.json' with { type: 'json' };
import orphanShell from '../../upstream/som-1.0/examples/story-context/orphan-shell.json' with { type: 'json' };
import type { JsonObject } from '../../sdk/typescript/src/index.js';
import { LIVE_NEWSROOM_ID, LIVE_TIME_ZONE, liveStoryId } from './contract.js';
import { iso, linkIdOf, zonedInstant } from './ids.js';

export const HURRICANE = 'hurricane-2026-0911';
export const ORPHAN = 'orphan-2026-0911-01';
export const COURT = 'court-2026-0914';

/** The lower third's destination: the bulletin graphics books it for. */
export const BULLETIN = 'dest-one-bulletin';

export interface Beat {
  /** Local time, HH:MM, in LIVE_TIME_ZONE. */
  at: string;
  role: 'ncs' | 'mam';
  /** The story's base id; the day's tag is added at play time. */
  story: string;
  sequence: number;
  /** The snapshot, given the day's story ids and the beat's instant. */
  snapshot: (d: DayContext, instantMs: number) => JsonObject;
}

export interface DayContext {
  day: string;
  story(base: string): string;
}

export const dayContext = (day: string): DayContext => ({ day, story: (base) => liveStoryId(base, day) });

// ------------------------------------------------------------------ neutral content

/** The upstream examples name real organisations; the live newsroom is fictional throughout. */
const NEUTRAL: [RegExp, string][] = [
  [/https:\/\/wire\.ap\.org\/stories\/hurricane-xyz\.json/g, 'https://wire.example/stories/hurricane.json'],
  [/ap-som-body-json-v1/g, 'wire-body-json-v1'],
  [/src-ap-wire/g, 'src-wire'],
  [/src-fema-presser/g, 'src-agency-presser'],
  [/src-whatsapp-tip/g, 'src-tip-line'],
  [/UGC flood clip \(WhatsApp\)/g, 'Tip-line flood clip'],
  [/WhatsApp tip line/g, 'Tip line'],
  [/FEMA Director/g, 'Emergency agency director'],
  [/FEMA presser feed/g, 'Emergency agency press conference feed'],
  [/FEMA confirms/g, 'the emergency agency confirms'],
  [/\bFEMA\b/g, 'the emergency agency'],
  [/\bNHC\b/g, 'the storm centre'],
  [/^AP$/g, 'Meridian wire desk'],
  [/std-desk-jsmith/g, 'standards-desk'],
  [/tams-gcp-store/g, 'meridian-store'],
  [/nbcu-nyc/g, LIVE_NEWSROOM_ID],
  [/^com\.[a-z0-9-]+\./g, `com.${LIVE_NEWSROOM_ID}.`],
];

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * An upstream snapshot for the live day: names neutral, story ids the day's, every time moved by the
 * same amount so the snapshot's `updated_at` is `updatedMs`.
 */
function adapt(fixture: unknown, d: DayContext, updatedMs: number): JsonObject {
  const src = fixture as JsonObject;
  const shift = updatedMs - Date.parse(String(src.updated_at));
  const ids = new Map([[HURRICANE, d.story(HURRICANE)], [ORPHAN, d.story(ORPHAN)], [COURT, d.story(COURT)]]);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (ids.has(v)) return ids.get(v);
      if (TIME.test(v)) return iso(Date.parse(v) + shift);
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return iso(Date.parse(`${v}T12:00:00Z`) + shift).slice(0, 10);
      return NEUTRAL.reduce((s, [re, to]) => s.replace(re, to), v);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [NEUTRAL.reduce((s, [re, to]) => s.replace(re, to), k), walk(x)]));
    }
    return v;
  };
  const p = walk(structuredClone(src)) as JsonObject;
  p.newsroom_id = LIVE_NEWSROOM_ID;
  // A usage entry names the link graphics booked, by the id everyone derives the same way.
  for (const a of (p.assets ?? []) as JsonObject[]) {
    for (const u of (a.usage ?? []) as JsonObject[]) u.link_id = linkIdOf(String(p.story_id), String(a.asset_id), String(u.destination_id));
  }
  return p;
}

const hurricane = (fixture: unknown, seq: number, patch: (p: JsonObject) => void = () => {}) =>
  (d: DayContext, at: number): JsonObject => {
    const p = adapt(fixture, d, at);
    p.sequence_number = seq;
    patch(p);
    return p;
  };

const CORRECTED = 'Cat 4 landfall on the Gulf Coast; the emergency agency confirms 40,000 residences without power. Corrected: landfall was at 16:30 local time.';

/** The tip-line clip: an orphan story that claims to belong to the hurricane story, source unverified. */
const tipClip = (d: DayContext, at: number): JsonObject => {
  const p = adapt(orphanShell, d, at);
  (p.editorial_source as JsonObject[])[0].provider = 'Tip line';
  return p;
};

/** The court story, written for the live day. */
export const COURT_FEED = 'asset-court-steps-feed';
const court = (seq: number, headline: string) => (d: DayContext, at: number): JsonObject => ({
  story_id: d.story(COURT),
  slug: 'COURTHOUSE-STANDOFF',
  headline,
  story_type: 'ACTIVE',
  lifecycle: { phase: 'DEVELOPING', phase_entered_at: iso(zonedInstant(d.day, '11:30', LIVE_TIME_ZONE)) },
  sequence_number: seq,
  updated_at: iso(at),
  newsroom_id: LIVE_NEWSROOM_ID,
  priority: { level: 'HIGH', reason: 'court story, live coverage' },
  editorial_source: [{ source_id: 'src-court-reporter', source_type: 'FIELD_CREW', provider: 'Meridian court reporter', credibility: 'VERIFIED', received_at: iso(zonedInstant(d.day, '11:25', LIVE_TIME_ZONE)) }],
  story_meaning: {
    who: 'Police, a suspect', what: 'Arrest after a standoff at the courthouse', when: d.day, where: 'Courthouse',
    summary: 'A suspect is arrested after a standoff; one person is reported injured, unconfirmed.',
  },
  // From sequence 3 the snapshot carries the courthouse feed, whether or not it was attached at 2: a
  // snapshot may add an asset, never drop one.
  ...(seq >= 3 ? { assets: [mediaAsset(COURT_FEED, 'tams://meridian-store/c0a7e2d4', 'Courthouse steps feed')] } : {}),
});

/** An asset for media the media store announced, as the NCS attaches it. */
export function mediaAsset(assetId: string, source: string, label: string): JsonObject {
  return {
    asset_id: assetId, asset_type: 'VIDEO', status: 'READY', evidential_position: 'PRIMARY', acquisition_state: 'CAPTURED',
    media_refs: [{ source, label }],
  };
}

export const DAY: Beat[] = [
  { at: '06:10', role: 'mam', story: ORPHAN, sequence: 1, snapshot: tipClip },
  { at: '06:45', role: 'ncs', story: HURRICANE, sequence: 1, snapshot: hurricane(h01, 1) },
  { at: '08:35', role: 'ncs', story: HURRICANE, sequence: 3, snapshot: hurricane(h02, 3) },
  { at: '09:50', role: 'ncs', story: HURRICANE, sequence: 4, snapshot: hurricane(h03, 4) },
  { at: '10:30', role: 'ncs', story: HURRICANE, sequence: 5, snapshot: hurricane(h04, 5) },
  { at: '11:05', role: 'ncs', story: HURRICANE, sequence: 6, snapshot: hurricane(h05, 6) },
  { at: '11:40', role: 'ncs', story: COURT, sequence: 1, snapshot: court(1, 'Cops arrest suspect after courthouse standoff') },
  { at: '12:15', role: 'ncs', story: HURRICANE, sequence: 7, snapshot: hurricane(h06, 7) },
  { at: '14:05', role: 'ncs', story: HURRICANE, sequence: 8, snapshot: hurricane(h07, 8) },
  { at: '14:45', role: 'ncs', story: COURT, sequence: 3, snapshot: court(3, 'Police arrest suspect after courthouse standoff') },
  {
    at: '16:10', role: 'ncs', story: HURRICANE, sequence: 9,
    snapshot: hurricane(h07, 9, (p) => { p.story_meaning = { ...(p.story_meaning as JsonObject), summary: CORRECTED }; }),
  },
  {
    at: '18:10', role: 'ncs', story: HURRICANE, sequence: 10,
    snapshot: hurricane(h07, 10, (p) => { p.story_type = 'KILLED'; delete p.lifecycle; }),
  },
];

/** The NCS's stories: the ones whose media it attaches. */
export const NCS_STORIES = [...new Set(DAY.filter((b) => b.role === 'ncs').map((b) => b.story))];

/** A story's first snapshot as the NCS plays it (the base the media snapshot attaches to). */
export function firstSnapshot(base: string, d: DayContext): { beat: Beat; instant: number; payload: JsonObject } | undefined {
  const beat = DAY.find((b) => b.role === 'ncs' && b.story === base && b.sequence === 1);
  if (!beat) return undefined;
  const instant = zonedInstant(d.day, beat.at, LIVE_TIME_ZONE);
  return { beat, instant, payload: beat.snapshot(d, instant) };
}

/** The media the media store has for a story it is asked to cover. */
export function mediaFor(storyId: string): { asset_id: string; source: string; label: string; time_range: string } {
  if (storyId.startsWith(`${HURRICANE}.`)) return { asset_id: 'asset-presser-feed', source: 'tams://meridian-store/9f2e7c1a', label: 'Press conference feed', time_range: '[0:0_1260:0)' };
  if (storyId.startsWith(`${COURT}.`)) return { asset_id: COURT_FEED, source: 'tams://meridian-store/c0a7e2d4', label: 'Courthouse steps feed', time_range: '[0:0_600:0)' };
  const tag = storyId.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40);
  return { asset_id: `asset-feed-${tag}`, source: `tams://meridian-store/${tag}`, label: 'Coverage feed', time_range: '[0:0_300:0)' };
}
