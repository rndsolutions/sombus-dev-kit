/**
 * SOM 1.0 envelope types and the bus's answer format (sdk/DESIGN.md §3, §6).
 *
 * Handwritten for this first slice; generated from the pinned schema pack later (DESIGN §9).
 * Enums stay open (`| (string & {})`): a 1.x message may carry members 1.0 doesn't list.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export const SOM_VERSION = '1.0.0';

/** `originating_system.system_type` in SOM 1.0. */
export type SystemType =
  | 'ncs' | 'mos_device' | 'graphics' | 'automation' | 'wire_service' | 'ai_agent'
  | 'compliance_engine' | 'editorial_dashboard' | 'archive' | 'prompter' | 'camera'
  | 'audio' | 'skill_worker' | 'custom'
  | (string & {});

export interface OriginatingSystem {
  system_id: string;
  system_type: SystemType;
  system_name?: string;
  vendor?: string;
  version?: string;
}

/** The message families with a SOM 1.0 schema. Any other `message_type` is allowed on the wire. */
export type MessageType =
  | 'story.context'
  | 'telling.started' | 'telling.ended' | 'telling.exposed'
  | 'link.committed' | 'link.gate_changed' | 'link.withdrawn'
  | 'delivery.media_available'
  | 'skill.warning.raised'
  | 'system.audit'
  | (string & {});

export interface SomEnvelope<P extends object = JsonObject> {
  som_version: string;
  message_id: string;
  correlation_id: string;
  causation_id?: string;
  message_type: MessageType;
  timestamp: string;
  originating_system: OriginatingSystem;
  topic: string;
  payload: P;
  modification_header?: JsonObject;
  extensions?: JsonObject;
  _actors?: JsonObject;
  '@context'?: Json;
}

/**
 * Where a refusal came from, as the gateway reports it. `transport` is the SDK's own:
 * an answer that isn't in the gateway's format (a proxy, a throttle, a timeout page).
 * Open, like the enums: a later bus may add a source.
 */
export type RuleSource = 'schema' | 'conformance' | 'sequence' | 'policy' | 'transport' | (string & {});

export interface Violation {
  source: RuleSource;
  /** Stable id, e.g. `envelope.format.uuid`. Branch on this, never on `message`. */
  rule: string;
  message: string;
  /** JSON pointer, where known. */
  path?: string;
}
