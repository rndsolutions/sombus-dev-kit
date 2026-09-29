/**
 * runNewsroom: the live newsroom's actors, one per role given, each on its own connections.
 *
 *   producer  OAuth client credentials → POST <api>/jwt/messages (the SDK's SomBusClient)
 *   consumer  the HTTPS pull API: long poll → react → publish → ack (nack when the bus gave no answer)
 *   roles     GET <api>/jwt/live/roles before each beat and each reaction: silent while a real system
 *             holds the role. A 404 or any error there means every role is played by its actor.
 *
 * The two scripted actors (ncs, mam) play the day's beats that are due by the day's clock. A run keeps
 * no state between runs: every message is derived from its cause (./ids.ts), so a beat played again is
 * answered `200 duplicate` (or, for a snapshot the story has moved past, refused as not newer), which
 * the actor reads as "already published" and moves on. A bounded run (`stopAfterMs`) therefore plays
 * what is due and not yet on the bus, and the next run carries on from there. Reactions are acked only
 * once the bus has answered, so a message whose reaction was cut short comes back to the next run.
 */
import { ClientCredentials, PublishError, SomBusClient, TokenError, type SomEnvelope } from '../../sdk/typescript/src/index.js';
import { checkInstance, SKILL_ID, type ConfiguredInstance } from '../../executors/raise-flag-on-match/src/instance.js';
import { PullClient, type Received } from '../lib/pull.js';
import { DEFAULT_SKILL_INSTANCES, createActor, type Actor, type Outgoing } from './actors.js';
import { LIVE_RECEIVES, LIVE_ROLES, LIVE_ROLES_PATH, LIVE_TIME_ZONE, type LiveRole, type LiveRoleHolder } from './contract.js';
import type { Beat } from './day.js';
import { iso, localDay, zonedInstant } from './ids.js';

export interface ClientCreds { client_id: string; client_secret: string }

export interface RoleConfig {
  producer: ClientCreds;
  /** Needed by every role that reacts to anything (all but none: see LIVE_RECEIVES). */
  consumer?: ClientCreds;
  /** The `system_id` the producer connection claimed. Default `meridian-live-<role>`. */
  system_id?: string;
}

export interface NewsroomOptions {
  /** Bus API base, e.g. https://api.sombus.rnd-solutions.net/v1 */
  apiUrl: string;
  /** OAuth token endpoint. */
  tokenUrl: string;
  /** Only the roles listed run. */
  roles: Partial<Record<LiveRole, RoleConfig>>;
  /** The day's clock (beats, and which day's stories). Default Date.now. */
  now?: () => number;
  /** A bounded run: stop after this long (real time). Absent: run until SIGINT or SIGTERM. */
  stopAfterMs?: number;
  log?: (e: NewsroomEvent) => void;
  /** When several beats are due at once: how long to leave for reactions after each. Default 5 s. */
  catchUpGapMs?: number;
  fetch?: typeof fetch;
}

export interface NewsroomEvent {
  at: string;
  role: LiveRole;
  kind: 'beat' | 'reaction' | 'skipped_real' | 'error';
  message_type?: string;
  story_id?: string;
  /** accepted, duplicate, already_published, superseded, refused <rule>, … */
  outcome?: string;
  detail?: string;
}

export interface NewsroomReport {
  /** Messages the bus accepted (new on the bus). */
  published: number;
  /** Received messages an actor reacted to (published in response, accepted or already there). */
  reacted: number;
  /** Beats and reactions left to a real system holding the role. */
  skipped_real: number;
  errors: number;
  /** The run's events, the last MAX_EVENTS of them. */
  events: NewsroomEvent[];
}

export const MAX_EVENTS = 1000;
export const defaultSystemId = (role: LiveRole) => `meridian-live-${role}`;

/** Rules that mean a beat is already on the bus: same bytes (duplicate), or the story is past it. */
const ALREADY = new Set(['sequence_number.not_increasing', 'updated_at.backwards', 'message.superseded', 'message_id.reused']);
const SKILLS_REFRESH_MS = 5 * 60_000;

