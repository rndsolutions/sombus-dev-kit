/**
 * The live newsroom against a bus in memory (./fake-bus.ts): the contract (spec/live-newsroom.json)
 * kept, every message valid against the pinned SOM 1.0 schemas, the day's chain complete, bounded
 * runs that never replay a beat, and actors standing down for a real system.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { JsonObject, SomEnvelope } from '../../../sdk/typescript/src/index.js';
import {
  DAY, LIVE_ACTORS, LIVE_GRANTS, LIVE_RECEIVES, LIVE_ROLES, createActor, granted, isLiveStory, liveTag, runNewsroom,
  type LiveRole, type NewsroomReport, type RoleConfig,
} from '../index.js';
import { localDay, zonedInstant } from '../ids.js';
import { FakeBus, TENANT, schemaErrors } from './fake-bus.js';

const TZ = 'Europe/London';
const DAY_ID = '2026-09-29';
const at = (hhmm: string, day = DAY_ID) => zonedInstant(day, hhmm, TZ);

function house(roles: readonly LiveRole[] = LIVE_ROLES, bus = new FakeBus()) {
  const cfg: Partial<Record<LiveRole, RoleConfig>> = {};
  for (const role of roles) {
    if (!bus.connections.has(`p-${role}`)) bus.producer(`p-${role}`, `meridian-live-${role}`, LIVE_GRANTS[role]);
    const c: RoleConfig = { producer: { client_id: `p-${role}`, client_secret: `p-${role}-secret` } };
    if (LIVE_RECEIVES[role].length) {
      if (!bus.connections.has(`c-${role}`)) bus.consumer(`c-${role}`, LIVE_RECEIVES[role]);
      c.consumer = { client_id: `c-${role}`, client_secret: `c-${role}-secret` };
    }
    cfg[role] = c;
  }
  return { bus, roles: cfg };
}

const run = (bus: FakeBus, roles: Partial<Record<LiveRole, RoleConfig>>, nowMs: number, stopAfterMs = 4000): Promise<NewsroomReport> =>
  runNewsroom({ apiUrl: 'https://bus.test/v1', tokenUrl: 'https://bus.test/v1/oauth/token', roles, now: () => nowMs, stopAfterMs, catchUpGapMs: 150, fetch: bus.fetch });

const byRole = (bus: FakeBus, role: LiveRole) => bus.accepted.filter((p) => p.producer === `p-${role}`).map((p) => p.envelope);
const snapshots = (bus: FakeBus, base: string) => bus.accepted
  .filter((p) => p.envelope.message_type === 'story.context' && String((p.envelope.payload as JsonObject).story_id).startsWith(`${base}.`))
  .map((p) => (p.envelope.payload as JsonObject).sequence_number);
const types = (es: SomEnvelope[]) => es.map((e) => e.message_type).sort();

describe('the contract', () => {
  const spec = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'spec', 'live-newsroom.json'), 'utf8'));

  it('names the eight roles, each app said to be live, with a grant for everything it publishes', () => {
    expect(spec.roles).toEqual([...LIVE_ROLES]);
    expect(LIVE_ACTORS.map((a) => a.role).sort()).toEqual([...LIVE_ROLES].sort());
    for (const r of LIVE_ROLES) expect(spec.apps[r]).toMatch(/live/);
    for (const a of LIVE_ACTORS) {
      for (const t of [...(a.trigger?.publishes ?? []), ...a.reactions.flatMap((r) => r.publishes)]) {
        expect(granted(LIVE_GRANTS[a.role], t), `${a.role} publishes ${t}`).toBe(true);
      }
    }
  });

  it('scripts only the source systems, and every type received is published by some actor', () => {
    expect(LIVE_ACTORS.filter((a) => a.trigger).map((a) => a.role).sort()).toEqual(['mam', 'ncs']);
    const published = new Set(LIVE_ACTORS.flatMap((a) => [...(a.trigger?.publishes ?? []), ...a.reactions.flatMap((r) => r.publishes)]));
    for (const r of LIVE_ROLES) for (const t of LIVE_RECEIVES[r]) expect(published.has(t), `${r} receives ${t}`).toBe(true);
    expect(LIVE_RECEIVES.standards).toEqual(['link.committed']);
    expect(LIVE_RECEIVES.playout).toEqual(['link.gate_changed', 'story.context']);
  });

  it('tags a live day', () => {
    expect(liveTag(DAY_ID)).toBe('demo-live-20260929');
    expect(isLiveStory('hurricane-2026-0911.demo-live-20260929')).toBe(true);
    expect(() => liveTag('29/09/2026')).toThrow();
  });

  it('plays beats between 06:10 and 18:10 local, the scripted roles only', () => {
    expect(DAY[0].at).toBe('06:10');
    expect(DAY.at(-1)!.at).toBe('18:10');
    expect(new Set(DAY.map((b) => b.role))).toEqual(new Set(['ncs', 'mam']));
    expect(at('06:10')).toBe(Date.parse('2026-09-29T05:10:00Z'));            // BST
    expect(at('06:10', '2026-12-01')).toBe(Date.parse('2026-12-01T06:10:00Z')); // GMT
    expect(localDay(Date.parse('2026-09-29T23:30:00Z'), TZ)).toBe('2026-09-30');
  });

  it('builds a beat as the same bytes every time', () => {
    const a = createActor({ role: 'ncs', systemId: 'x-ncs', now: () => at('12:00') });
    const b = createActor({ role: 'ncs', systemId: 'x-ncs', now: () => at('13:00') });
    for (const beat of a.beats) expect(JSON.stringify(a.beatMessage(beat, DAY_ID))).toBe(JSON.stringify(b.beatMessage(beat, DAY_ID)));
  });
});

describe('a whole day', () => {
  const { bus, roles } = house();
  let report: NewsroomReport;
  let all: SomEnvelope[];
  beforeAll(async () => {
    report = await run(bus, roles, at('18:30'));
    all = bus.accepted.map((p) => p.envelope);
  });

  it('is refused nothing, and every message validates against the pinned SOM 1.0 schemas', () => {
    expect(bus.refused.map((r) => r.rule)).toEqual([]);
    for (const e of all) expect(schemaErrors(e), e.message_type).toEqual([]);
    expect(report.errors).toBe(0);
    expect(report.published).toBe(all.length);
  });

  it('plays the stories through, the media attached as sequence 2', () => {
    expect(snapshots(bus, 'hurricane-2026-0911')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(snapshots(bus, 'court-2026-0914')).toEqual([1, 2, 3]);
    expect(snapshots(bus, 'orphan-2026-0911-01')).toEqual([1]);
  });

  it('completes the chain: every role reacts, each within its contract', () => {
    expect(types(byRole(bus, 'mam'))).toEqual(['delivery.media_available', 'delivery.media_available', 'story.context']);
    expect(types(byRole(bus, 'graphics'))).toEqual(['link.committed', 'link.withdrawn']);
    expect(types(byRole(bus, 'standards'))).toEqual(['link.gate_changed', 'system.audit']);
    expect(types(byRole(bus, 'playout'))).toEqual(['telling.ended', 'telling.started']);
    expect(types(byRole(bus, 'cms'))).toEqual(['link.committed', 'telling.ended', 'telling.started']);
    expect(types(byRole(bus, 'automation'))).toEqual(['system.audit']);
    const warnings = byRole(bus, 'skill').map((e) => `${String((e.payload as JsonObject).rule_id)} ${String((e.payload as JsonObject).story_id).split('.')[0]}`).sort();
    expect(warnings).toEqual(['demo-breaking-priority court-2026-0914', 'demo-breaking-priority hurricane-2026-0911', 'demo-ugc-unverified orphan-2026-0911-01']);

    const byId = new Map(all.map((e) => [e.message_id, e]));
    for (const a of LIVE_ACTORS) {
      const allowed = new Set([...(a.trigger?.publishes ?? []), ...a.reactions.flatMap((r) => r.publishes)]);
      for (const e of byRole(bus, a.role)) {
        expect(allowed.has(e.message_type), `${a.role} published ${e.message_type}`).toBe(true);
        if (!e.causation_id) {
          expect(a.trigger, `${a.role} published ${e.message_type} unprompted`).toBeDefined();
          continue;
        }
        const cause = byId.get(e.causation_id)!;
        expect(a.reactions.some((r) => r.on === cause.message_type && r.publishes.includes(e.message_type)), `${a.role}: ${cause.message_type} → ${e.message_type}`).toBe(true);
        expect(e.correlation_id).toBe(cause.correlation_id);
      }
    }
  });

  it('links up: the clearance, air and withdrawal name the link graphics booked', () => {
    const booked = byRole(bus, 'graphics').find((e) => e.message_type === 'link.committed')!.payload as JsonObject;
    expect(booked.compliance_gate_status).toBe('PENDING');
    const cleared = byRole(bus, 'standards').find((e) => e.message_type === 'link.gate_changed')!.payload as JsonObject;
    const aired = byRole(bus, 'playout').find((e) => e.message_type === 'telling.started')!.payload as JsonObject;
    const ended = byRole(bus, 'playout').find((e) => e.message_type === 'telling.ended')!.payload as JsonObject;
    const withdrawn = byRole(bus, 'graphics').find((e) => e.message_type === 'link.withdrawn')!.payload as JsonObject;
    expect([cleared.link_id, aired.link_id, ended.link_id, withdrawn.link_id]).toEqual(Array(4).fill(booked.link_id));
    expect(ended.telling_id).toBe(aired.telling_id);
  });

  it('marks its traffic as the demo\'s and names nothing real', () => {
    for (const e of all) {
      const p = e.payload as JsonObject;
      if (typeof p.story_id === 'string') expect(p.story_id.endsWith('.demo-live-20260929'), p.story_id).toBe(true);
      if (e.message_type === 'story.context') expect(p.newsroom_id).toBe('demo');
    }
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/\bAP\b|FEMA|NHC|nbcu|jsmith|gcp|WhatsApp|ap\.org/);
  });

  it('asks who holds its role before each beat and reaction; the route missing means the actors play', () => {
    expect(bus.rolesCalls).toBeGreaterThanOrEqual(report.reacted + DAY.length);
    expect(report.skipped_real).toBe(0);
    expect(report.reacted).toBeGreaterThan(0);
  });

  it('never replays: a second run on the same day publishes nothing new', async () => {
    const before = bus.accepted.length;
    const again = await run(bus, roles, at('18:45'), 1500);
    expect(again.published).toBe(0);
    expect(bus.accepted.length).toBe(before);
    expect(again.events.filter((e) => e.kind === 'beat').every((e) => e.outcome === 'already_published')).toBe(true);
    expect(again.errors).toBe(0);
  });
});

describe('bounded runs through the day', () => {
  it('play what is due, then carry on where the bus says the day is', async () => {
    const { bus, roles } = house();
    const morning = await run(bus, roles, at('09:00'), 2000);
    expect(snapshots(bus, 'hurricane-2026-0911')).toEqual([1, 2, 3]);
    expect(snapshots(bus, 'court-2026-0914')).toEqual([]);
    expect(morning.published).toBe(bus.accepted.length);

    const n = bus.accepted.length;
    const noon = await run(bus, roles, at('12:20'), 3000);
    const fresh = bus.accepted.slice(n).map((p) => p.envelope);
    expect(fresh.filter((e) => e.message_type === 'story.context' && String((e.payload as JsonObject).story_id).startsWith('hurricane'))
      .map((e) => (e.payload as JsonObject).sequence_number)).toEqual([4, 5, 6, 7]);
    expect(noon.published).toBe(fresh.length);
    expect(noon.events.filter((e) => e.kind === 'beat' && e.outcome === 'already_published')).toHaveLength(3);   // tip clip, 1, 3
    expect(types(fresh.filter((e) => e.message_type.startsWith('link.')))).toEqual(['link.committed', 'link.committed', 'link.gate_changed']);
    expect(bus.refused).toEqual([]);
  });

  it('leave a reaction to the next run: what came in meanwhile waits in the queue', async () => {
    const { bus, roles } = house(['ncs', 'mam']);
    const r = await run(bus, { ncs: roles.ncs }, at('07:00'), 500);
    expect(r.published).toBe(1);                       // the break; the media store isn't running yet
    await run(bus, { mam: roles.mam }, at('07:00'), 800);
    expect(types(byRole(bus, 'mam'))).toEqual(['delivery.media_available', 'story.context']);
    expect(bus.queued('c-ncs')).toBe(1);               // the media waits for the NCS
    await run(bus, { ncs: roles.ncs }, at('07:05'), 800);
    expect(snapshots(bus, 'hurricane-2026-0911')).toEqual([1, 2]);
    expect(bus.queued('c-ncs')).toBe(0);
  });
});

describe('standing down for a real system', () => {
  const view = (real: LiveRole[]) => ({
    status: 200,
    body: { house: TENANT, roles: Object.fromEntries(LIVE_ROLES.map((r) => [r, real.includes(r) ? { held_by: 'real', connection_id: 'cabcdefghijkl' } : { held_by: 'actor' }])) },
  });

  it('a role a real system holds stays silent; the others play on', async () => {
    const { bus, roles } = house();
    bus.roles = view(['graphics']);
    const report = await run(bus, roles, at('18:30'));
    expect(byRole(bus, 'graphics')).toEqual([]);
    expect(report.skipped_real).toBeGreaterThan(0);
    expect(report.events.filter((e) => e.kind === 'skipped_real').every((e) => e.role === 'graphics')).toBe(true);
    expect(snapshots(bus, 'hurricane-2026-0911')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(byRole(bus, 'standards')).toEqual([]);      // nothing was booked, so nothing waits on a gate
    expect(types(byRole(bus, 'automation'))).toEqual(['system.audit']);
  });

  it('with the NCS real, its beats are left to it and the media store still files the clip', async () => {
    const { bus, roles } = house();
    bus.roles = view(['ncs']);
    await run(bus, roles, at('18:30'), 1500);
    expect(byRole(bus, 'ncs')).toEqual([]);
    expect(snapshots(bus, 'orphan-2026-0911-01')).toEqual([1]);
    expect(byRole(bus, 'skill').map((e) => (e.payload as JsonObject).rule_id)).toEqual(['demo-ugc-unverified']);
  });

  it('an error from the roles route means the actors play', async () => {
    const { bus, roles } = house(['mam', 'skill']);
    bus.roles = { status: 500, body: { message: 'boom' } };
    const report = await run(bus, roles, at('06:30'), 800);
    expect(report.published).toBe(2);                  // the clip, and its flag
    expect(bus.rolesCalls).toBeGreaterThan(0);
  });
});

describe('the skill role', () => {
  it('runs the house\'s registered raise-flag-on-match instances when there are any', async () => {
    const { bus, roles } = house(['mam', 'skill']);
    bus.registrations = [
      { skill_id: 'smart-stories/raise-flag-on-match', instance_label: 'house-unverified', values: { match_field: 'editorial_source[].credibility', match_value: 'UNVERIFIED', flag_name: 'UNVERIFIED', severity: 'flag', clearing_authority: 'verification-desk' } },
      { skill_id: 'smart-stories/hold-while-flagged', instance_label: 'not-this-one', values: {} },
    ];
    await run(bus, roles, at('06:30'), 800);
    expect(byRole(bus, 'skill').map((e) => (e.payload as JsonObject).rule_id)).toEqual(['house-unverified']);
  });
});
