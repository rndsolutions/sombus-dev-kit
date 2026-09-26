import { describe, expect, it } from 'vitest';
import {
  buildEnvelope, ClientCredentials, PublishError, SomBusClient, StaticToken, TokenError, uuidv7, UUID_RE, type AttemptEvent,
} from '../src/index.js';
import { BASE_URL, fakeBus, TOKEN_URL } from './fakes.js';

const ACCEPTED = { status: 202, body: { accepted: true, message_id: '{message_id}', message_type: 'story.context', family: 'story-context' } };
const message = () => buildEnvelope({
  messageType: 'story.context',
  payload: { story_id: 'sdk-001', sequence_number: 1, headline: 'secret draft headline' },
  originatingSystem: { system_id: 'acme-ncs-test', system_type: 'ncs' },
});

describe('uuidv7', () => {
  it('is a version-7, variant-10 UUID, ordered by time', () => {
    const a = uuidv7(1_000);
    const b = uuidv7(2_000);
    expect(a).toMatch(UUID_RE);
    expect(a[14]).toBe('7');
    expect('89ab').toContain(a[19]);
    expect(a < b).toBe(true);
  });

  it('is unique within one millisecond', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(5_000)));
    expect(ids.size).toBe(1000);
  });
});

describe('ClientCredentials', () => {
  const creds = (bus: ReturnType<typeof fakeBus>, now = () => 0) =>
    new ClientCredentials({ tokenUrl: TOKEN_URL, clientId: 'app id', clientSecret: 's3cr+t', fetch: bus.fetch, now });

  it('sends a client-credentials grant with HTTP Basic and scope sombus/publish', async () => {
    const bus = fakeBus([]);
    expect(await creds(bus).getToken()).toBe('token-1');
    const call = bus.tokenCalls[0];
    expect(call.authorization).toBe(`Basic ${btoa('app%20id:s3cr%2Bt')}`);
    expect(Object.fromEntries(new URLSearchParams(call.body))).toEqual({ grant_type: 'client_credentials', scope: 'sombus/publish' });
  });

  it('caches until shortly before expiry, then fetches a new one', async () => {
    let t = 0;
    const bus = fakeBus([]);
    const c = creds(bus, () => t);
    await c.getToken();
    t = 3_539_000; // 1 s before the 60 s refresh margin
    expect(await c.getToken()).toBe('token-1');
    t = 3_540_000;
    expect(await c.getToken()).toBe('token-2');
    expect(bus.tokenCalls).toHaveLength(2);
  });

  it('fetches once for concurrent callers', async () => {
    const bus = fakeBus([]);
    const c = creds(bus);
    const tokens = await Promise.all(Array.from({ length: 10 }, () => c.getToken()));
    expect(new Set(tokens)).toEqual(new Set(['token-1']));
    expect(bus.tokenCalls).toHaveLength(1);
  });

  it('forceRefresh drops the cached token', async () => {
    const bus = fakeBus([]);
    const c = creds(bus);
    await c.getToken();
    expect(await c.getToken({ forceRefresh: true })).toBe('token-2');
  });

  it('a refused client is not retryable, and the error never carries the secret', async () => {
    const bus = fakeBus([], { tokens: [{ status: 400, body: { error: 'invalid_client' } }] });
    const err = await creds(bus).getToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TokenError);
    expect(err).toMatchObject({ status: 400, retryable: false, oauthError: 'invalid_client' });
    expect(String((err as Error).message)).not.toContain('s3cr');
  });

  it('a 5xx from the token endpoint is retryable', async () => {
    const bus = fakeBus([], { tokens: [{ status: 503, body: {} }] });
    await expect(creds(bus).getToken()).rejects.toMatchObject({ retryable: true });
  });
});

