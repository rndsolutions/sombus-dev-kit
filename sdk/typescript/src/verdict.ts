/**
 * The bus's answer as a typed verdict (sdk/DESIGN.md §6).
 *
 *   202                       → Accepted   (tolerated[] = warnings, not failures)
 *   200 + duplicate           → Duplicate  (an earlier attempt already got through: success)
 *   4xx/5xx + violations[]    → Refused    (source + rule from the gateway)
 *   anything else             → Refused    (source `transport`, rule `http.<status>`)
 *
 * `retry` says what the publisher may do about a refusal. The publisher acts on it; callers
 * normally see only final verdicts.
 */
import type { RuleSource, Violation } from './types.js';

export type RetryClass =
  /** Resend the same bytes after a backoff: throttling, `bus.publish_failed`, 5xx, timeouts. */
  | 'backoff'
  /** Get a new token and resend once: 401. */
  | 'refresh_token'
  /** Don't resend this message. Fix it, or rebuild from current state with a new message_id. */
  | 'none';

export interface Accepted {
  kind: 'accepted';
  status: number;
  messageId: string;
  messageType: string;
  family: string | null;
  tolerated: Violation[];
  dryRun: boolean;
}

export interface Duplicate {
  kind: 'duplicate';
  status: number;
  messageId: string;
}

export interface Refused {
  kind: 'refused';
  status: number;
  /** Of the first violation. */
  source: RuleSource;
  rule: string;
  path?: string;
  violations: Violation[];
  retry: RetryClass;
}

export type Verdict = Accepted | Duplicate | Refused;

export function retryClass(status: number): RetryClass {
  if (status === 401) return 'refresh_token';
  if (status === 408 || status === 429 || status >= 500) return 'backoff';
  return 'none';
}

export function parseVerdict(status: number, body: unknown): Verdict {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (b.accepted === true && typeof b.message_id === 'string') {
    if (b.duplicate === true) return { kind: 'duplicate', status, messageId: b.message_id };
    if (status >= 200 && status < 300) {
      return {
        kind: 'accepted',
        status,
        messageId: b.message_id,
        messageType: typeof b.message_type === 'string' ? b.message_type : '',
        family: typeof b.family === 'string' ? b.family : null,
        tolerated: Array.isArray(b.tolerated) ? b.tolerated.filter(isViolation) : [],
        dryRun: b.dry_run === true,
      };
    }
  }
  const violations = b.accepted === false && Array.isArray(b.violations) ? b.violations.filter(isViolation) : [];
  const first: Violation = violations[0] ?? {
    source: 'transport',
    rule: `http.${status}`,
    message: typeof b.message === 'string' ? b.message : `HTTP ${status} without a gateway verdict`,
  };
  return {
    kind: 'refused',
    status,
    source: first.source,
    rule: first.rule,
    ...(first.path ? { path: first.path } : {}),
    violations: violations.length ? violations : [first],
    retry: retryClass(status),
  };
}

function isViolation(v: unknown): v is Violation {
  const x = v as Violation;
  return !!x && typeof x === 'object' && typeof x.rule === 'string' && typeof x.source === 'string';
}
