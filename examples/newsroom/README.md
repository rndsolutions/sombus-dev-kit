# The live newsroom

A fictional newsroom, **Meridian News**, whose systems are separate actors. Each one holds its own
connections to SOM Managed Bus, publishes with OAuth client credentials and reads its own queue over the
HTTPS pull API, exactly as a vendor's system would. Only the newsroom system (NCS) and the media store are
scripted; every other system only reacts to what the bus delivers to it. So what you watch in the portal
is a real chain through the bus: publish, route, pull, react, acknowledge.

Everything in it is synthetic: made-up systems, stories and people. Its apps are named "(live actor)" so
nobody mistakes them for real systems. The contract it follows is [`spec/live-newsroom.json`](../../spec/live-newsroom.json).

## The actors

| Role | Publishes (producer grants) | Receives (consumer message types) | What it does |
|---|---|---|---|
| `ncs` · Meridian NCS | `story.context` | `delivery.media_available` | Plays the day's story beats, one `story.context` snapshot each. When media lands for one of its stories, the next snapshot attaches it |
| `mam` · Media store | `delivery.media_available`, `story.context` | `story.context` | Files a tip-line clip as an orphan story (source UNVERIFIED) at 06:10. When a story's first snapshot arrives, its coverage feed lands |
| `skill` · Skill executor | `skill.warning.raised` | `story.context` | The reference executor [`raise-flag-on-match`](../../executors/raise-flag-on-match/): evaluates every snapshot and raises what matches |
| `graphics` · Graphics | `link.committed`, `link.withdrawn` | `story.context` | A snapshot carries a lower third: books it, gate PENDING. A kill: withdraws what it booked |
| `standards` · Standards desk | `link.gate_changed`, `system.audit` | `link.committed` | A link waits on a PENDING gate: clears it, and records why |
| `playout` · Playout | `telling.*` | `link.gate_changed`, `story.context` | A booked link is cleared: takes it to air. A kill: takes it off |
| `cms` · Web CMS | `story.context`, `link.committed`, `telling.*` | `telling.started` | A story goes to air: publishes it on the live web page. A kill: ends that |
| `automation` · Automation | `system.audit` | `story.context` | A kill: suppresses the story's package, and records it |

The day, in the newsroom's time (Europe/London):

| Time | Beat | And the chain it starts |
|---|---|---|
| 06:10 | The media store files the tip-line clip | The skill flags it UNVERIFIED |
| 06:45 | The hurricane story breaks, at HIGH priority | The skill informs BREAKING; the press conference feed lands; the NCS attaches it |
| 08:35 to 11:05 | The story develops | |
| 11:40 | A court story | The skill informs BREAKING; its feed lands and is attached |
| 12:15 | The outage lower third | Graphics books it, standards clears it, playout airs it, the web CMS publishes the story |
| 14:05 | Landfall, the figure confirmed | |
| 14:45 | The court story's headline is fixed | |
| 16:10 | A correction, as a newer snapshot | |
| 18:10 | The hurricane story is killed | Graphics withdraws, playout and the web end, automation records the suppression |

Story ids end in `.demo-live-<yyyymmdd>` and snapshots carry `newsroom_id: "demo"`, so the portal marks
them as demo traffic.

## Run the newsroom yourself

