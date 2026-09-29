/**
 * What each actor does, as pure functions of what it receives: no network here (./run.ts does that).
 *
 * Every message is built from its cause alone (./ids.ts): a beat from the day and its instant, a
 * reaction from the message it reacts to. Times are the cause's plus a few seconds, ids are derived,
 * so the same cause always gives the same bytes and a redelivery is only ever a duplicate.
 *
 * Actors react to what their connection receives, whoever sent it: when a real system holds a role,
 * the actors downstream of it go on reacting to it. Each ignores its own messages.
 */
import { buildEnvelope, buildFollowUp, type JsonObject, type OriginatingSystem, type SomEnvelope } from '../../sdk/typescript/src/index.js';
import { createExecutor, type Executor } from '../../executors/raise-flag-on-match/src/executor.js';
import type { ConfiguredInstance } from '../../executors/raise-flag-on-match/src/instance.js';
import { LIVE_APPS, LIVE_SYSTEM_TYPES, LIVE_TIME_ZONE, liveStoryId, type LiveRole } from './contract.js';
import { BULLETIN, DAY, NCS_STORIES, dayContext, firstSnapshot, mediaAsset, mediaFor, type Beat } from './day.js';
import {
  correlationOf, dayBefore, iso, linkIdOf, localDay, messageUuid, nameUuid, tellingIdOf, webLinkIdOf, zonedInstant,
} from './ids.js';

export const WEB_PAGE = 'dest-web-live-page';

/** The skill role's instances when the house has registered none for its connection. */
export const DEFAULT_SKILL_INSTANCES: ConfiguredInstance[] = [
  { instance_label: 'demo-ugc-unverified', match_field: 'editorial_source[].credibility', match_value: 'UNVERIFIED', flag_name: 'UNVERIFIED', severity: 'flag', clearing_authority: 'verification-desk' },
  { instance_label: 'demo-breaking-priority', match_field: 'priority.level', match_value: 'HIGH', flag_name: 'BREAKING', severity: 'inform', clearing_authority: 'duty-editor' },
];

export interface ActorOptions {
  role: LiveRole;
  /** The `system_id` this actor's producer connection claimed. */
  systemId: string;
  /** The day's clock (may run fast): picks the live day. */
  now: () => number;
}

/** A message to publish, and the refusals that only mean it is no longer needed. */
export interface Outgoing {
  envelope: SomEnvelope;
  /** Rules that mean "the story has moved on": the attach snapshot after a newer one. */
  supersededBy?: string[];
}

export interface Actor {
  role: LiveRole;
  system: OriginatingSystem;
  /** The beats this actor plays, in order (ncs and mam only). */
  beats: Beat[];
  /** The message a beat publishes on `day`. */
  beatMessage(beat: Beat, day: string): Outgoing;
  /** What it publishes in response to one received message: often nothing. */
  react(m: SomEnvelope): Outgoing[];
  /** The skill role: the instances to evaluate (from the house's registrations). */
  setInstances?(instances: ConfiguredInstance[]): void;
}

const TERMINAL = new Set(['KILLED', 'SPIKED', 'ARCHIVED']);
const asObjects = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is JsonObject => !!x && typeof x === 'object' && !Array.isArray(x)) : []);

