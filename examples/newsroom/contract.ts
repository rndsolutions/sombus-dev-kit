/**
 * The live newsroom's contract, typed: spec/live-newsroom.json is the data, this module the shapes.
 *
 * - One actor per role. Only ncs and mam start anything (`trigger`); every other actor only reacts to
 *   what its consumer connection receives, so what a viewer sees is a real chain through the bus:
 *   publish, route, pull, react, acknowledge.
 * - Each actor holds an ordinary producer connection (grants: LIVE_GRANTS[role]) and, when it reacts
 *   to anything, an ordinary consumer connection (message types: LIVE_RECEIVES[role]).
 * - Its traffic is marked by what it carries: story ids end in `.demo-live-<yyyymmdd>`, and snapshots
 *   carry `newsroom_id: 'demo'`.
 * - Before every beat and reaction an actor asks the bus who holds its role (LIVE_ROLES_PATH, with its
 *   own token), and stays silent in a role a real system holds.
 */
import spec from '../../spec/live-newsroom.json' with { type: 'json' };
import type { SystemType } from '../../sdk/typescript/src/index.js';

export const LIVE_ROLES = ['ncs', 'mam', 'skill', 'graphics', 'standards', 'playout', 'cms', 'automation'] as const;
export type LiveRole = (typeof LIVE_ROLES)[number];

export interface LiveReaction {
  /** The message type received. */
  on: string;
  /** When it reacts, in words. */
  when: string;
  /** What it publishes in response, each within LIVE_GRANTS[role]. */
  publishes: string[];
}

export interface LiveActor {
  role: LiveRole;
  /** What this actor starts on its own clock. Absent: it only reacts. */
  trigger?: { what: string; publishes: string[] };
  reactions: LiveReaction[];
}

export const LIVE_CONTRACT_VERSION: number = spec.version;
/** The payloads' `newsroom_id`. */
export const LIVE_NEWSROOM_ID: string = spec.newsroom_id;
/** The day's clock: beat times are local to it. */
export const LIVE_TIME_ZONE: string = spec.time_zone;
/** The bus API path an actor reads who holds each role from, with its own bearer token. */
export const LIVE_ROLES_PATH: string = spec.roles_path;

export const LIVE_APPS = spec.apps as Record<LiveRole, string>;
export const LIVE_SYSTEM_TYPES = spec.system_types as Record<LiveRole, SystemType>;
export const LIVE_GRANTS = spec.grants as Record<LiveRole, string[]>;
export const LIVE_ACTORS = spec.actors as LiveActor[];

/** What each actor's consumer connection receives; empty: it needs none. */
export const LIVE_RECEIVES: Record<LiveRole, string[]> = Object.fromEntries(
  LIVE_ACTORS.map((a) => [a.role, [...new Set(a.reactions.map((r) => r.on))].sort()]),
) as Record<LiveRole, string[]>;

/** Whether `grants` (exact types, or `family.*`) allow `messageType`. */
export const granted = (grants: string[], messageType: string) =>
  grants.some((g) => g === messageType || g === '*' || (g.endsWith('.*') && messageType.startsWith(g.slice(0, -1))));

/** The story-id tag of a live day: `demo-live-<yyyymmdd>`. */
export function liveTag(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`bad live day: ${day}`);
  return `demo-live-${day.replace(/-/g, '')}`;
}

/** A story of the live day: `<story>.demo-live-<yyyymmdd>`. */
export const liveStoryId = (base: string, day: string) => `${base}.${liveTag(day)}`;
export const isLiveStory = (storyId: string) => /\.demo-live-\d{8}$/.test(storyId);

/** Who holds each role in a house. 'actor': the live actor plays it. 'real': a real connection does, and the actor is silent. */
export type LiveRoleHolder = 'actor' | 'real';
export interface LiveRolesView {
  house: string;
  roles: Partial<Record<LiveRole, { held_by: LiveRoleHolder; connection_id?: string }>>;
}
