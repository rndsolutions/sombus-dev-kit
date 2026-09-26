/**
 * raise-flag-on-match, one configured instance, as the upstream skill file (sections 5 and 6)
 * and RND's positions on what the library leaves open say:
 *
 *   P-04  a story's `skills_config.active_skills`, when present, must list this skill and version
 *   P-06  other triggers are wake-ups, evaluated against the latest snapshot
 *   P-07  never evaluate an older snapshot
 *   P-08  raise when a declaration opens or changes; nothing while it is unchanged
 *   P-09  `skill_warning_ref` is `<rule_id>/<scope>/<n>`
 *   P-10  a trigger delivered again gets the stored warning back, the same bytes
 *   P-11  nothing is published when a declaration closes
 *   P-12  a terminal story raises nothing
 *   P-14  never triggered by its own warning
 *
 * Positions: https://sombus.rnd-solutions.net/docs/skills/positions
 *
 * The executor never changes a story, an asset or a config: it only returns warnings.
 */
import { createHash } from 'node:crypto';
import { buildFollowUp, type JsonObject, type OriginatingSystem, type SomEnvelope } from '../../../sdk/typescript/src/index.js';
import { checkInstance, SKILL_ID, SKILL_VERSION, type ConfiguredInstance } from './instance.js';
import { read } from './path.js';

const TERMINAL = new Set(['KILLED', 'SPIKED', 'ARCHIVED']);

/** Where emitted warnings are kept for redelivery (P-10). In memory here; a production executor
 *  keeps them durably for the bus's 7-day idempotency window. */
export interface EmissionStore {
  get(key: string): SomEnvelope[] | undefined;
  put(key: string, messages: SomEnvelope[]): void;
}

export function memoryStore(): EmissionStore {
  const m = new Map<string, SomEnvelope[]>();
  return { get: (k) => m.get(k), put: (k, v) => void m.set(k, v) };
}

export interface ExecutorOptions {
  instance: Partial<ConfiguredInstance>;
  /** Your tool's identity; `system_id` must be one your producer app claimed. */
  originatingSystem: OriginatingSystem;
  store?: EmissionStore;
}

export interface Executor {
  /** Evaluate one delivered message. Returns the warnings to publish: none, or one. */
  deliver(message: SomEnvelope): SomEnvelope[];
}

interface Story { seq: number; snapshot: JsonObject }
interface Declaration { n: number; digest: string }

export function createExecutor(o: ExecutorOptions): Executor {
  const instance = checkInstance(o.instance);
  const store = o.store ?? memoryStore();
  const latest = new Map<string, Story>();              // story_id → latest snapshot (P-06, P-07)
  const storyOf = new Map<string, string>();            // correlation_id → story_id
  const open = new Map<string, Declaration>();          // story_id → the open declaration
  const opened = new Map<string, number>();             // story_id → how many times one opened (P-09)

  return {
    deliver(m) {
      const key = `${instance.instance_label}\n${m.message_id}`;
      const stored = store.get(key);
      if (stored) return stored;                                         // P-10

      const story = anchor(m);
      if (!story) return [];
      const { snapshot } = latest.get(story)!;
      if (!active(snapshot)) return [];                                  // P-04

      if (TERMINAL.has(String(snapshot.story_type))) { open.delete(story); return []; }  // P-12

      const warning = evaluate(snapshot);
      if (!warning) { open.delete(story); return []; }                   // closed, quietly (P-11)

      const digest = hash(JSON.stringify([warning.severity, warning.affected_fields, warning.detail]));
      const current = open.get(story);
      if (current?.digest === digest) return [];                         // unchanged (P-08)
      const n = current?.n ?? (opened.get(story) ?? 0) + 1;
      opened.set(story, n);
      open.set(story, { n, digest });

      const t = Date.parse(String(snapshot.updated_at));
      const out = buildFollowUp(m, {
        messageType: 'skill.warning.raised',
        messageId: stableUuid(Number.isNaN(t) ? Date.now() : t, ['message', key]),
        originatingSystem: o.originatingSystem,
        payload: {
          warning_id: stableUuid(Number.isNaN(t) ? Date.now() : t, ['warning', key]),
          skill_id: SKILL_ID,
          skill_version: SKILL_VERSION,
          story_id: story,
          scope: `story:${story}`,
          rule_id: instance.instance_label,
          non_overridable: false,
          blocks: [],
          skill_warning_ref: `${instance.instance_label}/story:${story}/${n}`,   // P-09
          ...warning,
        },
      });
      store.put(key, [out]);
      return [out];
    },
  };

  /** The story this message is about, having recorded it if it's a newer snapshot. */
  function anchor(m: SomEnvelope): string | undefined {
    if (m.message_type === 'story.context') {
      const story = String(m.payload.story_id);
      const seq = Number(m.payload.sequence_number);
      if ((latest.get(story)?.seq ?? 0) >= seq) return undefined;      // P-07
      latest.set(story, { seq, snapshot: m.payload });
      storyOf.set(m.correlation_id, story);
      return story;
    }
    if (m.message_type === 'skill.warning.raised') {
      // P-14: this skill doesn't recall on warnings at all, its own or anyone's.
      return undefined;
    }
    // P-06: a wake-up, against the latest snapshot we hold for the story, if any.
    return storyOf.get(m.correlation_id);
  }

  function active(snapshot: JsonObject): boolean {
    const skills = (snapshot.skills_config as JsonObject | undefined)?.active_skills;
    if (!Array.isArray(skills)) return true;
    return skills.some((s) => (s as JsonObject)?.skill_id === SKILL_ID && (s as JsonObject).skill_version === SKILL_VERSION);
  }

  /** The warning's varying fields, or undefined when the condition doesn't hold. */
  function evaluate(snapshot: JsonObject) {
    const { match_field, match_value, flag_name, clearing_authority } = instance;
    const clears = clearing_authority
      ? `Cleared by an assertion at or above ${clearing_authority} on this story.`
      : 'The configured instance names no clearing authority, so this is raised as a flag until it does.';
    const r = read(snapshot, match_field);
    if (r.kind === 'absent') return undefined;                           // the gate: exit quietly
    if (r.kind === 'unreadable') {
      return { severity: 'flag', affected_fields: [match_field], detail: `${flag_name} declared: ${match_field} could not be read, so the condition is treated as holding. ${clears}` };
    }
    if (!r.values.includes(match_value)) return undefined;
    // Fail closed on a missing clearing authority: the loudest severity this skill has.
    const severity = clearing_authority ? (instance.severity ?? 'flag') : 'flag';
    const found = r.values.length === 1 ? r.values[0] : r.values.join(', ');
    return { severity, affected_fields: [match_field], detail: `${flag_name} declared: ${match_field} reads ${found}, which matches ${match_value}. ${clears}` };
  }
}

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** A UUIDv7 that is the same every time for the same parts: time from `ms`, the rest a hash. */
export function stableUuid(ms: number, parts: string[]): string {
  const b = createHash('sha256').update(parts.join('\n')).digest().subarray(0, 16);
  for (let i = 0; i < 6; i++) b[i] = Number((BigInt(ms) >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
