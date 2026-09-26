/**
 * A configured instance of raise-flag-on-match: the house's choices, section 4 of the upstream
 * skill file (upstream/som-1.0/skills/skills/raise-flag-on-match.md).
 */
export const SKILL_ID = 'smart-stories/raise-flag-on-match';
export const SKILL_VERSION = '0.2.2';

export interface ConfiguredInstance {
  /** The editorial label; published as the warning's `rule_id`. */
  instance_label: string;
  /** Dot path of the watched field; `[]` means any element, e.g. `editorial_source[].credibility`. */
  match_field: string;
  /** Compared with `equals`, case sensitive. */
  match_value: string;
  /** The flag declared, carried into `detail`. */
  flag_name: string;
  /** `flag` (default) or `inform`. Never `hold`. */
  severity?: 'flag' | 'inform';
  /** Who clears it. Missing means fail closed: every evaluation raises at `flag` (section 5). */
  clearing_authority?: string;
}

/**
 * Refuses an instance that can't even name its warning. A missing `clearing_authority` is
 * accepted on purpose: the skill fails closed on it at run time.
 */
export function checkInstance(i: Partial<ConfiguredInstance>): ConfiguredInstance {
  for (const f of ['instance_label', 'match_field', 'match_value', 'flag_name'] as const) {
    if (typeof i[f] !== 'string' || i[f] === '') throw new TypeError(`configured instance: ${f} is required`);
  }
  if (i.severity !== undefined && i.severity !== 'flag' && i.severity !== 'inform') {
    throw new TypeError(`configured instance: severity must be flag or inform, not ${String(i.severity)}`);
  }
  return i as ConfiguredInstance;
}
