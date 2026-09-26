/**
 * Reference producer: publish one story's seven snapshots to your workspace with the SDK, and
 * handle every verdict the way a production producer should.
 *
 *   SOMBUS_WORKSPACE=w… SOMBUS_CLIENT_ID=… SOMBUS_CLIENT_SECRET=… SOMBUS_SYSTEM_ID=acme-ncs-test \
 *     npm run example:publish
 *
 * The snapshots are the published SOM 1.0 hurricane run (upstream/som-1.0/examples). Each run
 * gives the story a fresh `story_id`, so you can run it again: the bus refuses a snapshot that
 * isn't newer than the last one it accepted for a story.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildEnvelope, ClientCredentials, PublishError, SomBusClient, TokenError, type JsonObject, type SystemType } from '../../sdk/typescript/src/index.js';
import { env } from '../env.js';

const baseUrl = env('SOMBUS_BASE_URL', 'https://api.sombus.rnd-solutions.net/v1/');
const workspace = env('SOMBUS_WORKSPACE');

const bus = new SomBusClient({
  baseUrl,
  publishPath: `tenants/${workspace}/messages`,
  auth: new ClientCredentials({
    tokenUrl: new URL('oauth/token', baseUrl).toString(),
    clientId: env('SOMBUS_CLIENT_ID'),
    clientSecret: env('SOMBUS_CLIENT_SECRET'),
  }),
  // Identifiers only: never log the payload or the token.
  onAttempt: (e) => e.outcome !== 'accepted' && console.error(`  attempt ${e.attempt} ${e.message_id}: ${e.status ?? '-'} ${e.outcome} ${e.rule ?? ''}`),
});

// Your connection's app must have claimed this system_id in the portal (Apps).
const originatingSystem = {
  system_id: env('SOMBUS_SYSTEM_ID'),
  system_type: env('SOMBUS_SYSTEM_TYPE', 'ncs') as SystemType,
  vendor: env('SOMBUS_VENDOR', 'example'),
};

const dir = join(import.meta.dirname, '..', '..', 'upstream', 'som-1.0', 'examples', 'hurricane-run');
const snapshots = readdirSync(dir).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as JsonObject);
const storyId = `${snapshots[0].story_id}.${Date.now().toString(36)}`;

let correlationId: string | undefined;
for (const snapshot of snapshots) {
  // Build once, keep it until the bus gives a final answer: a resend must be the same bytes.
  const message = buildEnvelope({
    messageType: 'story.context',
    payload: { ...snapshot, story_id: storyId },   // always a whole snapshot, never a delta
    originatingSystem,
    correlationId,                                 // unset for the first message: a new story
  });
  correlationId = message.correlation_id;          // every later message about the story reuses it

  try {
    const v = await bus.publish(message);
    switch (v.kind) {
      case 'accepted':
        console.log(`accepted  seq ${snapshot.sequence_number}  ${v.messageId}${v.tolerated.length ? `  tolerated: ${v.tolerated.map((t) => t.rule).join(', ')}` : ''}`);
        break;
      case 'duplicate':
        console.log(`duplicate seq ${snapshot.sequence_number}  ${v.messageId}  (an earlier attempt got through)`);
        break;
      case 'refused':
        // Final: fix the message or your connection, don't resend this one.
        console.error(`refused   seq ${snapshot.sequence_number}  ${v.status} ${v.source} ${v.rule}${v.path ? ` at ${v.path}` : ''}`);
        process.exit(1);
    }
  } catch (e) {
    if (e instanceof TokenError && !e.retryable) {
      console.error(`token refused (${e.status} ${e.oauthError ?? ''}): check the client id, secret and base URL`);
    } else if (e instanceof PublishError) {
      // No final answer after every retry. A real producer keeps the message in an outbox
      // and resends it later, unchanged.
      console.error(`no final answer for ${e.messageId} after ${e.attempts} attempts`);
    } else {
      throw e;
    }
    process.exit(1);
  }
}
console.log(`story ${storyId}, correlation ${correlationId}`);
