# examples/

Small, runnable reference apps that wire to SOM Managed Bus with the [SDK](../sdk/). Run them
against your own **vendor workspace**: they publish and read synthetic data only (the published
SOM 1.0 examples in [`../upstream/som-1.0/`](../upstream/som-1.0/SOURCE.md)).

| Example | Shows |
|---|---|
| [`publisher/publish-story.ts`](publisher/publish-story.ts) | A producer: builds each envelope once, publishes a story's seven snapshots in order, and handles every verdict (accepted, duplicate, refused) and both errors (no final answer, credentials refused) |
| [`consumer/pull.ts`](consumer/pull.ts) | A consumer on the HTTPS pull API: long poll, deduplicate on `message_id`, keep the highest `sequence_number` per story, ignore what it doesn't know, acknowledge |
| [`consumer/pull.sh`](consumer/pull.sh) | The quickest look at a consumer queue, with only `curl` and `jq`: asks for the connection's details (the secret hidden), gets a token, pulls, prints one line per message and acknowledges. No Node needed |
| [`newsroom/`](newsroom/) | A live newsroom: an actor per newsroom system, each on its own connections, reacting to each other through the bus. Run it against your own house with one command |
| [`../executors/raise-flag-on-match/`](../executors/raise-flag-on-match/) | A skill executor: reads triggers as a consumer, publishes `skill.warning.raised` as a producer. Grade it with the skill harness in **Test runs** |

## What you need

From the portal, in your vendor workspace ([docs](https://sombus.rnd-solutions.net/docs/)):
- **To publish:** a producer app with a claimed `system_id` that may publish `story.context`, connected
  to the workspace, and its client id and secret.
- **To consume:** a consumer connection for `story.context` and its client id and secret (the pull API's).

Node 20 or later, then `npm install` at the repository root.

## Run

```bash
export SOMBUS_WORKSPACE=w…                       # your workspace id

# publish
SOMBUS_CLIENT_ID=… SOMBUS_CLIENT_SECRET=… SOMBUS_SYSTEM_ID=acme-ncs-test npm run example:publish

# read it back
SOMBUS_CLIENT_ID=… SOMBUS_CLIENT_SECRET=… npm run example:consume
```

Or just look at the queue from a shell, no Node or `npm install` needed (`curl` and `jq` only):

```bash
examples/consumer/pull.sh              # asks for the workspace, the connection id and its secret
examples/consumer/pull.sh --no-ack     # look without removing; --once, --full, --staging, --help
```

| Variable | Default | |
|---|---|---|
| `SOMBUS_BASE_URL` | `https://api.sombus.rnd-solutions.net/v1/` | The Sandbox. For another environment, see [Environments](https://sombus.rnd-solutions.net/docs/get-started/environments) |
| `SOMBUS_WORKSPACE` | – | Your workspace id |
| `SOMBUS_CLIENT_ID`, `SOMBUS_CLIENT_SECRET` | – | The connection's credentials: the producer app's to publish, the consumer connection's to consume |
| `SOMBUS_SYSTEM_ID` | – | Publish only: a `system_id` your app claimed |
| `SOMBUS_SYSTEM_TYPE`, `SOMBUS_VENDOR` | `ncs`, `example` | Publish only: the rest of `originating_system` |
| `SOMBUS_IDLE_POLLS` | `3` | Consume only: stop after this many empty 20-second polls; `0` runs until Ctrl-C |

Never commit credentials. The examples log identifiers only, never payloads or tokens.
