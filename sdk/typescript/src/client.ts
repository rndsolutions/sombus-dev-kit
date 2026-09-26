/**
 * Publisher (sdk/DESIGN.md §6, §7).
 *
 *   const bus = new SomBusClient({ baseUrl, auth: new ClientCredentials({ tokenUrl, clientId, clientSecret }) });
 *   const v = await bus.publish(buildEnvelope({ ... }));
 *   if (v.kind === 'refused') ...   // v.source, v.rule, v.path
 *
 * publish() resolves with the bus's final answer (Accepted, Duplicate or Refused) and
 * rejects only when there is none: retries exhausted or the token endpoint refused the
 * credentials. The body is serialised once, so every attempt sends the same bytes.
 */
import type { TokenProvider } from './auth.js';
import { TokenError } from './auth.js';
import type { SomEnvelope } from './types.js';
import { parseVerdict, type Refused, type Verdict } from './verdict.js';

export interface RetryPolicy {
  /** Attempts in total, including the first. Default 5. */
  maxAttempts: number;
  /** Ceiling of the first backoff. Default 500 ms, doubling per retry. */
  baseDelayMs: number;
  /** Cap on any one backoff, `Retry-After` included. Default 30 s. */
  maxDelayMs: number;
  /** Per attempt; a timeout counts as "unknown whether it arrived" and is retried. Default 10 s. */
  timeoutMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 5, baseDelayMs: 500, maxDelayMs: 30_000, timeoutMs: 10_000 };

/** One line per attempt, for your logs and metrics. Identifiers only, never the payload or the token. */
export interface AttemptEvent {
  message_id: string;
  attempt: number;
  status: number | null;
  outcome: Verdict['kind'] | 'network_error' | 'token_error';
  rule?: string;
  /** Before the next attempt, if there is one. */
  delay_ms?: number;
}

export interface SomBusClientOptions {
  /** e.g. `https://api.sombus.rnd-solutions.net/v1/` or `http://localhost:8787/v1/`. */
  baseUrl: string;
  auth: TokenProvider;
  /** Relative to baseUrl. A workspace app uses `tenants/{t}/messages`; the default `jwt/messages` is for apps RND manages. */
  publishPath?: string;
  retry?: Partial<RetryPolicy>;
  fetch?: typeof fetch;
  onAttempt?: (e: AttemptEvent) => void;
  /** Test seams: the conformance kit runs with random = () => 1 and a recording sleep. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** No final answer from the bus. Safe to resend later with the same message_id and body. */
export class PublishError extends Error {
  constructor(
    message: string,
    readonly messageId: string,
    readonly attempts: number,
    /** The last answer, if the bus answered at all (e.g. 429 or 503 every time). */
    readonly last?: Refused,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PublishError';
  }
}

export class SomBusClient {
  private readonly retry: RetryPolicy;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly publishUrl: URL;

  constructor(private readonly o: SomBusClientOptions) {
    this.retry = { ...DEFAULT_RETRY, ...o.retry };
    this.fetch = o.fetch ?? globalThis.fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = o.random ?? Math.random;
    const base = o.baseUrl.endsWith('/') ? o.baseUrl : `${o.baseUrl}/`;
    this.publishUrl = new URL(o.publishPath ?? 'jwt/messages', base);
  }

  /** Publish one message. Pass the envelope object, or its JSON if you stored it for a resend. */
  async publish(message: SomEnvelope<object> | string): Promise<Verdict> {
    const body = typeof message === 'string' ? message : JSON.stringify(message);
    const messageId = typeof message === 'string' ? idOf(body) : message.message_id;
    const { maxAttempts } = this.retry;
    let refreshed = false;
    let refreshNext = false;
    let last: Refused | undefined;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const event: AttemptEvent = { message_id: messageId, attempt, status: null, outcome: 'network_error' };
      let retryAfterMs: number | undefined;
      let verdict: Verdict | undefined;
      try {
        const token = await this.o.auth.getToken({ forceRefresh: refreshNext });
        refreshNext = false;
        const r = await this.fetch(this.publishUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body,
          signal: AbortSignal.timeout(this.retry.timeoutMs),
        });
        verdict = parseVerdict(r.status, await r.json().catch(() => null));
        retryAfterMs = parseRetryAfter(r.headers.get('retry-after'));
      } catch (e) {
        if (e instanceof TokenError) {
          event.outcome = 'token_error';
          if (!e.retryable) {
            this.o.onAttempt?.(event);
            throw e;
          }
        }
        lastError = e;
      }
      if (verdict) {
        Object.assign(event, { status: verdict.status, outcome: verdict.kind, ...(verdict.kind === 'refused' ? { rule: verdict.rule } : {}) });
        if (verdict.kind !== 'refused' || verdict.retry === 'none') return this.done(event, verdict);
        last = verdict;
        if (verdict.retry === 'refresh_token') {
          // Once: a second 401 with a fresh token is configuration, not expiry.
          if (refreshed || attempt === maxAttempts) return this.done(event, verdict);
          refreshed = refreshNext = true;
          this.o.onAttempt?.(event);
          continue;
        }
      }
      if (attempt === maxAttempts) {
        this.o.onAttempt?.(event);
        break;
      }
      event.delay_ms = this.backoff(attempt, retryAfterMs);
      this.o.onAttempt?.(event);
      await this.sleep(event.delay_ms);
    }
    throw new PublishError(
      `no final answer after ${maxAttempts} attempts${last ? ` (last: ${last.status} ${last.rule})` : ''}; resend later with the same message_id`,
      messageId, maxAttempts, last, lastError,
    );
  }

  /** Before retry n (n ≥ 1): min(cap, base·2^(n−1)) × (0.5 + 0.5·r), or Retry-After if the bus sent one. */
  backoff(n: number, retryAfterMs?: number): number {
    const { baseDelayMs, maxDelayMs } = this.retry;
    if (retryAfterMs !== undefined) return Math.min(maxDelayMs, retryAfterMs);
    const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (n - 1));
    return Math.round(ceiling * (0.5 + 0.5 * this.random()));
  }

  private done(event: AttemptEvent, v: Verdict): Verdict {
    this.o.onAttempt?.(event);
    return v;
  }
}

function idOf(body: string): string {
  try {
    const id = (JSON.parse(body) as { message_id?: unknown }).message_id;
    return typeof id === 'string' ? id : '';
  } catch {
    return '';
  }
}

function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s) && s >= 0) return s * 1000;
  const at = Date.parse(h);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}
