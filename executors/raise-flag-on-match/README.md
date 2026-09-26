# raise-flag-on-match

A reference executor for [`smart-stories/raise-flag-on-match`](../../upstream/som-1.0/skills/skills/raise-flag-on-match.md)
`0.2.2`: when a watched field of a story matches a configured value, it publishes a `skill.warning.raised`
declaring a named flag. It declares only: it never withholds, blocks or changes anything.

It passes every runnable case of the bus's skill harness for `som-1.0.0+lib-0.2.2`. Results read "passes the
som-bus checks", never "certified" or "compliant".

## Run it against your workspace

In the portal, in your vendor workspace:

1. **Apps → New app**, kind *skill executor* (for example `acme-flags`). Then **Consumer connections → New
   connection** for it, with message types `story.context`, `telling.*` and `asset.*`. Press **Get client
   secret**: that's the reader.
2. **Apps → New app**, kind *producer* (for example `acme-flags-publisher`). **Connect** it with a `system_id`
   you claim (for example `acme-flags-01`) and message type `skill.warning.raised`. That's the publisher.

Then, from the repository root (Node 20+, `npm install` first):

```bash
export SOMBUS_WORKSPACE=w…
export SOMBUS_READER_ID=… SOMBUS_READER_SECRET=…          # the skill app's consumer connection
export SOMBUS_PUBLISHER_ID=… SOMBUS_PUBLISHER_SECRET=…    # the producer app's connection
export SOMBUS_SYSTEM_ID=acme-flags-01
npm run executor:raise-flag-on-match
```

Leave it running and start the **skill harness** from the portal's **Test runs** page. Each trigger and what
the executor did with it is printed; the run's verdicts appear in the portal.

| Variable | Default | |
|---|---|---|
| `SOMBUS_BASE_URL` | `https://api.sombus.rnd-solutions.net/v1/` | The Sandbox. For another environment, see [Environments](https://sombus.rnd-solutions.net/docs/get-started/environments) |
| `SOMBUS_INSTANCE` | [`instances/house-breaking-indicative-category.json`](instances/house-breaking-indicative-category.json) | The configured instance to run. The harness expects this one |
| `SOMBUS_SYSTEM_TYPE` | `ncs` | The SOM `system_type` closest to the tool the executor sits beside ([P-02](https://sombus.rnd-solutions.net/docs/skills/positions#p-02)) |

## A configured instance

The house's choices (section 4 of the skill file), one JSON file per instance:

```json
{
  "instance_label": "house-breaking-indicative-category",
  "match_field": "lifecycle.phase",
  "match_value": "BREAKING",
  "flag_name": "indicative-category",
  "severity": "flag",
  "clearing_authority": "duty-editor"
}
```

`match_field` is a dot path; `[]` matches any element of an array (`editorial_source[].credibility`). The
comparison is `equals`, case sensitive. An instance without `instance_label`, `match_field`, `match_value` or
`flag_name` is refused at start. One without `clearing_authority` runs, and fails closed (below).

## How it maps to the skill file

| Skill file | Code |
|---|---|
| §4 Config surface | [`src/instance.ts`](src/instance.ts) |
| §5 step 1, resolve anchor: the story, no asset needed | `anchor()` in [`src/executor.ts`](src/executor.ts) |
| §5 step 2, gate: an absent watched field exits quietly | [`src/path.ts`](src/path.ts) `absent` |
| §5 step 4, evaluate: `equals` against `match_value` | `evaluate()` |
| §5 step 5, severity: `flag` or `inform`, never `hold` | `evaluate()`; `hold` is refused at start |
| §5 step 6 and §6, the warning: `rule_id` is the label, `affected_fields` the watched path, `blocks` empty, `non_overridable` false | `deliver()` |
| §5 step 8, close when a later snapshot no longer matches | `deliver()`: closes quietly, reopens as a new declaration |
| §5 trap, fail closed: a present but unreadable value, or a missing clearing authority, raises at `flag` and says so | `evaluate()` |
| §5 trap, `detail` names the flag, path, value found, value matched and who clears it | `evaluate()` |
| §9 eval set: declaring, non declaring, idempotency, fail closed, never auto-change | [`test/executor.test.ts`](test/executor.test.ts) |

Where the library leaves a question open, the code follows RND's
[positions](https://sombus.rnd-solutions.net/docs/skills/positions), each cited in the source: P-04 (active
skills), P-06 (wake-ups), P-07 (never an older snapshot), P-08 (raise on open and change), P-09
(`skill_warning_ref`), P-10 (a redelivered trigger gets the same bytes), P-11 (nothing on closure), P-12
(terminal stories), P-14 (never triggered by warnings). Where the library's §6 sample disagrees with the
schema (`warning_id`, `skill_warning_ref`), the schema wins ([P-01](https://sombus.rnd-solutions.net/docs/skills/positions#p-01)),
and every warning the tests produce is validated against the pinned SOM 1.0 schemas.

## Not yet

- **Clearance (§5 step 7).** Closing a declaration on an assertion from an authority at or above
  `clearing_authority` needs the house's ordered list of authorities ([P-16](https://sombus.rnd-solutions.net/docs/skills/positions#p-16)).
  The §9 *clearance* and *wrong clearance* cases wait for it. Declarations close when the field stops
  matching.
- **`asset.ingested`** has no SOM 1.0 schema, so an ingest trigger is only a wake-up against the latest
  snapshot (P-06), and the harness shows that case as pending spec.
- **Durable state.** Declarations and stored warnings are kept in memory. A production executor keeps them
  in its own store for at least the bus's 7-day idempotency window (P-10): after a restart, a redelivered
  trigger would otherwise build a new warning. Pass your own `store` to `createExecutor`.
