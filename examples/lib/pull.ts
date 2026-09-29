/**
 * A minimal client for the HTTPS pull API of one consumer connection: receive, ack, nack, and a skill
 * executor's registrations. The SDK's consumer module is designed but not built; until it is, the
 * examples share this.
 * Docs: https://sombus.rnd-solutions.net/docs/consumer/pull-api
 */
import { ClientCredentials, type SomEnvelope } from '../../sdk/typescript/src/index.js';

export interface Received {
  receipt_handle: string;
  message_type: string;
  receive_count: number;
  envelope: SomEnvelope;
}

export interface PullOptions {
  baseUrl: string;
  /** The workspace id. Omit it to read it from the connection's token (its `tenant` claim). */
  workspace?: string;
  clientId: string;
  clientSecret: string;
  /** Default `<baseUrl>oauth/token`. */
  tokenUrl?: string;
  fetch?: typeof fetch;
  /** Told about each throttled or failed call before it is retried. Default: a line on stderr. */
  onRetry?: (status: number, waitSeconds: number) => void;
}

/** A registration the house bound to a skill executor's connection. */
export interface SkillRegistration {
  skill_id: string;
  skill_version?: string;
  instance_label: string;
  values: Record<string, unknown>;
  paused?: boolean;
}

export class PullClient {
  readonly auth: ClientCredentials;
  private readonly base: URL;
  private readonly fetch: typeof fetch;
  private queue?: URL;

  constructor(private readonly o: PullOptions) {
    this.base = new URL(o.baseUrl.endsWith('/') ? o.baseUrl : `${o.baseUrl}/`);
    this.fetch = o.fetch ?? globalThis.fetch;
    this.auth = new ClientCredentials({
      tokenUrl: o.tokenUrl ?? new URL('oauth/token', this.base).toString(), clientId: o.clientId, clientSecret: o.clientSecret, fetch: this.fetch,
    });
    if (o.workspace) this.queue = this.queueUrl(o.workspace);
  }

  /** Up to 10 messages, long-polling up to `waitSeconds` (default and most 20). */
  async receive(opts: { waitSeconds?: number; signal?: AbortSignal } = {}): Promise<Received[]> {
    const wait = Math.max(0, Math.min(20, Math.floor(opts.waitSeconds ?? 20)));
    return ((await (await this.call(`messages?max=10&wait=${wait}`, {}, false, opts.signal)).json()) as { messages: Received[] }).messages;
  }

  async ack(handles: string[]): Promise<void> {
    if (handles.length) await this.call('ack', { method: 'POST', body: JSON.stringify({ receipt_handles: handles }) });
  }

  /** Make messages visible again after `delaySeconds`, for another attempt. */
  async nack(handles: string[], delaySeconds = 30): Promise<void> {
    if (handles.length) await this.call('nack', { method: 'POST', body: JSON.stringify({ receipt_handles: handles, delay_seconds: delaySeconds }) });
  }

  /** A skill executor's registrations: the configured instances the house bound to this connection. */
  async skills(): Promise<SkillRegistration[]> {
    const body = (await (await this.call('skills')).json()) as { registrations?: SkillRegistration[] };
    return Array.isArray(body.registrations) ? body.registrations : [];
  }

  private queueUrl(workspace: string) {
    return new URL(`tenants/${workspace}/consumers/${this.o.clientId}/`, this.base);
  }

  /** The queue's URL; the workspace from the token when it wasn't given. */
  private async queueOf(): Promise<URL> {
    this.queue ??= this.queueUrl(tenantOf(await this.auth.getToken()));
    return this.queue;
  }

  private async call(path: string, init: RequestInit = {}, retried = false, signal?: AbortSignal): Promise<Response> {
    signal?.throwIfAborted();
    const token = await this.auth.getToken({ forceRefresh: retried });
    const r = await this.fetch(new URL(path, await this.queueOf()), {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(signal ? { signal } : {}),
    });
    if (r.status === 401 && !retried) return this.call(path, init, true, signal);   // one new token, then final
    if (r.status === 429 || r.status >= 500) {
      const wait = Number(r.headers.get('retry-after') ?? 5);
      if (this.o.onRetry) this.o.onRetry(r.status, wait);
      else console.error(`  ${r.status}, retrying in ${wait}s`);
      await new Promise((res) => setTimeout(res, wait * 1000));
      return this.call(path, init, retried, signal);
    }
    if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(await r.json().catch(() => null))}`);
    return r;
  }
}

/** The workspace a bus token belongs to: its `tenant` claim. Read, not verified: the bus verifies it. */
export function tenantOf(token: string): string {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { tenant?: unknown };
    if (typeof claims.tenant === 'string' && /^[A-Za-z0-9_-]+$/.test(claims.tenant)) return claims.tenant;
  } catch { /* below */ }
  throw new Error('the token names no workspace (no tenant claim): give the workspace id');
}
