/**
 * A minimal client for the HTTPS pull API of one consumer connection: receive, ack, nack.
 * The SDK's consumer module is designed but not built; until it is, the examples share this.
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
  workspace: string;
  clientId: string;
  clientSecret: string;
}

export class PullClient {
  private readonly auth: ClientCredentials;
  private readonly queue: URL;

  constructor(o: PullOptions) {
    this.auth = new ClientCredentials({ tokenUrl: new URL('oauth/token', o.baseUrl).toString(), clientId: o.clientId, clientSecret: o.clientSecret });
    this.queue = new URL(`tenants/${o.workspace}/consumers/${o.clientId}/`, o.baseUrl);
  }

  /** Up to 10 messages, long-polling up to 20 seconds. */
  async receive(): Promise<Received[]> {
    return ((await (await this.call('messages?max=10&wait=20')).json()) as { messages: Received[] }).messages;
  }

  async ack(handles: string[]): Promise<void> {
    if (handles.length) await this.call('ack', { method: 'POST', body: JSON.stringify({ receipt_handles: handles }) });
  }

  /** Make messages visible again after `delaySeconds`, for another attempt. */
  async nack(handles: string[], delaySeconds = 30): Promise<void> {
    if (handles.length) await this.call('nack', { method: 'POST', body: JSON.stringify({ receipt_handles: handles, delay_seconds: delaySeconds }) });
  }

  private async call(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
    const token = await this.auth.getToken({ forceRefresh: retried });
    const r = await fetch(new URL(path, this.queue), {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    if (r.status === 401 && !retried) return this.call(path, init, true);   // one new token, then final
    if (r.status === 429 || r.status >= 500) {
      const wait = Number(r.headers.get('retry-after') ?? 5);
      console.error(`  ${r.status}, retrying in ${wait}s`);
      await new Promise((res) => setTimeout(res, wait * 1000));
      return this.call(path, init, retried);
    }
    if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(await r.json().catch(() => null))}`);
    return r;
  }
}
