/**
 * Run raise-flag-on-match against your workspace: read triggers through a consumer connection,
 * publish warnings through a producer connection.
 *
 *   SOMBUS_WORKSPACE=w… \
 *   SOMBUS_READER_ID=… SOMBUS_READER_SECRET=… \
 *   SOMBUS_PUBLISHER_ID=… SOMBUS_PUBLISHER_SECRET=… SOMBUS_SYSTEM_ID=acme-flags-01 \
 *     npm run executor:raise-flag-on-match
 *
 * Then start the skill harness from the portal (Test runs) and watch the cases pass.
 * A trigger is acknowledged only once its warnings have a final answer, so nothing is lost if
 * the executor stops mid-way: the trigger comes back and the stored warning is sent again.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClientCredentials, PublishError, SomBusClient, TokenError, type SystemType } from '../../sdk/typescript/src/index.js';
import { env } from '../../examples/env.js';
import { PullClient, type Received } from '../../examples/lib/pull.js';
import { createExecutor } from './src/executor.js';

const baseUrl = env('SOMBUS_BASE_URL', 'https://api.sombus.rnd-solutions.net/v1/');
const workspace = env('SOMBUS_WORKSPACE');
const instanceFile = env('SOMBUS_INSTANCE', join(import.meta.dirname, 'instances', 'house-breaking-indicative-category.json'));

const executor = createExecutor({
  instance: JSON.parse(readFileSync(instanceFile, 'utf8')),
  // P-02: the SOM system_type closest to the tool this executor sits beside.
  originatingSystem: { system_id: env('SOMBUS_SYSTEM_ID'), system_type: env('SOMBUS_SYSTEM_TYPE', 'ncs') as SystemType },
});

const reader = new PullClient({ baseUrl, workspace, clientId: env('SOMBUS_READER_ID'), clientSecret: env('SOMBUS_READER_SECRET') });
const publisher = new SomBusClient({
  baseUrl,
  publishPath: `tenants/${workspace}/messages`,
  auth: new ClientCredentials({ tokenUrl: new URL('oauth/token', baseUrl).toString(), clientId: env('SOMBUS_PUBLISHER_ID'), clientSecret: env('SOMBUS_PUBLISHER_SECRET') }),
});

/** true: acknowledge the trigger. false: release it for another attempt. */
async function handle(r: Received): Promise<boolean> {
  const m = r.envelope;
  const about = m.message_type === 'story.context' ? `${String(m.payload.story_id)} seq ${String(m.payload.sequence_number)}` : m.correlation_id;
  const warnings = executor.deliver(m);
  if (warnings.length === 0) {
    console.log(`${m.message_type.padEnd(22)} ${about}  nothing to raise`);
    return true;
  }
  for (const w of warnings) {
    try {
      const v = await publisher.publish(w);
      const ref = String(w.payload.skill_warning_ref);
      if (v.kind === 'refused') console.error(`${m.message_type.padEnd(22)} ${about}  warning REFUSED ${v.status} ${v.rule}${v.path ? ` at ${v.path}` : ''}`);
      else console.log(`${m.message_type.padEnd(22)} ${about}  raised ${ref}${v.kind === 'duplicate' ? ' (already on the bus)' : ''}`);
    } catch (e) {
      if (e instanceof PublishError) {
        console.error(`${m.message_type.padEnd(22)} ${about}  no answer for ${e.messageId}; the trigger will come back`);
        return false;
      }
      throw e;
    }
  }
  return true;   // accepted, duplicate, or refused: all final
}

console.log(`raise-flag-on-match on workspace ${workspace}; Ctrl-C to stop`);
try {
  for (;;) {
    const ack: string[] = [];
    const nack: string[] = [];
    for (const r of await reader.receive()) ((await handle(r)) ? ack : nack).push(r.receipt_handle);
    await reader.ack(ack);
    await reader.nack(nack, 5);
  }
} catch (e) {
  if (!(e instanceof TokenError) || e.retryable) throw e;
  console.error(`token refused (${e.status} ${e.oauthError ?? ''}): check both connections' ids, secrets and the base URL`);
  process.exit(1);
}
