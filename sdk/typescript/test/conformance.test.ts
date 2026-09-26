/**
 * Runner for the shared conformance kit (sdk/conformance). Every SDK has one like it;
 * the cases, not this file, are the contract.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildEnvelope, buildFollowUp, ClientCredentials, EnvelopeError, parseVerdict, PublishError, SomBusClient,
  type EnvelopeInput, type Verdict,
} from '../src/index.js';
import { BASE_URL, fakeBus, TOKEN_URL, zeroRandom, type Scripted } from './fakes.js';

const KIT = join(import.meta.dirname, '..', '..', 'conformance');
const load = <T>(f: string): T => JSON.parse(readFileSync(join(KIT, 'cases', f), 'utf8')) as T;

type Obj = Record<string, unknown>;

describe('kit: envelope', () => {
  const kit = load<{ clock: string; cases: { id: string; input: Obj; follow?: { message_id: string; correlation_id: string }; expect: Obj }[] }>('envelope.json');
  const now = () => Date.parse(kit.clock);

  it.each(kit.cases.map((c) => [c.id, c]))('%s', (_id, c) => {
    const i = c.input;
    const input: EnvelopeInput = {
      messageType: i.message_type as string,
      payload: i.payload as Obj as never,
      originatingSystem: i.originating_system as never,
      correlationId: i.correlation_id as string | undefined,
      causationId: i.causation_id as string | undefined,
      topic: i.topic as string | undefined,
      timestamp: i.timestamp as string | undefined,
      messageId: i.message_id as string | undefined,
      extensions: i.extensions as never,
    };
    const build = () => (c.follow ? buildFollowUp(c.follow, input, { now, random: zeroRandom }) : buildEnvelope(input, { now, random: zeroRandom }));
    const e = c.expect as { error?: string; fields?: Obj; absent?: string[]; uuidv7?: Record<string, string> };
    if (e.error) {
      expect(build).toThrow(EnvelopeError);
      try { build(); } catch (err) { expect((err as EnvelopeError).field).toBe(e.error); }
      return;
    }
    const env = build() as unknown as Obj;
    expect(env).toMatchObject(e.fields ?? {});
    for (const k of e.absent ?? []) expect(env).not.toHaveProperty(k);
    for (const [k, prefix] of Object.entries(e.uuidv7 ?? {})) expect(String(env[k]).startsWith(prefix), `${k}=${env[k]}`).toBe(true);
  });
});

describe('kit: verdicts', () => {
  const kit = load<{ cases: { id: string; response: { status: number; body: unknown }; expect: Obj }[] }>('verdicts.json');

  it.each(kit.cases.map((c) => [c.id, c]))('%s', (_id, c) => {
    const v = parseVerdict(c.response.status, c.response.body);
    const e = c.expect;
    expect(v.kind).toBe(e.kind);
    if (v.kind === 'accepted') {
      if ('message_id' in e) expect(v.messageId).toBe(e.message_id);
      if ('family' in e) expect(v.family).toBe(e.family);
      expect(v.tolerated.map((t) => t.rule)).toEqual(e.tolerated_rules);
    }
    if (v.kind === 'duplicate') expect(v.messageId).toBe(e.message_id);
    if (v.kind === 'refused') {
      expect({ source: v.source, rule: v.rule, retry: v.retry }).toEqual({ source: e.source, rule: e.rule, retry: e.retry });
      if ('path' in e) expect(v.path).toBe(e.path);
      if ('rules' in e) expect(v.violations.map((x) => x.rule)).toEqual(e.rules);
    }
  });
});

describe('kit: retry', () => {
  const kit = load<{
    policy: { max_attempts: number; base_delay_ms: number; max_delay_ms: number };
    random: number;
    cases: { id: string; responses: Scripted[]; expect: { outcome: string; attempts: number; delays_ms: number[]; same_body?: boolean; token_fetches?: number; rule?: string; last_rule?: string } }[];
  }>('retry.json');

  it.each(kit.cases.map((c) => [c.id, c]))('%s', async (_id, c) => {
    const bus = fakeBus(structuredClone(c.responses));
    const delays: number[] = [];
    const client = new SomBusClient({
      baseUrl: BASE_URL,
      auth: new ClientCredentials({ tokenUrl: TOKEN_URL, clientId: 'kit', clientSecret: 'kit-secret', fetch: bus.fetch }),
      fetch: bus.fetch,
      retry: { maxAttempts: kit.policy.max_attempts, baseDelayMs: kit.policy.base_delay_ms, maxDelayMs: kit.policy.max_delay_ms },
      random: () => kit.random,
      sleep: async (ms) => { delays.push(ms); },
    });
    const env = buildEnvelope({ messageType: 'story.context', payload: { story_id: 'kit-001' }, originatingSystem: { system_id: 'kit', system_type: 'custom' } });

    let outcome: string;
    let verdict: Verdict | undefined;
    let error: unknown;
    try {
      verdict = await client.publish(env);
      outcome = verdict.kind;
    } catch (e) {
      error = e;
      outcome = e instanceof PublishError ? 'unavailable' : 'error';
    }

    const x = c.expect;
    expect(outcome, String(error)).toBe(x.outcome);
    expect(bus.publishCalls).toHaveLength(x.attempts);
    expect(delays).toEqual(x.delays_ms);
    if (x.same_body) expect(new Set(bus.publishCalls.map((p) => p.body)).size).toBe(1);
    if (x.token_fetches !== undefined) expect(bus.tokenCalls).toHaveLength(x.token_fetches);
    if (x.rule) expect(verdict?.kind === 'refused' && verdict.rule).toBe(x.rule);
    if (x.last_rule) expect((error as PublishError).last?.rule).toBe(x.last_rule);
  });
});

describe('kit: validation', () => {
  // Offline validation against the pinned schema pack is the next slice (sdk/DESIGN.md §8).
  // The cases are checked against the gateway itself in the bus's test/sdk.test.ts.
  it.todo('validation cases (needs the SDK validator)');
});
