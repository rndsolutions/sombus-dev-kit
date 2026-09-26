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
 * State lives in memory here; a real consumer keeps it in its own store.
 * Stops after SOMBUS_IDLE_POLLS empty long polls (default 3), or runs until Ctrl-C with 0.
 */
import { TokenError } from '../../sdk/typescript/src/index.js';
import { env } from '../env.js';
import { PullClient, type Received } from '../lib/pull.js';

const queue = new PullClient({
  baseUrl: env('SOMBUS_BASE_URL', 'https://api.sombus.rnd-solutions.net/v1/'),
  workspace: env('SOMBUS_WORKSPACE'),
  clientId: env('SOMBUS_CLIENT_ID'),
  clientSecret: env('SOMBUS_CLIENT_SECRET'),
});
const idleLimit = Number(env('SOMBUS_IDLE_POLLS', '3'));

const seen = new Set<string>();               // message_ids already acted on
const latest = new Map<string, number>();     // story_id → highest sequence_number held

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
    const messages = await queue.receive();
    if (messages.length === 0) { idle++; continue; }
    idle = 0;

    const ack: string[] = [];
    const nack: string[] = [];
    for (const m of messages) (handle(m) ? ack : nack).push(m.receipt_handle);
    await queue.ack(ack);
    await queue.nack(nack);
  }
} catch (e) {
  if (!(e instanceof TokenError) || e.retryable) throw e;
  console.error(`token refused (${e.status} ${e.oauthError ?? ''}): check the client id, secret and base URL`);
  process.exit(1);
}
console.log(`idle; holding ${[...latest].map(([s, n]) => `${s}@${n}`).join(', ') || 'no stories'}`);