export async function runNewsroom(o: NewsroomOptions): Promise<NewsroomReport> {
  const now = o.now ?? Date.now;
  const fetchFn = o.fetch ?? globalThis.fetch;
  const apiBase = o.apiUrl.endsWith('/') ? o.apiUrl : `${o.apiUrl}/`;
  const gap = o.catchUpGapMs ?? 5000;
  const report: NewsroomReport = { published: 0, reacted: 0, skipped_real: 0, errors: 0, events: [] };

  const emit = (e: Omit<NewsroomEvent, 'at'>) => {
    const ev: NewsroomEvent = { at: iso(now()), ...e };
    if (ev.kind === 'skipped_real') report.skipped_real++;
    if (ev.kind === 'error') report.errors++;
    report.events.push(ev);
    if (report.events.length > MAX_EVENTS) report.events.shift();
    o.log?.(ev);
  };

  const stop = new AbortController();
  const deadline = o.stopAfterMs !== undefined ? Date.now() + o.stopAfterMs : Infinity;
  const timer = o.stopAfterMs !== undefined ? setTimeout(() => stop.abort(), o.stopAfterMs) : undefined;
  const onSignal = () => stop.abort();
  if (o.stopAfterMs === undefined) { process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal); }

  const sleep = (ms: number) => new Promise<void>((res) => {
    if (stop.signal.aborted || ms <= 0) return res();
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); stop.signal.removeEventListener('abort', done); res(); }
    stop.signal.addEventListener('abort', done, { once: true });
  });
  const remainingS = () => (deadline === Infinity ? Infinity : (deadline - Date.now()) / 1000);

  async function runRole(role: LiveRole, cfg: RoleConfig) {
    const auth = new ClientCredentials({ tokenUrl: o.tokenUrl, clientId: cfg.producer.client_id, clientSecret: cfg.producer.client_secret, fetch: fetchFn, now: Date.now });
    const bus = new SomBusClient({ baseUrl: apiBase, auth, fetch: fetchFn, retry: { maxAttempts: 3 }, sleep });
    const actor = createActor({ role, systemId: cfg.system_id ?? defaultSystemId(role), now });
    const pull = cfg.consumer
      ? new PullClient({
        baseUrl: apiBase, tokenUrl: o.tokenUrl, clientId: cfg.consumer.client_id, clientSecret: cfg.consumer.client_secret, fetch: fetchFn,
        onRetry: (status, wait) => emit({ role, kind: 'error', outcome: `http ${status}`, detail: `pull API busy; retrying in ${wait}s` }),
      })
      : undefined;
    if (!pull && LIVE_RECEIVES[role].length) {
      emit({ role, kind: 'error', outcome: 'no_consumer', detail: `no consumer connection: it reacts to nothing (it needs ${LIVE_RECEIVES[role].join(', ')})` });
      if (!actor.beats.length) return;
    }

    /** Who holds the role now. Anything but a clear "real" means the actor plays it. */
    const holder = async (): Promise<LiveRoleHolder> => {
      try {
        const token = await auth.getToken();
        const r = await fetchFn(new URL(LIVE_ROLES_PATH.replace(/^\//, ''), apiBase), { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
        if (!r.ok) return 'actor';
        const body = (await r.json().catch(() => null)) as { roles?: Record<string, { held_by?: unknown }> } | null;
        return body?.roles?.[role]?.held_by === 'real' ? 'real' : 'actor';
      } catch {
        return 'actor';
      }
    };

    /** Publish one message. 'retry': no final answer (the cause should come back); 'fatal': credentials refused. */
    const publish = async (out: Outgoing, kind: 'beat' | 'reaction', cause?: SomEnvelope): Promise<'accepted' | 'done' | 'retry' | 'fatal'> => {
      const e = out.envelope;
      const base = { role, kind, message_type: e.message_type, story_id: storyOf(e) ?? (cause && storyOf(cause)), ...(cause ? { detail: `on ${cause.message_type} ${cause.message_id}` } : {}) };
      try {
        const v = await bus.publish(e);
        if (v.kind === 'accepted') { report.published++; emit({ ...base, outcome: 'accepted' }); return 'accepted'; }
        if (v.kind === 'duplicate') { emit({ ...base, outcome: kind === 'beat' ? 'already_published' : 'duplicate' }); return 'done'; }
        if (out.supersededBy?.includes(v.rule)) { emit({ ...base, outcome: 'superseded', detail: `${base.detail ?? ''} (${v.rule})`.trim() }); return 'done'; }
        if (ALREADY.has(v.rule) && (kind === 'beat' || v.rule === 'message_id.reused')) { emit({ ...base, outcome: 'already_published', detail: v.rule }); return 'done'; }
        emit({ ...base, kind: 'error', outcome: `refused ${v.rule}`, detail: `${v.status} ${v.source}${v.path ? ` at ${v.path}` : ''}` });
        return 'done';
      } catch (err) {
        if (err instanceof TokenError && !err.retryable) {
          emit({ ...base, kind: 'error', outcome: 'credentials_refused', detail: err.message });
          return 'fatal';
        }
        emit({ ...base, kind: 'error', outcome: 'no_answer', detail: err instanceof PublishError ? err.message : (err as Error).message });
        return 'retry';
      }
    };

    // ---------------------------------------------------------------- beats
    const played = new Set<string>();
    const due = (): { beat: Beat; day: string; key: string }[] => {
      const t = now();
      const day = localDay(t, LIVE_TIME_ZONE);
      return actor.beats
        .map((beat, i) => ({ beat, day, key: `${day}#${i}` }))
        .filter((b) => !played.has(b.key) && zonedInstant(b.day, b.beat.at, LIVE_TIME_ZONE) <= t);
    };
    const playBeat = async (b: { beat: Beat; day: string; key: string }) => {
      const out = actor.beatMessage(b.beat, b.day);
      if ((await holder()) === 'real') {
        played.add(b.key);
        emit({ role, kind: 'skipped_real', message_type: 'story.context', story_id: storyOf(out.envelope), detail: `beat ${b.beat.at}: a real system holds ${role}` });
        return 'done' as const;
      }
      const r = await publish(out, 'beat');
      if (r !== 'retry') played.add(b.key);
      return r;
    };

    // ---------------------------------------------------------------- reactions
    let instancesAt = -Infinity;
    const refreshInstances = async () => {
      if (!actor.setInstances || !pull || Date.now() - instancesAt < SKILLS_REFRESH_MS) return;
      instancesAt = Date.now();
      let instances: ConfiguredInstance[] = [];
      try {
        for (const r of await pull.skills()) {
          if (r.skill_id !== SKILL_ID || r.paused) continue;
          try { instances.push(checkInstance({ ...r.values, instance_label: r.instance_label })); } catch (err) {
            emit({ role, kind: 'error', outcome: 'bad_instance', detail: `${r.instance_label}: ${(err as Error).message}` });
          }
        }
      } catch {
        instances = [];
      }
      actor.setInstances(instances.length ? instances : DEFAULT_SKILL_INSTANCES);
    };
    if (actor.setInstances) actor.setInstances(DEFAULT_SKILL_INSTANCES);

    const handle = async (r: Received): Promise<'ack' | 'nack' | 'fatal'> => {
      let outs: Outgoing[];
      try {
        outs = actor.react(r.envelope);
      } catch (err) {
        emit({ role, kind: 'error', outcome: 'reaction_failed', message_type: r.envelope?.message_type, detail: (err as Error).message });
        return 'ack';
      }
      if (!outs.length) return 'ack';
      if ((await holder()) === 'real') {
        emit({ role, kind: 'skipped_real', message_type: r.envelope.message_type, story_id: storyOf(r.envelope), detail: `a real system holds ${role}` });
        return 'ack';
      }
      for (const out of outs) {
        const res = await publish(out, 'reaction', r.envelope);
        if (res === 'fatal') return 'fatal';
        if (res === 'retry') return 'nack';
      }
      report.reacted++;
      return 'ack';
    };

    /** One pull: react to what came, ack it. false: stop this role. */
    const pollOnce = async (waitSeconds: number): Promise<boolean> => {
      if (!pull) { await sleep(Math.min(1000, waitSeconds * 1000)); return true; }
      await refreshInstances();
      let got: Received[];
      try {
        got = await pull.receive({ waitSeconds, signal: stop.signal });
      } catch (err) {
        if (stop.signal.aborted) return false;
        if (err instanceof TokenError && !err.retryable) {
          emit({ role, kind: 'error', outcome: 'credentials_refused', detail: `consumer: ${err.message}` });
          return false;
        }
        emit({ role, kind: 'error', outcome: 'pull_failed', detail: (err as Error).message });
        await sleep(5000);
        return true;
      }
      const ack: string[] = [];
      const nack: string[] = [];
      for (const r of got) {
        const res = await handle(r);
        if (res === 'fatal') return false;
        (res === 'ack' ? ack : nack).push(r.receipt_handle);
      }
      try {
        await pull.ack(ack);
        await pull.nack(nack, 5);
      } catch (err) {
        emit({ role, kind: 'error', outcome: 'ack_failed', detail: (err as Error).message });
      }
      return true;
    };

    /** React for `ms`, in short polls: leaves time for the chain a beat started before the next. */
    const drain = async (ms: number) => {
      const until = Date.now() + ms;
      while (!stop.signal.aborted && Date.now() < until) {
        // A 1-second long poll: it answers as soon as something arrives.
        if (!(await pollOnce(1))) return false;
      }
      return true;
    };

    while (!stop.signal.aborted && remainingS() > 0) {
      const pending = actor.beats.length ? due() : [];
      if (pending.length) {
        const r = await playBeat(pending[0]);
        if (r === 'fatal') return;
        if (r === 'retry') { await sleep(5000); continue; }
        if (r === 'accepted' && pending.length > 1 && !(await drain(gap))) return;
        continue;
      }
      // Scripted actors poll briefly so a beat that falls due is played soon after; the others long-poll.
      const wait = Math.max(0, Math.min(actor.beats.length ? 5 : 20, Math.floor(remainingS())));
      if (!(await pollOnce(wait))) return;
      if (wait < 1) await sleep(100);     // the run's last second: short polls, spaced
    }
  }

  try {
    await Promise.all(LIVE_ROLES.filter((r) => o.roles[r]).map((r) => runRole(r, o.roles[r]!).catch((err: Error) => {
      emit({ role: r, kind: 'error', outcome: 'crashed', detail: err.message });
    })));
  } finally {
    if (timer) clearTimeout(timer);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
  return report;
}

function storyOf(e: SomEnvelope | undefined): string | undefined {
  const s = (e?.payload as { story_id?: unknown } | undefined)?.story_id;
  return typeof s === 'string' ? s : undefined;
}
