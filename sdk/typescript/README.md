# SOM Managed Bus SDK: TypeScript/Node

**Status: first slice, pre-release, not on npm yet.** Producer side: tokens, envelopes, publishing with retries
and typed verdicts. Node 20+, no runtime dependencies. The design is [../DESIGN.md](../DESIGN.md).

## Publish a message

```ts
import { buildEnvelope, ClientCredentials, SomBusClient } from '@rnd-solutions/sombus-sdk';

const bus = new SomBusClient({
  baseUrl: 'https://api.sombus.rnd-solutions.net/v1/',
  publishPath: `tenants/${process.env.SOMBUS_WORKSPACE}/messages`,   // your workspace's route
  auth: new ClientCredentials({
    tokenUrl: 'https://api.sombus.rnd-solutions.net/v1/oauth/token',
    clientId: process.env.SOMBUS_CLIENT_ID!,
    clientSecret: process.env.SOMBUS_CLIENT_SECRET!,
  }),
});

const message = buildEnvelope({
  messageType: 'story.context',
  payload: snapshot,                                   // a whole snapshot, never a delta
  originatingSystem: { system_id: 'acme-ncs-test', system_type: 'ncs', vendor: 'acme' },
  correlationId: story.correlationId,                  // omit for a new story
});

const v = await bus.publish(message);
switch (v.kind) {
  case 'accepted':  /* v.tolerated: warnings to log */ break;
  case 'duplicate': /* an earlier attempt got through: success */ break;
  case 'refused':   /* v.status, v.source, v.rule, v.path: don't resend this message */ break;
}
```

`publish` retries timeouts, `429` and `5xx` with backoff, and a `401` once with a new token,
always resending the same bytes. It rejects with `PublishError` only when the bus never gave a
final answer: keep the message and resend it later, unchanged. A `TokenError` with
`retryable: false` means the credentials are wrong.

A complete producer, and a consumer on the HTTPS pull API, are in [`examples/`](../../examples/).

## Not yet

Offline validation, the dry-run (`validate`) route, SigV4, your own identity provider's tokens,
payload types generated from the schemas, the snapshot helper, the consumer, the executor runtime,
ESM + CJS builds and registry publishing. See [DESIGN.md §2](../DESIGN.md#2-modules).

## Tests

From the repository root: `npm test` runs `test/` here, unit tests with a scripted `fetch` and the
conformance kit runner. The bus's own CI also runs this SDK and the kit against the bus's gateway.
