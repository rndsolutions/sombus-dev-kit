/**
 * The live newsroom: a fictional newsroom (Meridian News) whose systems are separate processes, each
 * on its own connections, reacting to each other through the bus. See README.md.
 *
 *   import { runNewsroom } from 'sombus-dev-kit/newsroom';
 *   const report = await runNewsroom({ apiUrl, tokenUrl, roles: { ncs: { producer, consumer }, … }, stopAfterMs: 60_000 });
 */
export { runNewsroom, defaultSystemId, MAX_EVENTS, type ClientCreds, type RoleConfig, type NewsroomOptions, type NewsroomEvent, type NewsroomReport } from './run.js';
export {
  LIVE_ROLES, LIVE_ACTORS, LIVE_APPS, LIVE_GRANTS, LIVE_RECEIVES, LIVE_SYSTEM_TYPES, LIVE_NEWSROOM_ID, LIVE_ROLES_PATH, LIVE_TIME_ZONE,
  LIVE_CONTRACT_VERSION, granted, liveTag, liveStoryId, isLiveStory,
  type LiveRole, type LiveActor, type LiveReaction, type LiveRoleHolder, type LiveRolesView,
} from './contract.js';
export { DAY, type Beat } from './day.js';
export { createActor, DEFAULT_SKILL_INSTANCES, type Actor, type Outgoing } from './actors.js';
