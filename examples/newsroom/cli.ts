/**
 * Run the live newsroom against your house: every role whose producer credentials are set.
 *
 *   SOMBUS_NEWSROOM_NCS_PRODUCER_ID=… SOMBUS_NEWSROOM_NCS_PRODUCER_SECRET=… \
 *   SOMBUS_NEWSROOM_NCS_CONSUMER_ID=… SOMBUS_NEWSROOM_NCS_CONSUMER_SECRET=… \
 *   … (the same for mam, skill, graphics, standards, playout, cms, automation) \
 *     npm run newsroom
 *
 * See examples/newsroom/README.md for the connections to create and every variable.
 */
import { env } from '../env.js';
import { LIVE_ROLES, LIVE_TIME_ZONE, type LiveRole } from './contract.js';
import { localDay, zonedInstant } from './ids.js';
import { defaultSystemId, runNewsroom, type RoleConfig } from './run.js';

const opt = (name: string) => {
  const v = process.env[name];
  return v === undefined || v === '' ? undefined : v;
};

const apiUrl = env('SOMBUS_BASE_URL', 'https://api.sombus.rnd-solutions.net/v1/');
const tokenUrl = env('SOMBUS_TOKEN_URL', new URL('oauth/token', apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`).toString());
const prefix = opt('SOMBUS_NEWSROOM_SYSTEM_PREFIX');

// SOMBUS_NEWSROOM_ROLES=ncs,mam runs only those (one process per role, if you like); default every role configured.
const only = opt('SOMBUS_NEWSROOM_ROLES')?.split(',').map((r) => r.trim().toLowerCase());
const unknown = only?.filter((r) => !(LIVE_ROLES as readonly string[]).includes(r)) ?? [];
if (unknown.length) {
  console.error(`SOMBUS_NEWSROOM_ROLES: unknown role(s) ${unknown.join(', ')}; the roles are ${LIVE_ROLES.join(', ')}.`);
  process.exit(2);
}

const roles: Partial<Record<LiveRole, RoleConfig>> = {};
for (const role of LIVE_ROLES) {
  if (only && !only.includes(role)) continue;
  const R = `SOMBUS_NEWSROOM_${role.toUpperCase()}`;
  const id = opt(`${R}_PRODUCER_ID`);
  if (!id) continue;
  const consumerId = opt(`${R}_CONSUMER_ID`);
  roles[role] = {
    producer: { client_id: id, client_secret: env(`${R}_PRODUCER_SECRET`) },
    ...(consumerId ? { consumer: { client_id: consumerId, client_secret: env(`${R}_CONSUMER_SECRET`) } } : {}),
    system_id: opt(`${R}_SYSTEM_ID`) ?? (prefix ? `${prefix}-${role}` : defaultSystemId(role)),
  };
}
if (!Object.keys(roles).length) {
  console.error('Set at least one role\'s SOMBUS_NEWSROOM_<ROLE>_PRODUCER_ID and _SECRET. See examples/newsroom/README.md.');
  process.exit(2);
}

// The day's clock: real time, or a day of your choosing played fast from 06:00.
const speed = Number(opt('SOMBUS_NEWSROOM_SPEED') ?? 1);
const day = opt('SOMBUS_NEWSROOM_DAY');
if (!(speed > 0) || (day && !/^\d{4}-\d{2}-\d{2}$/.test(day))) {
  console.error('SOMBUS_NEWSROOM_SPEED must be a positive number and SOMBUS_NEWSROOM_DAY a date, YYYY-MM-DD.');
  process.exit(2);
}
let now = Date.now;
if (day || speed !== 1) {
  const started = Date.now();
  const from = zonedInstant(day ?? localDay(started, LIVE_TIME_ZONE), '06:00', LIVE_TIME_ZONE);
  now = () => from + (Date.now() - started) * speed;
}
const minutes = opt('SOMBUS_NEWSROOM_MINUTES');
/** Log lines in the newsroom's own time. */
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: LIVE_TIME_ZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });

console.log(`live newsroom: ${Object.keys(roles).join(', ')} on ${apiUrl}${speed !== 1 ? ` at ${speed}x from 06:00` : ''}${minutes ? ` for ${minutes} min` : '; Ctrl-C to stop'}`);
const report = await runNewsroom({
  apiUrl, tokenUrl, roles, now,
  ...(minutes ? { stopAfterMs: Number(minutes) * 60_000 } : {}),
  log: (e) => {
    const line = [clock.format(new Date(e.at)), e.role.padEnd(10), e.kind.padEnd(12), (e.message_type ?? '').padEnd(24), e.outcome ?? '', e.story_id ?? '', e.detail ?? ''].join(' ').trimEnd();
    (e.kind === 'error' ? console.error : console.log)(line);
  },
});
console.log(`published ${report.published}, reacted ${report.reacted}, left to real systems ${report.skipped_real}, errors ${report.errors}`);
process.exit(report.errors && !report.published && !report.reacted ? 1 : 0);
