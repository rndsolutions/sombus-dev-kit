# Conformance kit

Language-neutral test cases every SOM Managed Bus SDK must pass in CI ([DESIGN.md §11](../DESIGN.md#11-the-conformance-kit)).
Each SDK has a thin runner that loads these files; the cases, not the runners, are the contract.
The TypeScript runner is [`../typescript/test/conformance.test.ts`](../typescript/test/conformance.test.ts).

The expectations are the bus's own verdicts: `test/sdk.test.ts` in the bus repository checks
`validation.json` against the gateway's validator and every gateway rule id in `verdicts.json`
against the gateway's source.

## `suite.json`

| Key | Meaning |
|---|---|
| `kit_version` | semver of the kit. A new case is a minor; a changed expectation is a major |
| `suite` | the SOM schema pack + skill library the cases hold for (`som-1.0.0+lib-0.2.2`) |
| `examples_root` | where `file` paths in `validation.json` resolve (the pinned `upstream/som-1.0/examples`) |
| `wrap_envelope` | the envelope a runner puts around a bare example payload: replace `{message_type}` and put the payload at `{payload}` |
| `files` | the case files below |

## Case files

Each file is `{ "kind": …, "cases": [ { "id", "description"?, …input…, "expect" } ] }`. Ids are
stable, so a runner can skip a case by id with a reason, visibly.

**`validation.json`**: `file` (under `examples_root`), `select` (take this member of the file,
e.g. `message` for negative cases), `wrap` (the `message_type` to wrap a bare payload with), and
`expect`: `{ ok: true, family }` or `{ ok: false, sources[], rules[] }` (sorted, unique).

**`envelope.json`**: `clock` for every case; `input` in wire names (`message_type`, `payload`,
`originating_system`, `correlation_id`, `causation_id`, `topic`, `timestamp`, `message_id`,
`extensions`); `follow` (build as a follow-up of this message). `expect`: `fields` (a subset the
envelope must contain), `absent` (keys it must not have), `uuidv7` (id → prefix the clock fixes,
with an all-zero random source), or `error` (the field the builder must reject).

**`verdicts.json`**: `response { status, body }` → `expect { kind, source, rule, path, retry,
rules, tolerated_rules, family, message_id }` (only the keys given are checked).

**`retry.json`**: `policy` and `random` for every case; `responses`: the answers to successive
publish attempts, where `"network_error"` and `"timeout"` mean no answer, and `{message_id}` in a
body is the published message's id. `expect`: `outcome` (`accepted`, `duplicate`, `refused`,
`unavailable`), `attempts`, `delays_ms` (with `random` = 1), `same_body`, `token_fetches` (from an
empty token cache), `rule` / `last_rule`.

## Adding a case

Add it to the file, run every SDK's runner, and bump `kit_version`. If the case describes a gateway
answer, it must be one the gateway gives: the bus tests will tell you.
