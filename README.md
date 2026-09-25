# sombus-skills-ref

**Reference executors for the SOM skill library.** RND Solutions · pre-release · Apache 2.0

The [Story Object Model](https://github.com/storyobjectmodel/som) (SOM) publishes a **skill library**: specifications of editorial skills (raise a flag when a field matches, hold while flagged, gate by scope…) that newsroom systems run over `story.context` and other SOM messages. A skill in the library is a **specification**, a markdown file with a machine-read advert. The code that runs it is a **skill executor**, and every vendor writes their own.

This repository is **one open implementation of those executors**, with the fixtures and tools to prove them. Use it to:
- see how a library skill behaves, in code you can run;
- start your own executor from a working one;
- test your executor against the same fixtures.

## What this is not

- **Not the skill library.** The skills are defined upstream in [`storyobjectmodel/som/skills`](https://github.com/storyobjectmodel/som/tree/main/skills), owned by the SOM working group. We implement them, and never redefine or fork them. A skill's behaviour is whatever the upstream file says.
- **Not endorsed by the SOM working group.** It certifies nothing, and SOM defines no conformance tiers. Describe results as "passes the sombus-skills-ref fixtures for `som-1.0.0+lib-0.2.2`", never as "SOM certified" or "SOM compliant".

## Suite

| | |
|---|---|
| SOM | 1.0.0 |
| Skill library | 0.2.2 (`lifecycle: draft`) |
| Upstream commit | [`7297fef`](https://github.com/storyobjectmodel/som/commit/7297fef9adc6d14a74bdd7550c78decaa099a1ad), pinned in [`upstream/som-1.0/`](upstream/som-1.0/SOURCE.md) |
| Suite id | `som-1.0.0+lib-0.2.2` |

## Layout

```
upstream/som-1.0/   schema, examples, skills and tools at the pinned commit, SHA-256 checked, never edited
spec/               the executor contract and RND positions on open library questions
executors/<skill>/  one executor per library skill
configs/            example configured instances, with neutral identifiers only
fixtures/           trigger and no-trigger cases per skill, from each skill's evaluation table
registration/       resolves configured {{ config.* }} paths against the schema
runner/             som-skill test: plays fixtures to an executor and checks its warnings
scripts/            repo checks
```

## Status

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
scripts/verify-upstream.sh          # the pinned upstream is byte-for-byte what SOURCE.md says
scripts/check-upstream-skills.sh    # the library's own five validators, against the pinned schema
```

CI runs both on every pull request.

## Related

- [som-bus-reference](https://github.com/rndsolutions/som-bus-reference): the RND SOM bus, where these executors are tested end to end (epic #59).
- [SOM governance](https://github.com/storyobjectmodel/som/blob/main/GOVERNANCE.md): how the standard and the library change. Findings from this repo go upstream as pull requests or issues.

## Licence

Apache 2.0 ([LICENSE](LICENSE)). See [NOTICE](NOTICE) for the SOM material redistributed in `upstream/`.
