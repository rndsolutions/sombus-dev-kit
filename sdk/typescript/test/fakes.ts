/** A scripted fetch: a token endpoint and a publish endpoint, recording every call. */

export const TOKEN_URL = 'https://auth.example.test/oauth2/token';
export const BASE_URL = 'https://api.example.test/v1/';

export type Scripted = 'network_error' | 'timeout' | { status: number; body?: unknown; headers?: Record<string, string> };

export interface FakeBus {
  fetch: typeof fetch;
  tokenCalls: { authorization: string | null; body: string }[];
  publishCalls: { url: string; authorization: string | null; body: string }[];
}

export function fakeBus(publish: Scripted[], opts: { tokens?: Scripted[]; expiresIn?: number } = {}): FakeBus {
  const bus: FakeBus = { tokenCalls: [], publishCalls: [], fetch: undefined as never };
  let issued = 0;
  bus.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = String(init?.body ?? '');
    if (url === TOKEN_URL) {
      bus.tokenCalls.push({ authorization: headers.get('authorization'), body });
      const s = opts.tokens?.shift() ?? { status: 200, body: { access_token: `token-${++issued}`, expires_in: opts.expiresIn ?? 3600, token_type: 'Bearer' } };
      return answer(s);
    }
    bus.publishCalls.push({ url, authorization: headers.get('authorization'), body });
    const s = publish.shift();
    if (!s) throw new Error('fake bus: no scripted answer left');
    return answer(s, (JSON.parse(body) as { message_id?: string }).message_id);
  }) as typeof fetch;
  return bus;
}

function answer(s: Scripted, messageId = ''): Response {
  if (s === 'network_error') throw new TypeError('fetch failed');
  if (s === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  const text = s.body === undefined || s.body === null ? '' : JSON.stringify(s.body).replaceAll('{message_id}', messageId);
  return new Response(text, { status: s.status, headers: { 'content-type': 'application/json', ...s.headers } });
}

/** 16 zero bytes: UUIDv7s then depend only on the clock. */
export const zeroRandom = (n: number) => new Uint8Array(n);
