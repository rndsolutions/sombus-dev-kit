/**
 * A bus in memory, on `fetch`, for the newsroom's tests: the token endpoint, POST /jwt/messages with
 * the checks the actors depend on (the pinned SOM 1.0 schemas, grants and system ids, idempotency,
 * snapshot order), routing by message type to consumer queues, the pull API and the roles route.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { SomEnvelope } from '../../../sdk/typescript/src/index.js';
import { granted } from '../contract.js';

const UP = join(import.meta.dirname, '..', '..', '..', 'upstream', 'som-1.0');
const json = (p: string) => JSON.parse(readFileSync(join(UP, p), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
for (const f of readdirSync(join(UP, 'schema'))) ajv.addSchema(json(`schema/${f}`));
const schema = (name: string) => ajv.getSchema(`https://storyobjectmodel.com/schema/1.0/${name}.schema.json`)!;
export const validEnvelope = schema('envelope');
const FAMILY: [RegExp, ValidateFunction][] = [
  [/^story\.context$/, schema('story-context')],
  [/^telling\./, schema('telling-event')],
  [/^link\./, schema('link-event')],
  [/^delivery\.media_available$/, schema('delivery-media-available')],
  [/^skill\.warning\.raised$/, schema('skill-warning')],
  [/^system\.audit$/, schema('system-audit')],
];
/** The schema errors of an envelope and its payload; empty when it validates. */
export function schemaErrors(e: unknown): string[] {
  const out: string[] = [];
  if (!validEnvelope(e)) out.push(...(validEnvelope.errors ?? []).map((x) => `envelope${x.instancePath} ${x.message}`));
  const m = e as SomEnvelope;
  const v = FAMILY.find(([re]) => re.test(String(m?.message_type)))?.[1];
  if (!v) out.push(`no schema for ${String(m?.message_type)}`);
  else if (!v(m.payload)) out.push(...(v.errors ?? []).map((x) => `payload${x.instancePath} ${x.message}`));
  return out;
}

export const TENANT = 'wtesthouse';

interface Connection { kind: 'producer' | 'consumer'; secret: string; system_ids?: string[]; grants?: string[]; receives?: string[] }
interface Queued { handle: string; envelope: SomEnvelope; receive_count: number; visibleAt: number }
interface Story { seq: number; updated_at: number; keys: string[]; assets: string[]; type: string }

export interface Published { envelope: SomEnvelope; producer: string }

export class FakeBus {
  readonly connections = new Map<string, Connection>();
  readonly accepted: Published[] = [];
  readonly refused: { envelope: unknown; rule: string; producer: string }[] = [];
  duplicates = 0;
  /** What GET /jwt/live/roles answers: a status, and a body for 200. */
  roles: { status: number; body?: unknown } = { status: 404 };
  rolesCalls = 0;
  registrations: unknown[] = [];
  private readonly ids = new Map<string, string>();
  private readonly stories = new Map<string, Story>();
  private readonly queues = new Map<string, Queued[]>();
  private n = 0;

  producer(id: string, systemId: string, grants: string[]) {
    this.connections.set(id, { kind: 'producer', secret: `${id}-secret`, system_ids: [systemId], grants });
  }

  consumer(id: string, receives: string[]) {
    this.connections.set(id, { kind: 'consumer', secret: `${id}-secret`, receives });
    this.queues.set(id, []);
  }

