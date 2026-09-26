# sombus-dev-kit

**Everything a vendor needs to wire an app to SOM Managed Bus.** RND Solutions · pre-release · Apache 2.0

[SOM Managed Bus](https://sombus.rnd-solutions.net) is a hosted message bus for the
[Story Object Model](https://github.com/storyobjectmodel/som) (SOM), run by RND Solutions as a service.
Newsroom systems publish SOM messages to it and read them from it. This repository is the open side: the
code you build with, and the fixtures and checks to prove it works. The bus itself isn't here: you use it
through its API, with a workspace from the portal.

| | For | Status |
|---|---|---|
| [`sdk/`](sdk/) | Client libraries, one design and a shared [conformance kit](sdk/conformance/). TypeScript first | First slice: tokens, envelopes, publishing with retries and typed verdicts |
| [`examples/`](examples/) | Runnable reference apps: a producer and a consumer, against your workspace | Available |
| [`executors/`](executors/) | Reference **skill executors** for the SOM skill library | Planned |
| [`spec/`](spec/), [`fixtures/`](fixtures/), [`runner/`](runner/), [`registration/`](registration/), [`configs/`](configs/) | The executor contract, skill fixtures, `som-skill test`, and configured-instance checks | Planned |
| [`upstream/som-1.0/`](upstream/som-1.0/SOURCE.md) | SOM 1.0 schemas, examples and the skill library 0.2.2, pinned | Available |

Documentation, including how to get a workspace and credentials: **[sombus.rnd-solutions.net/docs](https://sombus.rnd-solutions.net/docs/)**.

## Quick start

```bash
npm install
npm test                       # the SDK's unit tests and the conformance kit
npm run example:publish        # needs a vendor workspace: see examples/README.md
```

## Skill executors

The SOM skill library publishes **specifications** of editorial skills (raise a flag when a field matches,
hold while flagged, gate by scope…) that newsroom systems run over `story.context` and other SOM messages.
The code that runs a skill is a **skill executor**, and every vendor writes their own. `executors/` will
hold one open implementation of each, with the fixtures and tools to prove them: see how a library skill
behaves in code you can run, start your own from a working one, and test yours against the same fixtures.

## What this is not

- **Not the bus.** The bus is a hosted service; its source isn't published.
- **Not the skill library.** The skills are defined upstream in [`storyobjectmodel/som/skills`](https://github.com/storyobjectmodel/som/tree/main/skills), owned by the SOM working group. We implement them, and never redefine or fork them. A skill's behaviour is whatever the upstream file says.
- **Not endorsed by the SOM working group.** It certifies nothing, and SOM defines no conformance tiers. Describe results as "passes the som-bus checks for `som-1.0.0+lib-0.2.2`", never as "SOM certified" or "SOM compliant".

## Suite

| | |
|---|---|
| SOM | 1.0.0 |
| Skill library | 0.2.2 (`lifecycle: draft`) |
| Upstream commit | [`7297fef`](https://github.com/storyobjectmodel/som/commit/7297fef9adc6d14a74bdd7550c78decaa099a1ad), pinned in [`upstream/som-1.0/`](upstream/som-1.0/SOURCE.md) |
| Suite id | `som-1.0.0+lib-0.2.2` |

## Layout

```
sdk/                the SDK design, the conformance kit, and one folder per language (typescript/ first)
examples/           reference producer and consumer apps, on the SDK
upstream/som-1.0/   schema, examples, skills and tools at the pinned commit, SHA-256 checked, never edited
spec/               the executor contract and RND positions on open library questions
executors/<skill>/  one executor per library skill
configs/            example configured instances, with neutral identifiers only
fixtures/           trigger and no-trigger cases per skill, from each skill's evaluation table
registration/       resolves configured {{ config.* }} paths against the schema
runner/             som-skill test: plays fixtures to an executor and checks its warnings
scripts/            repo checks
```

## Executor status

| Skill | Executor |
|---|---|
| `raise-flag-on-match` | planned (first) |
| `gate-by-scope` | planned (first) |
| `flag-on-mismatch` | planned (first) |
| `hold-while-flagged` | planned |
| `apply-clearance`, `enrich-on-condition`, `match-and-propose`, `record-provenance-on-ingest`, `select-provider-by-context`, `surface-on-context-match` | planned |
| `declare-context-on-commit` | waiting: proposed upstream, not yet in the library |

## Checks

```bash
npm run typecheck && npm test       # SDK and examples
scripts/verify-upstream.sh          # the pinned upstream is byte-for-byte what SOURCE.md says
scripts/check-upstream-skills.sh    # the library's own five validators, against the pinned schema
```

CI runs all of them on every pull request.

## Related

- [SOM Managed Bus docs](https://sombus.rnd-solutions.net/docs/): getting a workspace, the API, producers, consumers, skills and test runs.
- [SOM governance](https://github.com/storyobjectmodel/som/blob/main/GOVERNANCE.md): how the standard and the library change. Findings from this repo go upstream as pull requests or issues.

## Licence

Apache 2.0 ([LICENSE](LICENSE)). See [NOTICE](NOTICE) for the SOM material redistributed in `upstream/`. This repository was called `sombus-skills-ref`; old links redirect here.
