/**
 * Reference consumer: read your consumer connection's queue over the HTTPS pull API and apply
 * the rules every SOM consumer follows.
 *
 *   SOMBUS_WORKSPACE=w… SOMBUS_CLIENT_ID=… SOMBUS_CLIENT_SECRET=… npm run example:consume
 *
 * - At least once: deduplicate on `message_id`.
 * - Snapshots: keep the highest `sequence_number` per `story_id`; an older one is acknowledged
 *   and ignored.
 * - Unknown message types and extensions are ignored, not failed.
 * - Acknowledge what you handled; release (nack) what you want redelivered.
 *
 * The SDK's consumer module is designed but not built, so this uses fetch and the SDK's token
 * provider. State lives in memory here; a real consumer keeps it in its own store.
 * Stops after SOMBUS_IDLE_POLLS empty long polls (default 3), or runs until Ctrl-C with 0.
 */
import { ClientCredentials, TokenError, type SomEnvelope } from '../../sdk/typescript/src/index.js';
import { env } from '../env.js';

interface Received {
  receipt_handle: string;
  message_type: string;
  receive_count: number;
  envelope: SomEnvelope;
}

const baseUrl = env('SOMBUS_BASE_URL', 'https://api.sombus.rnd-solutions.net/v1/');
const clientId = env('SOMBUS_CLIENT_ID');
const queue = new URL(`tenants/${env('SOMBUS_WORKSPACE')}/consumers/${clientId}/`, baseUrl);
const idleLimit = Number(env('SOMBUS_IDLE_POLLS', '3'));

const auth = new ClientCredentials({
  tokenUrl: new URL('oauth/token', baseUrl).toString(),
  clientId,
  clientSecret: env('SOMBUS_CLIENT_SECRET'),
});

const seen = new Set<string>();               // message_ids already acted on
const latest = new Map<string, number>();     // story_id → highest sequence_number held

async function call(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const token = await auth.getToken({ forceRefresh: retried });
  const r = await fetch(new URL(path, queue), {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  if (r.status === 401 && !retried) return call(path, init, true);   // one new token, then final
  if (r.status === 429 || r.status >= 500) {
    const wait = Number(r.headers.get('retry-after') ?? 5);
    console.error(`  ${r.status}, retrying in ${wait}s`);
    await new Promise((res) => setTimeout(res, wait * 1000));
    return call(path, init, retried);
  }
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(await r.json().catch(() => null))}`);
  return r;
}

/** Returns true when the message is handled (ack it), false to have it redelivered (nack it). */
function handle(m: Received): boolean {
  const e = m.envelope;
  if (seen.has(e.message_id)) return true;                        // a duplicate delivery
  seen.add(e.message_id);

  if (e.message_type !== 'story.context') {
    console.log(`${e.message_type.padEnd(22)} ${e.message_id}  (not handled here)`);
    return true;
  }
  const p = e.payload as { story_id: string; sequence_number: number };
  const held = latest.get(p.story_id) ?? 0;
  if (p.sequence_number <= held) {
    console.log(`story.context          ${p.story_id} seq ${p.sequence_number}  older than ${held}, ignored`);
    return true;
  }
  latest.set(p.story_id, p.sequence_number);
  console.log(`story.context          ${p.story_id} seq ${p.sequence_number}`);
  return true;
}

let idle = 0;
try {
  while (idleLimit === 0 || idle < idleLimit) {
    const { messages } = (await (await call('messages?max=10&wait=20')).json()) as { messages: Received[] };
    if (messages.length === 0) { idle++; continue; }
    idle = 0;

    const ack: string[] = [];
    const nack: string[] = [];
    for (const m of messages) (handle(m) ? ack : nack).push(m.receipt_handle);
    if (ack.length) await call('ack', { method: 'POST', body: JSON.stringify({ receipt_handles: ack }) });
    if (nack.length) await call('nack', { method: 'POST', body: JSON.stringify({ receipt_handles: nack, delay_seconds: 30 }) });
  }
} catch (e) {
  if (!(e instanceof TokenError) || e.retryable) throw e;
  console.error(`token refused (${e.status} ${e.oauthError ?? ''}): check the client id, secret and base URL`);
  process.exit(1);
}
console.log(`idle; holding ${[...latest].map(([s, n]) => `${s}@${n}`).join(', ') || 'no stories'}`);