/** The links a snapshot says are committed, and whether their asset is on air (no gate still closed on it). */
function committedLinks(p: JsonObject): { link_id: string; asset_id: string; destination_id: string; asset_type: string; cleared: boolean }[] {
  const gates = asObjects(p.editorial_gates);
  const out = [];
  for (const a of asObjects(p.assets)) {
    const assetId = String(a.asset_id);
    const closed = gates.some((g) => g.status !== 'APPROVED' && asObjects(g.blocks).some((b) => b.kind === 'ASSET' && b.ref === assetId));
    for (const u of asObjects(a.usage)) {
      if (u.state !== 'committed' || typeof u.link_id !== 'string') continue;
      out.push({ link_id: u.link_id, asset_id: assetId, destination_id: String(u.destination_id), asset_type: String(a.asset_type), cleared: !closed });
    }
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createActor(o: ActorOptions): Actor {
  const { role } = o;
  const system: OriginatingSystem = { system_id: o.systemId, system_type: LIVE_SYSTEM_TYPES[role], system_name: LIVE_APPS[role] };

  /** A reaction to `cause`, `offsetS` seconds after it; `key` tells apart the messages of one reaction. */
  const follow = (cause: SomEnvelope, offsetS: number, key: string, messageType: string, payload: JsonObject): SomEnvelope => {
    const t = (Date.parse(cause.timestamp) || o.now()) + offsetS * 1000;
    return buildFollowUp(cause, {
      messageType, payload, originatingSystem: system,
      timestamp: iso(t),
      messageId: messageUuid(t, role, cause.message_id, key),
    });
  };
  const timeOf = (cause: SomEnvelope, offsetS: number) => iso((Date.parse(cause.timestamp) || o.now()) + offsetS * 1000);

  const beats = DAY.filter((b) => b.role === role);
  const beatMessage = (beat: Beat, day: string): Outgoing => {
    const d = dayContext(day);
    const instant = zonedInstant(day, beat.at, LIVE_TIME_ZONE);
    const storyId = d.story(beat.story);
    return {
      envelope: buildEnvelope({
        messageType: 'story.context', payload: beat.snapshot(d, instant), originatingSystem: system,
        correlationId: correlationOf(storyId), timestamp: iso(instant),
        messageId: messageUuid(instant, 'beat', storyId, String(beat.sequence)),
      }),
    };
  };

  // State kept only to avoid doing the same thing twice within one run; every decision also stands
  // on what the message itself says, so a fresh process decides the same way.
  const booked = new Set<string>();            // graphics: link ids it booked
  const aired = new Map<string, Set<string>>(); // playout: correlation id → link ids it put on air
  const onWeb = new Set<string>();             // cms: correlation ids it published on the web

  let executors: { label: string; ex: Executor }[] = [];
  const setInstances = (instances: ConfiguredInstance[]) => {
    const keep = new Map(executors.map((e) => [e.label, e]));
    executors = instances.map((i) => {
      const label = `${JSON.stringify(i)}`;
      return keep.get(label) ?? { label, ex: createExecutor({ instance: i, originatingSystem: system }) };
    });
  };

  const react = (m: SomEnvelope): Outgoing[] => {
    if (m.originating_system?.system_id === o.systemId) return [];      // its own
    const p = (m.payload ?? {}) as JsonObject;
    const killed = m.message_type === 'story.context' && p.story_type === 'KILLED';
    switch (role) {
      case 'ncs': {
        if (m.message_type !== 'delivery.media_available') return [];
        const today = localDay(o.now(), LIVE_TIME_ZONE);
        const days = [...new Set([localDay(Date.parse(m.timestamp) || o.now(), LIVE_TIME_ZONE), today, dayBefore(today)])];
        for (const day of days) {
          const base = NCS_STORIES.find((b) => correlationOf(liveStoryId(b, day)) === m.correlation_id);
          if (!base) continue;
          const first = firstSnapshot(base, dayContext(day))!;
          const assets = asObjects(first.payload.assets);
          const media = mediaAsset(String(p.asset_id), String(p.source ?? `tams://meridian-store/${String(p.asset_id)}`), 'Coverage feed');
          if (typeof p.time_range === 'string') (media.media_refs as JsonObject[])[0].time_range = p.time_range;
          const payload: JsonObject = { ...first.payload, sequence_number: 2, updated_at: iso(first.instant + 60_000), assets: [...assets, media] };
          return [{ envelope: follow(m, 5, 'attach', 'story.context', payload), supersededBy: ['sequence_number.not_increasing', 'updated_at.backwards', 'message.superseded'] }];
        }
        return [];
      }
      case 'mam': {
        if (m.message_type !== 'story.context' || p.sequence_number !== 1 || p.story_type === 'ORPHAN' || TERMINAL.has(String(p.story_type))) return [];
        const storyId = String(p.story_id);
        const media = mediaFor(storyId);
        return [{
          envelope: follow(m, 30, 'media', 'delivery.media_available', {
            message_type: 'delivery.media_available', delivery_id: nameUuid('delivery', storyId, media.asset_id), asset_id: media.asset_id,
            source: media.source, time_range: media.time_range, arrived_in: 'meridian-store', arrived_at: timeOf(m, 30),
          }),
        }];
      }
      case 'skill': {
        if (m.message_type !== 'story.context') return [];
        return executors.flatMap((e) => e.ex.deliver(m)).map((envelope) => ({ envelope }));
      }
      case 'graphics': {
        if (m.message_type !== 'story.context') return [];
        const storyId = String(p.story_id);
        if (killed) {
          const links = new Map<string, JsonObject>();
          for (const l of committedLinks(p)) {
            if (l.asset_type === 'LOWER_THIRD' && UUID.test(l.link_id)) links.set(l.link_id, { link_id: l.link_id, asset_id: l.asset_id, destination_id: l.destination_id, compliance_gate_status: l.cleared ? 'CLEARED' : 'PENDING' });
          }
          for (const a of asObjects(p.assets)) {
            const id = linkIdOf(storyId, String(a.asset_id), BULLETIN);
            if (booked.has(id) && !links.has(id)) links.set(id, { link_id: id, asset_id: String(a.asset_id), destination_id: BULLETIN, compliance_gate_status: 'CLEARED' });
          }
          return [...links.values()].map((l, i) => ({
            envelope: follow(m, 10, `withdraw:${String(l.link_id)}`, 'link.withdrawn', {
              message_type: 'link.withdrawn', ...l, withdrawn: { withdrawn_by: 'graphics-desk', withdrawn_at: timeOf(m, 10 + i), reason: 'Story killed.' },
            }),
          }));
        }
        if (TERMINAL.has(String(p.story_type))) return [];
        const out: Outgoing[] = [];
        const committed = new Set(committedLinks(p).map((l) => l.asset_id));
        for (const a of asObjects(p.assets)) {
          if (a.asset_type !== 'LOWER_THIRD' || committed.has(String(a.asset_id))) continue;
          const linkId = linkIdOf(storyId, String(a.asset_id), BULLETIN);
          if (booked.has(linkId)) continue;
          booked.add(linkId);
          out.push({
            envelope: follow(m, 20, `book:${linkId}`, 'link.committed', {
              message_type: 'link.committed', link_id: linkId, asset_id: String(a.asset_id), destination_id: BULLETIN,
              committed_by: 'graphics-desk', committed_at: timeOf(m, 20), compliance_gate_status: 'PENDING',
            }),
          });
        }
        return out;
      }
      case 'standards': {
        if (m.message_type !== 'link.committed' || p.compliance_gate_status !== 'PENDING') return [];
        const link = { link_id: String(p.link_id), asset_id: String(p.asset_id), destination_id: String(p.destination_id) };
        return [
          { envelope: follow(m, 60, 'clear', 'link.gate_changed', { message_type: 'link.gate_changed', ...link, compliance_gate_status: 'CLEARED' }) },
          {
            envelope: follow(m, 61, 'audit', 'system.audit', {
              message_type: 'system.audit', audit_id: nameUuid('audit-cleared', link.link_id), action: 'CLEARED', target: { kind: 'LINK', id: link.link_id },
              actor: { actor_id: 'standards-desk', actor_type: 'human' }, reason: 'The standards desk checked the figure on screen against the authority statement and cleared the element for air.', recorded_at: timeOf(m, 61),
            }),
          },
        ];
      }
      case 'playout': {
        if (m.message_type === 'link.gate_changed') {
          if (p.compliance_gate_status !== 'CLEARED') return [];
          const linkId = String(p.link_id);
          const set = aired.get(m.correlation_id) ?? new Set<string>();
          aired.set(m.correlation_id, set.add(linkId));
          return [{
            envelope: follow(m, 30, 'air', 'telling.started', {
              message_type: 'telling.started', telling_id: tellingIdOf(linkId), link_id: linkId, scheduled_start: timeOf(m, 30), exposure_start: timeOf(m, 30),
            }),
          }];
        }
        if (!killed) return [];
        const links = new Set([...committedLinks(p).filter((l) => l.cleared && UUID.test(l.link_id)).map((l) => l.link_id), ...(aired.get(m.correlation_id) ?? [])]);
        aired.delete(m.correlation_id);
        return [...links].map((linkId) => ({
          envelope: follow(m, 20, `off:${linkId}`, 'telling.ended', { message_type: 'telling.ended', telling_id: tellingIdOf(linkId), link_id: linkId, exposure_end: timeOf(m, 20) }),
        }));
      }
      case 'cms': {
        if (m.message_type === 'telling.started') {
          if (onWeb.has(m.correlation_id)) return [];
          onWeb.add(m.correlation_id);
          const linkId = webLinkIdOf(m.correlation_id);
          return [
            {
              envelope: follow(m, 45, 'web-link', 'link.committed', {
                message_type: 'link.committed', link_id: linkId, asset_id: 'asset-web-story-page', destination_id: WEB_PAGE,
                committed_by: 'web-desk', committed_at: timeOf(m, 45), compliance_gate_status: 'CLEARED',
              }),
            },
            {
              envelope: follow(m, 50, 'web-telling', 'telling.started', {
                message_type: 'telling.started', telling_id: tellingIdOf(linkId), link_id: linkId, scheduled_start: timeOf(m, 50), exposure_start: timeOf(m, 50),
              }),
            },
          ];
        }
        if (!killed) return [];
        // On the web if this run put it there, or if the story says it went to air (the web follows air).
        const wasOn = onWeb.delete(m.correlation_id) || committedLinks(p).some((l) => l.cleared);
        if (!wasOn) return [];
        const linkId = webLinkIdOf(m.correlation_id);
        return [{
          envelope: follow(m, 30, 'web-off', 'telling.ended', { message_type: 'telling.ended', telling_id: tellingIdOf(linkId), link_id: linkId, exposure_end: timeOf(m, 30) }),
        }];
      }
      case 'automation': {
        if (!killed) return [];
        const storyId = String(p.story_id);
        return [{
          envelope: follow(m, 40, 'suppress', 'system.audit', {
            message_type: 'system.audit', audit_id: nameUuid('audit-suppressed', storyId), action: 'SUPPRESSED', target: { kind: 'ASSET', id: `pkg-${storyId}` },
            actor: { actor_id: 'automation-01', actor_type: 'system' }, reason: 'Story killed: its package is suppressed and never goes to air.', recorded_at: timeOf(m, 40),
          }),
        }];
      }
    }
  };

  return {
    role, system, beats, beatMessage, react,
    ...(role === 'skill' ? { setInstances } : {}),
  };
}