describe('SomBusClient', () => {
  it('posts to <baseUrl>/jwt/messages with the bearer token', async () => {
    const bus = fakeBus([ACCEPTED]);
    const client = new SomBusClient({ baseUrl: 'https://api.example.test/v1', auth: new StaticToken('t0k'), fetch: bus.fetch });
    const v = await client.publish(message());
    expect(v.kind).toBe('accepted');
    expect(bus.publishCalls[0]).toMatchObject({ url: 'https://api.example.test/v1/jwt/messages', authorization: 'Bearer t0k' });
  });

  it('publishes a stored message string as is', async () => {
    const bus = fakeBus([ACCEPTED]);
    const raw = JSON.stringify(message());
    const v = await new SomBusClient({ baseUrl: BASE_URL, publishPath: 'messages', auth: new StaticToken('t'), fetch: bus.fetch }).publish(raw);
    expect(bus.publishCalls[0].body).toBe(raw);
    expect(bus.publishCalls[0].url).toBe('https://api.example.test/v1/messages');
    expect(v).toMatchObject({ kind: 'accepted', messageId: JSON.parse(raw).message_id });
  });

  it('reports each attempt with identifiers only', async () => {
    const bus = fakeBus(['network_error', ACCEPTED]);
    const events: AttemptEvent[] = [];
    const client = new SomBusClient({ baseUrl: BASE_URL, auth: new StaticToken('t0k'), fetch: bus.fetch, sleep: async () => {}, random: () => 1, onAttempt: (e) => events.push(e) });
    const m = message();
    await client.publish(m);
    expect(events).toEqual([
      { message_id: m.message_id, attempt: 1, status: null, outcome: 'network_error', delay_ms: 500 },
      { message_id: m.message_id, attempt: 2, status: 202, outcome: 'accepted' },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/secret draft|t0k/);
  });

  it('a throwing onAttempt hook never causes a resend', async () => {
    const bus = fakeBus([ACCEPTED]);
    const client = new SomBusClient({ baseUrl: BASE_URL, auth: new StaticToken('t'), fetch: bus.fetch, onAttempt: () => { throw new Error('logger down'); } });
    await expect(client.publish(message())).rejects.toThrow('logger down');
    expect(bus.publishCalls).toHaveLength(1);
  });

  it('jitters each backoff between half and all of its ceiling', () => {
    const lo = new SomBusClient({ baseUrl: BASE_URL, auth: new StaticToken('t'), random: () => 0 });
    const hi = new SomBusClient({ baseUrl: BASE_URL, auth: new StaticToken('t'), random: () => 0.999999 });
    expect([1, 2, 3, 4, 8, 9].map((n) => lo.backoff(n))).toEqual([250, 500, 1000, 2000, 15000, 15000]);
    expect([1, 2, 3, 4, 8, 9].map((n) => hi.backoff(n))).toEqual([500, 1000, 2000, 4000, 30000, 30000]);
  });

  it('stops at once when the token endpoint refuses the credentials', async () => {
    const bus = fakeBus([], { tokens: [{ status: 400, body: { error: 'invalid_client' } }] });
    const client = new SomBusClient({ baseUrl: BASE_URL, auth: new ClientCredentials({ tokenUrl: TOKEN_URL, clientId: 'a', clientSecret: 'b', fetch: bus.fetch }), fetch: bus.fetch, sleep: async () => {} });
    await expect(client.publish(message())).rejects.toBeInstanceOf(TokenError);
    expect(bus.publishCalls).toHaveLength(0);
  });

  it('retries a token endpoint outage like any other outage', async () => {
    const bus = fakeBus([ACCEPTED], { tokens: [{ status: 503, body: {} }] });
    const client = new SomBusClient({ baseUrl: BASE_URL, auth: new ClientCredentials({ tokenUrl: TOKEN_URL, clientId: 'a', clientSecret: 'b', fetch: bus.fetch }), fetch: bus.fetch, sleep: async () => {} });
    expect((await client.publish(message())).kind).toBe('accepted');
    expect(bus.tokenCalls).toHaveLength(2);
  });

  it('gives up with a PublishError that keeps the message id for a later resend', async () => {
    const bus = fakeBus(['timeout', 'timeout']);
    const client = new SomBusClient({ baseUrl: BASE_URL, auth: new StaticToken('t'), fetch: bus.fetch, sleep: async () => {}, retry: { maxAttempts: 2 } });
    const m = message();
    const err = await client.publish(m).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect(err).toMatchObject({ messageId: m.message_id, attempts: 2 });
  });
});
