/**
 * raise-flag-on-match against the published SOM 1.0 examples: the skill harness's cases, the
 * upstream eval set (section 9) where it applies without clearance, and every warning validated
 * against the pinned SOM 1.0 schemas.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buildEnvelope, type JsonObject, type SomEnvelope } from '../../../sdk/typescript/src/index.js';
import { createExecutor } from '../src/executor.js';
import { read } from '../src/path.js';
import type { ConfiguredInstance } from '../src/instance.js';

const UP = join(import.meta.dirname, '..', '..', '..', 'upstream', 'som-1.0');
const json = (p: string) => JSON.parse(readFileSync(join(UP, p), 'utf8'));
const HURRICANE: JsonObject[] = readdirSync(join(UP, 'examples', 'hurricane-run')).sort().map((f) => json(`examples/hurricane-run/${f}`));
const ORPHAN: JsonObject = json('examples/story-context/orphan-shell.json');
const INSTANCE: ConfiguredInstance = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'instances', 'house-breaking-indicative-category.json'), 'utf8'));

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
for (const f of readdirSync(join(UP, 'schema'))) ajv.addSchema(json(`schema/${f}`));
const envelopeSchema = json('schema/envelope.schema.json');
const warningSchema = json('schema/skill-warning.schema.json');
const validEnvelope = ajv.getSchema(envelopeSchema.$id)!;
const validWarning = ajv.getSchema(warningSchema.$id)!;

const SYSTEM = { system_id: 'acme-flags-01', system_type: 'ncs' } as const;
const PRODUCER = { system_id: 'acme-ncs-01', system_type: 'ncs' } as const;

/** Envelopes for one story, in order, as a producer would publish them. */
function story(payloads: JsonObject[]): SomEnvelope[] {
  const first = buildEnvelope({ messageType: 'story.context', payload: payloads[0], originatingSystem: PRODUCER });
  return [first, ...payloads.slice(1).map((p) => buildEnvelope({ messageType: 'story.context', payload: p, originatingSystem: PRODUCER, correlationId: first.correlation_id }))];
}

function run(instance: Partial<ConfiguredInstance>, messages: SomEnvelope[]) {
  const ex = createExecutor({ instance, originatingSystem: SYSTEM });
  return messages.map((m) => ex.deliver(m));
}

const at = (i: number, patch: JsonObject) => ({ ...HURRICANE[i], ...patch });

describe('raise-flag-on-match: skill harness cases', () => {
  it('hurricane: DEVELOPING, then BREAKING from snapshot 2: one warning, on snapshot 2', () => {
    const msgs = story(HURRICANE);
    const out = run(INSTANCE, msgs);
    expect(out.map((o) => o.length)).toEqual([0, 1, 0, 0, 0, 0, 0]);
    const w = out[1][0];
    expect(w.causation_id).toBe(msgs[1].message_id);
    expect(w.correlation_id).toBe(msgs[1].correlation_id);
    expect(w.originating_system).toEqual(SYSTEM);
    expect(w.payload).toMatchObject({
      skill_id: 'smart-stories/raise-flag-on-match', skill_version: '0.2.2', story_id: 'hurricane-2026-0911',
      scope: 'story:hurricane-2026-0911', severity: 'flag', rule_id: 'house-breaking-indicative-category',
      non_overridable: false, affected_fields: ['lifecycle.phase'], blocks: [],
      skill_warning_ref: 'house-breaking-indicative-category/story:hurricane-2026-0911/1',
    });
    expect(w.payload.detail).toBe('indicative-category declared: lifecycle.phase reads BREAKING, which matches BREAKING. Cleared by an assertion at or above duty-editor on this story.');
  });

  it('killed: a BREAKING snapshot, then the story KILLED: one warning, on the first', () => {
    const out = run(INSTANCE, story([HURRICANE[1], at(2, { story_type: 'KILLED' })]));
    expect(out.map((o) => o.length)).toEqual([1, 0]);
  });

  it('telling: a BREAKING snapshot, then telling.started: one warning, on the snapshot', () => {
    const [snap] = story([HURRICANE[1]]);
    const telling = buildEnvelope({ messageType: 'telling.started', payload: json('examples/telling/started.json'), originatingSystem: PRODUCER, correlationId: snap.correlation_id });
    expect(run(INSTANCE, [snap, telling]).map((o) => o.length)).toEqual([1, 0]);
  });

  it('redelivery: the same trigger again gives back the same warning, byte for byte', () => {
    const ex = createExecutor({ instance: INSTANCE, originatingSystem: SYSTEM });
    const msgs = story(HURRICANE.slice(0, 2));
    ex.deliver(msgs[0]);
    const first = ex.deliver(msgs[1]);
    expect(JSON.stringify(ex.deliver(msgs[1]))).toBe(JSON.stringify(first));
  });

  it('orphan shell, with or without an unknown extension or a 1.1.0 producer: no warning', () => {
    const plain = story([ORPHAN]);
    const ext = buildEnvelope({ messageType: 'story.context', payload: ORPHAN, originatingSystem: PRODUCER, extensions: { 'com.nobody.x': { y: 1 } } });
    const v11 = { ...buildEnvelope({ messageType: 'story.context', payload: { ...ORPHAN, story_id: 'orphan-b', some_1_1_field: 'x' }, originatingSystem: PRODUCER }), som_version: '1.1.0' };
    expect(run(INSTANCE, [...plain, ext, v11]).flat()).toEqual([]);
  });
});