You need your own house on the Sandbox (a publisher workspace; see
[Set up your house](https://sombus.rnd-solutions.net/docs/publishers/set-up-your-house)), Node 20 or later,
and `npm install` at the repository root.

### 1. Create the connections

For each role you want the newsroom to play, in your house:

1. **Apps → New app**, named as in the table (for example `Meridian NCS (live actor)`).
2. **Connect** it as a producer, with a `system_id` you claim, `<prefix>-<role>` (for example
   `acme-live-ncs`; system ids are unique on the bus, so pick your own prefix), and the message types in the
   table's *Publishes* column. Keep its client id and secret: that's the role's **producer**.
3. **Consumer connections → New connection** for the same app, with the message types in the *Receives*
   column and no sources, then **Get client secret**. That's the role's **consumer**.

For the skill role you can also register `raise-flag-on-match` instances in **House skills** and bind them
to its consumer connection: the actor runs the ones it is given. With none, it runs two of its own,
`demo-ugc-unverified` (a source whose credibility is UNVERIFIED) and `demo-breaking-priority` (HIGH
priority).

Leave a role out to play it with your own system instead: the actors downstream react to whatever it
publishes.

### 2. Run it

Copy [`env.example`](env.example) to `.env.newsroom` at the repository root (git ignores it), fill in the
ids and secrets, then:

```bash
set -a; source .env.newsroom; set +a
SOMBUS_NEWSROOM_SPEED=60 npm run newsroom      # a whole day in about 12 minutes, from 06:00
npm run newsroom                               # or on the real clock, until Ctrl-C
```

That runs every role you configured in one process, each on its own connections. To run each role as a
process of its own, start one per role with `SOMBUS_NEWSROOM_ROLES=ncs npm run newsroom`, and so on.

Each beat, reaction and answer from the bus is printed, one line each. Open **Story timeline** and
**Activity** in the portal to watch the stories go through.

| Variable | Default | |
|---|---|---|
| `SOMBUS_BASE_URL` | `https://api.sombus.rnd-solutions.net/v1/` | The Sandbox. For another environment, see [Environments](https://sombus.rnd-solutions.net/docs/get-started/environments) |
| `SOMBUS_TOKEN_URL` | `<SOMBUS_BASE_URL>oauth/token` | |
| `SOMBUS_NEWSROOM_<ROLE>_PRODUCER_ID`, `_PRODUCER_SECRET` | – | The role's producer connection. A role runs when its producer id is set |
| `SOMBUS_NEWSROOM_<ROLE>_CONSUMER_ID`, `_CONSUMER_SECRET` | – | The role's consumer connection. Without one, it reacts to nothing |
| `SOMBUS_NEWSROOM_<ROLE>_SYSTEM_ID` | `<prefix>-<role>` | The `system_id` its producer claimed |
| `SOMBUS_NEWSROOM_SYSTEM_PREFIX` | `meridian-live` | The prefix of the default system ids |
| `SOMBUS_NEWSROOM_ROLES` | every role configured | Run only these, comma-separated (`ncs,mam`) |
| `SOMBUS_NEWSROOM_SPEED` | `1` | How fast the day's clock runs. Other than 1, the day starts at 06:00 |
| `SOMBUS_NEWSROOM_DAY` | today | Which day's stories, `YYYY-MM-DD`. Set, the day starts at 06:00. A day plays once: choose another date for fresh stories |
| `SOMBUS_NEWSROOM_MINUTES` | – | Stop after this long. Unset: run until Ctrl-C |

`<ROLE>` is `NCS`, `MAM`, `SKILL`, `GRAPHICS`, `STANDARDS`, `PLAYOUT`, `CMS` or `AUTOMATION`. The workspace
comes from each connection's token. Never commit credentials; the newsroom logs identifiers only, never
payloads or tokens.

Started later in the day, the scripted actors play every beat already due, a few seconds apart so each
chain has time to go through. If the NCS gets to its next beat before the media store's feed arrives, the
bus refuses the late attachment as not newer, and the next snapshots carry the feed anyway.

## A run keeps no state

Every message is built from what caused it: a beat from the day and its time, a reaction from the message it
reacts to. The same cause always gives the same `message_id` and the same bytes. So:

- **A beat already on the bus is not played again.** At start, the scripted actors go through the day's due
  beats in order; the bus answers `200 duplicate` to one already published (or refuses a snapshot older than
  the story's last as `sequence_number.not_increasing`), which the actor reads as "already published" and
  moves on. Nothing reaches a consumer twice: the bus drops duplicates before routing.
- **A reaction is acknowledged only once the bus has answered it.** A message whose reaction was cut short
  stays in the queue and comes back to the next run, and the reaction it gets then is the same bytes.

So you can stop the newsroom at any moment, or run it in short bounded runs (`SOMBUS_NEWSROOM_MINUTES`, or
`stopAfterMs` below), and each run carries on where the bus says the day is. The skill executor keeps its
open declarations in memory (see its [README](../../executors/raise-flag-on-match/README.md)); after a
restart it may raise a flag again on the next snapshot that matches.

## Standing down for a real system

Before each beat and each reaction, an actor asks the bus who holds its role, `GET <api>/jwt/live/roles`
with its own token. If the answer says a real system holds it (`"held_by": "real"`), the actor stays silent
and the actors downstream react to the real system. If the bus has no such route, or it fails, every role
is played by its actor.

## As a library

```ts
import { runNewsroom } from 'sombus-dev-kit/newsroom';

const report = await runNewsroom({
  apiUrl: 'https://api.sombus.rnd-solutions.net/v1',
  tokenUrl: 'https://api.sombus.rnd-solutions.net/v1/oauth/token',
  roles: {
    ncs: { producer: { client_id, client_secret }, consumer: { client_id, client_secret }, system_id: 'acme-live-ncs' },
    // … only the roles listed run
  },
  stopAfterMs: 60_000,           // a bounded run; absent, until SIGINT
  log: (e) => console.log(e),    // { at, role, kind: beat | reaction | skipped_real | error, message_type, story_id, outcome, detail }
});
// report: { published, reacted, skipped_real, errors, events }
```

`now` sets the day's clock (the tests run whole days in seconds with it); `catchUpGapMs` is the time left
for a chain between two beats that are due at once (default 5 s).
