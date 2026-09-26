/**
 * Auth (sdk/DESIGN.md §5): OAuth2 client credentials against the vendor token URL.
 *
 * One token per client, cached until shortly before `expires_in` runs out, fetched once
 * however many publishes wait on it. The secret and the token are never logged or put in
 * an error message.
 */

export interface TokenProvider {
  /** A bearer token. `forceRefresh` after the bus answered 401 to the cached one. */
  getToken(opts?: { forceRefresh?: boolean }): Promise<string>;
}

export interface ClientCredentialsOptions {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** Default `sombus/publish`. */
  scope?: string;
  /** Refresh this long before expiry. Default 60 s. */
  refreshSkewMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  /** Per request. Default 10 s. */
  timeoutMs?: number;
}

/**
 * The token endpoint said no, or couldn't be reached. `retryable` is false for a refusal
 * (`invalid_client`, `invalid_scope`…): that is configuration, and retrying won't fix it.
 */
export class TokenError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean, readonly oauthError?: string) {
    super(message);
    this.name = 'TokenError';
  }
}

export class ClientCredentials implements TokenProvider {
  private cached?: { token: string; refreshAt: number };
  private inflight?: Promise<string>;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly o: ClientCredentialsOptions) {
    this.fetch = o.fetch ?? globalThis.fetch;
    this.now = o.now ?? Date.now;
  }

  async getToken(opts: { forceRefresh?: boolean } = {}): Promise<string> {
    if (opts.forceRefresh) this.cached = undefined;
    if (this.cached && this.now() < this.cached.refreshAt) return this.cached.token;
    this.inflight ??= this.fetchToken().finally(() => { this.inflight = undefined; });
    return this.inflight;
  }

  private async fetchToken(): Promise<string> {
    const { tokenUrl, clientId, clientSecret } = this.o;
    // RFC 6749 §2.3.1: form-encode id and secret, then HTTP Basic.
    const basic = btoa(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`);
    let r: Response;
    try {
      r = await this.fetch(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` },
        body: new URLSearchParams({ grant_type: 'client_credentials', scope: this.o.scope ?? 'sombus/publish' }).toString(),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 10_000),
      });
    } catch (e) {
      throw new TokenError(`token endpoint unreachable: ${(e as Error).name}`, 0, true);
    }
    const body = (await r.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown; error?: unknown };
    if (!r.ok || typeof body.access_token !== 'string') {
      const oauthError = typeof body.error === 'string' ? body.error : undefined;
      const retryable = r.status === 429 || r.status >= 500;
      throw new TokenError(`token endpoint answered ${r.status}${oauthError ? ` ${oauthError}` : ''}`, r.status, retryable, oauthError);
    }
    const ttlMs = (typeof body.expires_in === 'number' ? body.expires_in : 3600) * 1000;
    // Never cache past half the lifetime on a short-lived token.
    const skew = Math.min(this.o.refreshSkewMs ?? 60_000, ttlMs / 2);
    this.cached = { token: body.access_token, refreshAt: this.now() + ttlMs - skew };
    return body.access_token;
  }
}

/** A fixed bearer token you manage yourself, such as one from your own identity provider. */
export class StaticToken implements TokenProvider {
  constructor(private readonly token: string) {}
  async getToken(): Promise<string> {
    return this.token;
  }
}