describe('raise-flag-on-match: positions and the upstream eval set', () => {
  it('closes quietly when the field stops matching, and reopens as a new declaration (P-08, P-09, P-11)', () => {
    const out = run(INSTANCE, story([HURRICANE[1], at(2, { lifecycle: { ...(HURRICANE[2].lifecycle as JsonObject), phase: 'DEVELOPING' } }), HURRICANE[3]]));
    expect(out.map((o) => o.length)).toEqual([1, 0, 1]);
    expect(out[2][0].payload.skill_warning_ref).toBe('house-breaking-indicative-category/story:hurricane-2026-0911/2');
  });

  it('never evaluates an older snapshot (P-07)', () => {
    const msgs = story([HURRICANE[0], HURRICANE[2], HURRICANE[1]]);
    expect(run(INSTANCE, msgs).map((o) => o.length)).toEqual([0, 1, 0]);
  });

  it("isn't triggered by warnings, its own or another's (P-14)", () => {
    const ex = createExecutor({ instance: INSTANCE, originatingSystem: SYSTEM });
    const [w] = ex.deliver(story([HURRICANE[1]])[0]);
    expect(ex.deliver(w)).toEqual([]);
  });

  it("skips a story whose active_skills don't list this skill and version (P-04)", () => {
    const other = { active_skills: [{ skill_id: 'smart-stories/gate-by-scope', skill_version: '0.2.2', skill_type: 'REFERENCE' }] };
    const listed = { active_skills: [{ skill_id: 'smart-stories/raise-flag-on-match', skill_version: '0.2.2', skill_type: 'REFERENCE' }] };
    expect(run(INSTANCE, story([at(1, { skills_config: other })])).flat()).toEqual([]);
    expect(run(INSTANCE, story([at(1, { skills_config: listed })])).flat()).toHaveLength(1);
  });

  it('non declaring: the field reads another value, or is absent: nothing at all', () => {
    expect(run(INSTANCE, story([HURRICANE[0]])).flat()).toEqual([]);
    const { lifecycle: _, ...absent } = HURRICANE[1];
    expect(run(INSTANCE, story([absent])).flat()).toEqual([]);
  });

  it('watches any element of an array path', () => {
    const inst = { instance_label: 'house-unverified-source', match_field: 'editorial_source[].credibility', match_value: 'UNVERIFIED', flag_name: 'UNVERIFIED', clearing_authority: 'output-editor' };
    const src = [{ source_id: 'wire', credibility: 'TRUSTED' }, { source_id: 'social', credibility: 'UNVERIFIED' }];
    const [[w]] = run(inst, story([at(1, { editorial_source: src })]));
    expect(w.payload.detail).toContain('editorial_source[].credibility reads TRUSTED, UNVERIFIED, which matches UNVERIFIED');
  });

  it('fail closed: a watched value that is there but unreadable raises a flag saying so', () => {
    const [[w]] = run({ ...INSTANCE, severity: 'inform' }, story([at(1, { lifecycle: 'BREAKING' })]));
    expect(w.payload.severity).toBe('flag');
    expect(w.payload.detail).toContain('lifecycle.phase could not be read');
  });

  it('fail closed: no clearing authority raises at flag even when configured inform', () => {
    const { clearing_authority: _, ...inst } = INSTANCE;
    const [, [w]] = run({ ...inst, severity: 'inform' }, story(HURRICANE.slice(0, 2)));
    expect(w.payload.severity).toBe('flag');
    expect(w.payload.detail).toContain('names no clearing authority');
  });

  it('refuses a configured instance that cannot name its warning', () => {
    expect(() => createExecutor({ instance: { ...INSTANCE, flag_name: '' }, originatingSystem: SYSTEM })).toThrow(/flag_name/);
    expect(() => createExecutor({ instance: { ...INSTANCE, severity: 'hold' as never }, originatingSystem: SYSTEM })).toThrow(/severity/);
  });

  it('never auto-change: the story it read is untouched', () => {
    const msgs = story(HURRICANE);
    const before = JSON.stringify(msgs);
    run(INSTANCE, msgs);
    expect(JSON.stringify(msgs)).toBe(before);
  });

  it('every warning validates against the SOM 1.0 envelope and skill-warning schemas', () => {
    const outs = [
      ...run(INSTANCE, story(HURRICANE)).flat(),
      ...run({ ...INSTANCE, severity: 'inform' }, story([at(1, { lifecycle: 'BREAKING' })])).flat(),
    ];
    expect(outs.length).toBeGreaterThan(1);
    for (const w of outs) {
      expect(validEnvelope(w), JSON.stringify(validEnvelope.errors)).toBe(true);
      expect(validWarning(w.payload), JSON.stringify(validWarning.errors)).toBe(true);
    }
  });
});

describe('path reading', () => {
  it('tells absent from unreadable', () => {
    expect(read({ a: { b: 'x' } }, 'a.b')).toEqual({ kind: 'values', values: ['x'] });
    expect(read({ a: {} }, 'a.b')).toEqual({ kind: 'absent' });
    expect(read({ a: [] }, 'a[].b')).toEqual({ kind: 'absent' });
    expect(read({ a: 'x' }, 'a.b')).toEqual({ kind: 'unreadable' });
    expect(read({ a: { b: { c: 1 } } }, 'a.b')).toEqual({ kind: 'unreadable' });
    expect(read({ a: { b: 1 } }, 'a[].b')).toEqual({ kind: 'unreadable' });
  });
});
