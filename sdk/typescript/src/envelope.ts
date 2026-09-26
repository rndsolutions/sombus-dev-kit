/**
 * Envelope builder (sdk/DESIGN.md §4).
 *
 * Fills what a producer shouldn't hand-roll: a UUIDv7 `message_id`, an RFC 3339 UTC
 * `timestamp`, `som_version`, the `topic` convention and the causal links. It checks only
 * what it sets or can check cheaply; schema validation is the gateway's (and, later, the
 * SDK validator's) job.
 *
 * Build a message once and keep it until the bus answers: a retry must resend the same
 * `message_id` and content, or the gateway answers `409 message_id.reused`.
 */
import { SOM_VERSION, type JsonObject, type MessageType, type OriginatingSystem, type SomEnvelope } from './types.js';
import { UUID_RE, cryptoRandom, uuidv7, type RandomBytes } from './uuid.js';

export interface EnvelopeInput<P extends object = JsonObject> {
  messageType: MessageType;
  payload: P;
  originatingSystem: OriginatingSystem;
  /** The story's lifecycle id. Omit to start a new one; reuse it for every later message about the story. */
  correlationId?: string;
  /** `message_id` of the message that directly caused this one. */
  causationId?: string;
  /** Default `som.<message_type>`. */
  topic?: string;
  /** Default now. */
  timestamp?: Date | string;
  /** Default a new UUIDv7. Set it only to rebuild a message you already sent. */
  messageId?: string;
  /** Vendor fields, namespaced `com.<vendor>.*`. */
  extensions?: JsonObject;
  modificationHeader?: JsonObject;
}

export interface BuildOptions {
  now?: () => number;
  random?: RandomBytes;
}

export class EnvelopeError extends TypeError {
  constructor(readonly field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = 'EnvelopeError';
  }
}

const MESSAGE_TYPE_RE = /^[a-z][a-z0-9_.]*$/;
const EXTENSION_KEY_RE = /^com\.[a-z0-9-]+\./;

export function topicFor(messageType: string): string {
  return `som.${messageType}`;
}

export function buildEnvelope<P extends object = JsonObject>(input: EnvelopeInput<P>, opts: BuildOptions = {}): SomEnvelope<P> {
  const now = opts.now ?? Date.now;
  const random = opts.random ?? cryptoRandom;
  const { messageType, payload, originatingSystem } = input;

  if (!MESSAGE_TYPE_RE.test(messageType)) throw new EnvelopeError('message_type', `"${messageType}" must match ${MESSAGE_TYPE_RE}`);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new EnvelopeError('payload', 'must be a JSON object');
  if (!originatingSystem?.system_id || !originatingSystem.system_type) throw new EnvelopeError('originating_system', 'system_id and system_type are required');
  const topic = input.topic ?? topicFor(messageType);
  if (!topic.startsWith('som.')) throw new EnvelopeError('topic', `"${topic}" must start with "som."`);
  for (const [field, id] of [['message_id', input.messageId], ['correlation_id', input.correlationId], ['causation_id', input.causationId]] as const) {
    if (id !== undefined && !UUID_RE.test(id)) throw new EnvelopeError(field, `"${id}" is not a UUID`);
  }
  for (const k of Object.keys(input.extensions ?? {})) {
    if (!EXTENSION_KEY_RE.test(k)) throw new EnvelopeError('extensions', `key "${k}" must be namespaced com.<vendor>.*`);
  }

  const t = now();
  const env: SomEnvelope<P> = {
    som_version: SOM_VERSION,
    message_id: input.messageId ?? uuidv7(t, random),
    correlation_id: input.correlationId ?? uuidv7(t, random),
    ...(input.causationId ? { causation_id: input.causationId } : {}),
    message_type: messageType,
    timestamp: toRfc3339(input.timestamp ?? new Date(t)),
    originating_system: { ...originatingSystem },
    topic,
    payload,
    ...(input.modificationHeader ? { modification_header: input.modificationHeader } : {}),
    ...(input.extensions ? { extensions: input.extensions } : {}),
  };
  return env;
}

/**
 * A message caused by another: same story (`correlation_id`), and `causation_id` = the
 * cause's `message_id`. A skill warning raised on a snapshot is the typical case.
 */
export function buildFollowUp<P extends object = JsonObject>(
  cause: Pick<SomEnvelope, 'message_id' | 'correlation_id'>,
  input: Omit<EnvelopeInput<P>, 'correlationId' | 'causationId'>,
  opts: BuildOptions = {},
): SomEnvelope<P> {
  return buildEnvelope({ ...input, correlationId: cause.correlation_id, causationId: cause.message_id }, opts);
}

function toRfc3339(t: Date | string): string {
  if (typeof t === 'string') {
    // RFC 3339 needs a zone; the gateway refuses a timestamp without one.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.test(t)) throw new EnvelopeError('timestamp', `"${t}" is not RFC 3339 with a time zone`);
    return t;
  }
  if (Number.isNaN(t.getTime())) throw new EnvelopeError('timestamp', 'invalid date');
  return t.toISOString();
}