  queued(id: string) { return this.queues.get(id)?.length ?? 0; }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? init.body : '';
    const path = url.pathname.replace(/^\/v1\//, '');
    const answer = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

    if (path === 'oauth/token' && method === 'POST') {
      const [id, secret] = Buffer.from((headers.get('authorization') ?? '').replace(/^Basic /, ''), 'base64').toString().split(':').map(decodeURIComponent);
      const c = this.connections.get(id);
      if (!c || c.secret !== secret) return answer(401, { error: 'invalid_client' });
      const claims = Buffer.from(JSON.stringify({ sub: id, tenant: TENANT })).toString('base64url');
      return answer(200, { access_token: `h.${claims}.s`, token_type: 'Bearer', expires_in: 3600 });
    }
    const caller = this.bearer(headers);
    if (!caller) return answer(401, { message: 'Unauthorized' });

    if (path === 'jwt/live/roles' && method === 'GET') {
      this.rolesCalls++;
      return answer(this.roles.status, this.roles.body ?? { message: 'not found' });
    }
    if (path === 'jwt/messages' && method === 'POST') {
      const c = this.connections.get(caller)!;
      if (c.kind !== 'producer') return answer(403, { message: 'Forbidden' });
      const r = this.publish(caller, c, body);
      return answer(r.status, r.body);
    }
    const m = /^tenants\/([^/]+)\/consumers\/([^/]+)\/(messages|ack|nack|skills)$/.exec(path);
    if (m) {
      const [, t, cid, action] = m;
      if (t !== TENANT || cid !== caller || this.connections.get(caller)?.kind !== 'consumer') return answer(403, { accepted: false });
      const q = this.queues.get(cid)!;
      if (action === 'skills') return answer(200, { registrations: this.registrations });
      if (action === 'messages') {
        const max = Number(url.searchParams.get('max') ?? 10);
        const take = () => q.filter((x) => x.visibleAt <= Date.now()).slice(0, max);
        let got = take();
        if (!got.length && Number(url.searchParams.get('wait') ?? 0) > 0) {
          await new Promise((res) => setTimeout(res, 5));
          got = take();
        }
        for (const x of got) { x.visibleAt = Date.now() + 60_000; x.receive_count++; }
        return answer(200, { messages: got.map((x) => ({ receipt_handle: x.handle, message_type: x.envelope.message_type, receive_count: x.receive_count, envelope: x.envelope })) });
      }
      const handles = (JSON.parse(body) as { receipt_handles: string[]; delay_seconds?: number }).receipt_handles;
      for (const h of handles) {
        const i = q.findIndex((x) => x.handle === h);
        if (i < 0) continue;
        if (action === 'ack') q.splice(i, 1);
        else q[i].visibleAt = Date.now();
      }
      return answer(200, { ok: handles, failed: [] });
    }
    return answer(404, { message: 'not found' });
  };

  private bearer(h: Headers): string | undefined {
    const t = /^Bearer h\.([^.]+)\.s$/.exec(h.get('authorization') ?? '')?.[1];
    if (!t) return undefined;
    const sub = (JSON.parse(Buffer.from(t, 'base64url').toString()) as { sub: string }).sub;
    return this.connections.has(sub) ? sub : undefined;
  }

  private publish(producer: string, c: Connection, raw: string): { status: number; body: unknown } {
    const env = JSON.parse(raw) as SomEnvelope;
    const refuse = (status: number, rule: string, source = 'policy') => {
      this.refused.push({ envelope: env, rule, producer });
      return { status, body: { accepted: false, violations: [{ source, rule, message: rule }] } };
    };
    const errors = schemaErrors(env);
    if (errors.length) return refuse(400, `schema: ${errors.join('; ')}`, 'schema');
    if (!c.system_ids!.includes(env.originating_system.system_id)) return refuse(403, 'producer.system_id_not_allowed');
    if (!granted(c.grants!, env.message_type)) return refuse(403, 'producer.message_type_not_allowed');
    const hash = createHash('sha256').update(stable(env)).digest('hex');
    const seen = this.ids.get(env.message_id);
    if (seen) {
      if (seen !== hash) return refuse(409, 'message_id.reused');
      this.duplicates++;
      return { status: 200, body: { accepted: true, duplicate: true, message_id: env.message_id } };
    }
    if (env.message_type === 'story.context') {
      const p = env.payload as Record<string, unknown>;
      const prev = this.stories.get(String(p.story_id));
      const assets = ((p.assets ?? []) as { asset_id: string }[]).map((a) => a.asset_id);
      if (prev) {
        if (Number(p.sequence_number) <= prev.seq) return refuse(409, 'sequence_number.not_increasing', 'sequence');
        if (Date.parse(String(p.updated_at)) < prev.updated_at) return refuse(409, 'updated_at.backwards', 'sequence');
        const gone = prev.keys.filter((k) => !(k in p) && !(k === 'lifecycle' && p.story_type !== 'ACTIVE'));
        if (gone.length) return refuse(409, 'snapshot.members_missing', 'sequence');
        if (prev.assets.some((a) => !assets.includes(a))) return refuse(409, 'snapshot.assets_dropped', 'sequence');
        if (['KILLED', 'SPIKED', 'ARCHIVED'].includes(prev.type) && !['KILLED', 'SPIKED', 'ARCHIVED'].includes(String(p.story_type))) return refuse(409, 'story_type.left_terminal', 'sequence');
      }
      this.stories.set(String(p.story_id), { seq: Number(p.sequence_number), updated_at: Date.parse(String(p.updated_at)), keys: Object.keys(p), assets, type: String(p.story_type) });
    }
    this.ids.set(env.message_id, hash);
    this.accepted.push({ envelope: env, producer });
    for (const [id, conn] of this.connections) {
      if (conn.kind === 'consumer' && granted(conn.receives!, env.message_type)) {
        this.queues.get(id)!.push({ handle: `h${++this.n}`, envelope: structuredClone(env), receive_count: 0, visibleAt: Date.now() });
      }
    }
    return { status: 202, body: { accepted: true, message_id: env.message_id, message_type: env.message_type, family: env.message_type.split('.')[0] } };
  }
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
