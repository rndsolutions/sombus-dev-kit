/**
 * SOM Managed Bus SDK for TypeScript/Node: first slice (producer side).
 * The design every language follows is sdk/DESIGN.md.
 */
export * from './types.js';
export { uuidv7, UUID_RE, type RandomBytes } from './uuid.js';
export { buildEnvelope, buildFollowUp, topicFor, EnvelopeError, type EnvelopeInput, type BuildOptions } from './envelope.js';
export { ClientCredentials, StaticToken, TokenError, type TokenProvider, type ClientCredentialsOptions } from './auth.js';
export { parseVerdict, retryClass, type Verdict, type Accepted, type Duplicate, type Refused, type RetryClass } from './verdict.js';
export { SomBusClient, PublishError, DEFAULT_RETRY, type SomBusClientOptions, type RetryPolicy, type AttemptEvent } from './client.js';
