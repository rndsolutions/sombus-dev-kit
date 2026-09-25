# Contributing

Thank you for helping. This repo follows the conventions of the [Story Object Model](https://github.com/storyobjectmodel/som/blob/main/CONTRIBUTING.md) it implements.

## The short version

Open a pull request. Say what you're changing and why, run the checks, and expect a review. There's **no contributor licence agreement** to sign: by contributing, you agree that your contribution is offered under this repository's licence, Apache 2.0.

## Where a change belongs

| You want to change… | Where |
|---|---|
| What a skill **does**: its advert, its behaviour, its evaluation table | **Upstream**, as a pull request to [`storyobjectmodel/som`](https://github.com/storyobjectmodel/som) under `skills/`. Not here: `upstream/` is a pinned copy and is never edited |
| The SOM schema, or an example | **Upstream**, following its [compatibility policy](https://github.com/storyobjectmodel/som/blob/main/spec/compatibility-policy.md) |
| How an executor implements a skill; fixtures; the runner; the registration check | Here |
| An RND position on a question the library leaves open | Here, in `spec/POSITIONS.md`, citing the [`spec/open-register.md`](https://github.com/storyobjectmodel/som/blob/main/spec/open-register.md) item it answers, if there is one |

Where a skill's prose and the schema disagree, **the schema is right**. Implement the schema's version, record the difference in `spec/POSITIONS.md`, and raise it upstream.

## Running the checks

```bash
pip install pyyaml                  # validate_som_skill.py needs it
scripts/verify-upstream.sh
scripts/check-upstream-skills.sh
```

Executor tests and the fixture runner are added as they land. Every pull request must pass CI.

## What a good pull request looks like

- One change per pull request.
- A title that says what changed, and a description that says why. Link the issue.
- Fixtures for any behaviour you add or change, including the cases the change must **not** trigger on.
- Example configurations use neutral identifiers only. No vendor or product names; upstream holds back vendor-named configurations for the same reason.
- No version bumps; releases are cut by the maintainers.

## Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
