# sombus-dev-kit

**Everything a vendor needs to wire an app to SOM Managed Bus.** RND Solutions · pre-release · Apache 2.0

[SOM Managed Bus](https://sombus.rnd-solutions.net) is a hosted message bus for the
[Story Object Model](https://github.com/storyobjectmodel/som) (SOM), run by RND Solutions as a service.
Newsroom systems publish SOM messages to it and read them from it. This repository is the open side: the
code you build with, and the checks to prove it works. The bus itself isn't here: you use it through its
API, with a workspace from the portal.

| | What's there |
|---|---|
| [`sdk/`](sdk/) | Client libraries: one design and a shared [conformance kit](sdk/conformance/). The TypeScript first slice covers tokens, envelopes, and publishing with retries and typed verdicts |
| [`examples/`](examples/) | Runnable reference apps against your workspace: a producer, and a consumer on the HTTPS pull API |
| [`executors/`](executors/) | Reference **skill executors** for the SOM skill library. First: [`raise-flag-on-match`](executors/raise-flag-on-match/), which passes the bus's skill harness |
| [`spec/`](spec/) | The executor contract and RND's positions where the library leaves a question open |
| [`upstream/som-1.0/`](upstream/som-1.0/SOURCE.md) | SOM 1.0 schemas, examples and the skill library 0.2.2, pinned |

Documentation, including how to get a workspace and credentials: **[sombus.rnd-solutions.net/docs](https://sombus.rnd-solutions.net/docs/)**.

## Quick start

```bash
npm install
npm test                                  # the SDK, the conformance kit and the executors
npm run example:publish                   # needs a vendor workspace: see examples/README.md
npm run executor:raise-flag-on-match      # see executors/raise-flag-on-match/README.md
```

## Skill executors

The SOM skill library publishes **specifications** of editorial skills (raise a flag when a field matches,
hold while flagged, gate by scope…) that newsroom systems run over `story.context` and other SOM messages.
The code that runs a skill is a **skill executor**, and every vendor writes their own. `executors/` holds
open implementations: see how a library skill behaves in code you can run, start your own from a working
one, and grade yours with the skill harness in your workspace's **Test runs**.

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

## Roadmap

What comes next, in roughly this order. Folders appear when their code does.

- **`som-skill test`**: grade an executor from your command line and CI, against your workspace's sandbox.
- **More executors**: `gate-by-scope` and `flag-on-mismatch`, then `hold-while-flagged` and the rest of the
  library. `declare-context-on-commit` waits for the working group to add it.
- **Clearance** in `raise-flag-on-match`, once houses can supply their authority scale.
- **Registration checks**: every configured `{{ config.* }}` path resolved against the schema before an
  instance is accepted, offered upstream once proven.
- **SDK**: the consumer, the validator and the dry run in TypeScript, then Python, .NET and Java, and
  packages on the registries.

## Checks

```bash
npm run typecheck && npm test       # SDK, examples and executors
scripts/verify-upstream.sh          # the pinned upstream is byte-for-byte what SOURCE.md says
scripts/check-upstream-skills.sh    # the library's own five validators, against the pinned schema
```

CI runs all of them on every pull request.

## Related

- [SOM Managed Bus docs](https://sombus.rnd-solutions.net/docs/): getting a workspace, the API, producers, consumers, skills and test runs.
- [SOM governance](https://github.com/storyobjectmodel/som/blob/main/GOVERNANCE.md): how the standard and the library change. Findings from this repo go upstream as pull requests or issues.

## Licence

Apache 2.0 ([LICENSE](LICENSE)). See [NOTICE](NOTICE) for the SOM material redistributed in `upstream/`. This repository was called `sombus-skills-ref`; old links redirect here.
